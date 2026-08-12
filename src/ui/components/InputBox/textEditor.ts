import stringWidth from "string-width";

/**
 * 文本小切片：从一段文本里切出来的一个小块
 * 由官方 SegmentData 去掉冗余的 input（调用方已有完整文本）派生而来。
 * 
 * type TextSegment = {
 *   segment: string;        // 这一小段切出来的文本内容
 *   index: number;          // 这一小段在原始文本里的起始下标（offset）
 *   isWordLike: boolean;    // 这一小段是不是"像词"的内容（grapheme 模式下恒为 false）
 *   // input: string        // 已被 Omit 掉，不在类型里
 * }
 */
type TextSegment = Omit<Intl.SegmentData, "input"> & { isWordLike?: boolean };

/**
 * 定义每行（在终端屏幕上显示时会占几行）的开头结尾位置和内容
 * start 和 end 是 offset 索引，表示在原始文本 text 中的起始位置和结束位置
 * 但 text 是经过换行处理后的文本，即 text 中的换行符被替换为 \n
 * 
 * lines = [
 *   { start: 0, end: 3, text: "你wo" },  // 第 1 个 WrappedLine
 *   { start: 3, end: 6, text: "rld" },   // 第 2 个 WrappedLine
 * ]
 */
type WrappedLine = {
  // 这一行在原始文本 text 中的起始位置（offset 索引）
  start: number;
  // 这一行在原始文本 text 中的结束位置（offset 索引，开区间）
  end: number;
  // 这一行要显示的内容（text.slice(start, end)）
  text: string;
};

/**
 * 定义编辑器光标位置
 * line行 和 column列 都是从 0 开始的
 * - column 不是「第几个字符」，而是「第几列（显示宽度）」
 * - 「第几个字」用于对文本操作，「第几格」用于屏幕上画。
 */
export type EditorPosition = {
  line: number;
  column: number;
};

// 返回按“用户眼里的字符”分割的文本小切片数组
const graphemes = (text: string): TextSegment[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text));

// 返回按“用户眼里的词”分割的文本小切片数组
const wordSegments = (text: string): TextSegment[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(text));

/**
 * 把一个数值限制在 [min, max] 区间内
 * Math.min(value, max)封顶
 * - 先与大的比 比max大就取小的
 * Math.max(min, value)封底
 * - 再与小的比 比min小就取大的
 */
const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

/**
 * 1. 把 \r\n（CRLF，Windows 风格）替换成 \n（LF，Unix 风格）
 * 2. 把 \r（CR，Mac 风格）替换成 \n（LF，Unix 风格）
 */
const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

// 重置前景色为默认
const ANSI_FG_RESET = "\u001B[39m";

/**
 * 反色块：交换前景/背景色。传一个前景色码时，色块以该颜色的反色呈现。
 * 例：蓝色前景 + 反色 → 显示为蓝色背景的块。
 */
const invert = (text: string, fgCode = ""): string =>
  `${fgCode}\u001B[7m${text}\u001B[27m${ANSI_FG_RESET}`;

/**
 * 调用时机：
 *  - 每次按键（改变内容/光标）时
 *  - 每次渲染时 —— selectInputBoxView
 */
export class TextCursor {
  /**
   * 文本按屏幕宽度换行后的"显示行"
   * 把文本按照 columns（终端宽度）换行之后的每一行
   */
  private readonly lines: WrappedLine[];
  /**
   * 可停靠的光标位置点
   * 升序排序的数字数组，表示光标允许停靠的所有offset位置。
   * 数字数组表示字素的边界
   */
  private readonly boundaries: number[];

  /**
   * 
   * @param text 原始文本（全量）
   * @param columns 输入框可用宽度
   * @param offset 光标在当前原始文本 text 中的位置（字符下标，从 0 开始）。
   */
  private constructor(
    readonly text: string,
    private readonly columns: number,
    readonly offset: number,
  ) {
    this.columns = Math.max(1, columns);
    this.boundaries = this.createBoundaries();
    this.offset = this.snap(clamp(offset, 0, text.length));
    this.lines = this.wrapText();
  }

  // 省略 offset 时，光标自动停在文本末尾（最常见的「新光标」位置）
  static fromText(text: string, columns: number, offset = text.length): TextCursor {
    return new TextCursor(text, columns, offset);
  }

  // 获取光标的当前位置(横纵坐标)
  getPosition(): EditorPosition {
    // 光标当前在第几行
    const line = this.lineForOffset(this.offset);
    return {
      line,
      /**
       * 把「行首到光标之间」的文本切片，量出它的显示宽度
       * 
       * 行首的下标this.lines[line]!.start
       * 光标的下标this.offset
       * 截取他们的文本，stringWidth量出它的显示宽度 就是光标应该在的横坐标
       */
      column: stringWidth(this.text.slice(this.lines[line]!.start, this.offset)),
    };
  }

  getLineCount(): number {
    return this.lines.length;
  }

  // 返回 行数据数组添加换行符
  getRenderedText(): string {
    return this.lines.map((line) => line.text).join("\n");
  }

  /**
   * 反色字符渲染：把光标位置的字符用反色标记出来
   * 与物理光标不同，这里光标是"文本里一个被反色的字符"，靠 Ink 的 diff 渲染移动
   * @param cursorChar 光标停在行尾/空行时用于代表光标的反色字符
   * @param fgCode 前景色 ANSI 码，色块以该颜色的反色呈现；不传则用默认反色
   * @returns {string} 每行已换行、光标所在位置被反色的渲染文本
   */
  renderWithCursor(cursorChar = " ", fgCode = ""): string {
    const { line, column } = this.getPosition();
    return this.lines
      .map((wrapped, index) =>
        renderCursorLine({ text: wrapped.text, index, line, column, cursorChar, fgCode }),
      )
      .join("\n");
  }

  /**
   * 插入文本
   * @param input 用户输入的字符
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示用户输入后的光标位置
   */
  insert(input: string): TextCursor {
    // 统一换行符为/n
    const normalized = normalizeNewlines(input);
    // 光标把文本切成左右两半，新文本塞进中间
    const text =
      this.text.slice(0, this.offset) + normalized + this.text.slice(this.offset);

    // 返回一个新的 TextCursor 实例，表示用户输入后的光标位置
    return this.next(text, this.offset + normalized.length);
  }

  /**
   * 光标向左移动
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示移动后的光标位置
   */
  left(): TextCursor {
    return this.next(this.text, this.previousBoundary(this.offset));
  }

  /**
   * 光标向右移动
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示移动后的光标位置
   */
  right(): TextCursor {
    return this.next(this.text, this.nextBoundary(this.offset));
  }

  /**
   * 光标向上移动
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示移动后的光标位置
   */
  up(): TextCursor {
    const position = this.getPosition();
    return this.moveToPosition(position.line - 1, position.column);
  }

  /**
   * 光标向下移动
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示移动后的光标位置
   */
  down(): TextCursor {
    const position = this.getPosition();
    return this.moveToPosition(position.line + 1, position.column);
  }

  /**
   * 光标移动到行首
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示移动后的光标位置
   */
  startOfLine(): TextCursor {
    return this.next(this.text, this.lines[this.lineForOffset(this.offset)]!.start);
  }

  /**
   * 光标移动到行尾
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示移动后的光标位置
   */
  endOfLine(): TextCursor {
    return this.next(this.text, this.lines[this.lineForOffset(this.offset)]!.end);
  }

  /**
   * 光标移动到上一个单词的开头
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示移动后的光标位置
   */
  prevWord(): TextCursor {
    return this.next(this.text, this.findPreviousWordStart());
  }

  /**
   * 光标移动到下一个单词的开头
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示移动后的光标位置
   */
  nextWord(): TextCursor {
    return this.next(this.text, this.findNextWordStart());
  }

  /**
   * 光标向左删除一个字符
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示删除后的光标位置
   */
  backspace(): TextCursor {
    // 在开头就不删除 返回当前这个TextCursor实例
    if (this.offset === 0) return this;
    // 定位上一个光标可以停靠的位置
    const start = this.previousBoundary(this.offset);
    // [0, start) 前一个光标可停靠位置的左边 然后 [start, this.offset) 光标右边 丢掉了中间那个字符
    return this.next(this.text.slice(0, start) + this.text.slice(this.offset), start);
  }

  /**
   * 光标向右删除一个字符
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示删除后的光标位置
   */
  deleteForward(): TextCursor {
    // 在结尾就不删除 返回当前这个TextCursor实例
    if (this.offset >= this.text.length) return this;
    // 定位下一个光标可以停靠的位置
    const end = this.nextBoundary(this.offset);
    // [0, this.offset) 光标左边 然后 [end, this.text.length) 下一个停靠点的右边 丢掉了中间那个字符
    return this.next(this.text.slice(0, this.offset) + this.text.slice(end), this.offset);
  }

  /**
   * 光标向左删除一个单词
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示删除后的光标位置
   */
  deleteWordBefore(): TextCursor {
    // 找「前一个词的起点」
    const start = this.findPreviousWordStart();
    // [0, start) 前一个词的左边 然后 [start, this.offset) 光标右边 丢掉了中间那个单词
    return this.next(this.text.slice(0, start) + this.text.slice(this.offset), start);
  }

  /**
   * 光标向右删除一个单词
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示删除后的光标位置
   */
  deleteWordAfter(): TextCursor {
    const end = this.findNextWordEnd();
    return this.next(this.text.slice(0, this.offset) + this.text.slice(end), this.offset);
  }

  /**
   * 光标向左删除到行首
   * @returns {TextCursor} 返回一个新的 TextCursor 实例，表示删除后的光标位置
   */
  deleteToLineStart(): TextCursor {
    // 根据 offset（原始文本里的字符下标），反推出它落在哪一行，拿到行起点的坐标
    const start = this.lines[this.lineForOffset(this.offset)]!.start;
    // 丢掉中间的部分
    return this.next(this.text.slice(0, start) + this.text.slice(this.offset), start);
  }

  deleteToLineEnd(): TextCursor {
    const end = this.lines[this.lineForOffset(this.offset)]!.end;
    return this.next(this.text.slice(0, this.offset) + this.text.slice(end), this.offset);
  }

  /**
   * 终点，不管什么操作，最后都汇集到next
   * 拿着（新文本, 新光标位置）去 new 一个全新的 TextCursor 返回
   * 
   */
  private next(text: string, offset: number): TextCursor {
    return new TextCursor(text, this.columns, offset);
  }

  // 收集文本中所有"光标可以合法停靠"的位置，返回一个升序数组
  private createBoundaries(): number[] {
    // 放开头和结尾
    const values = new Set([0, this.text.length]);
    for (const segment of graphemes(this.text)) {
      values.add(segment.index);
      values.add(segment.index + segment.segment.length);
    }
    return Array.from(values).sort((left, right) => left - right);
  }

  /**
   * 某个值靠近一个「刻度」时，自动被吸附到最近的刻度上
   * 把 offset 吸附（钳制）到边界上，向下取整
   * 
   * 从第一个开始对比所有可用边界列表，比他小就赋值result，比他大就跳出循环然后返回最近那个小的。
   */
  private snap(offset: number): number {
    let result = 0;
    for (const boundary of this.boundaries) {
      if (boundary > offset) break;
      result = boundary;
    }
    return result;
  }

  /**
   * 
   * @param offset 
   * @returns {number} 上一个光标可停靠边界
   */
  private previousBoundary(offset: number): number {
    let result = 0;
    for (const boundary of this.boundaries) {
       // 升序，遇到第一个不小于 offset 即越过答案
      if (boundary >= offset) break;
      // 上一个位置就是上一个边界
      result = boundary;
    }
    return result;
  }

  // 返回 offset 右侧最近的"可停靠边界"。
  private nextBoundary(offset: number): number {
    // 找第一个严格大于 offset 的即右侧最近停靠点 没有就是末尾了返回兜底的文本末尾索引
    return this.boundaries.find((boundary) => boundary > offset) ?? this.text.length;
  }

  /**
   * 把一整段原始文本按照终端（输入框）的屏幕宽度 columns 自动换行，拆分成一个"显示行"列表。
   */
  private wrapText(): WrappedLine[] {
    const lines: WrappedLine[] = [];
    // 当前行的起始下标游标指针（在原始文本中的位置）
    let lineStart = 0;
    // 当前行已累计的显示宽度（像素意义上的列数，不是字符数）
    let lineWidth = 0;

    // 循环每一个字素（Unicode 层面的最小显示单元）
    for (const part of graphemes(this.text)) {

      if (part.segment === "\n") {
        // 遇到\n了，收尾成一行存入lines
        lines.push(this.makeLine(lineStart, part.index));
        // 移动指针到末尾
        lineStart = part.index + part.segment.length;
        lineWidth = 0;
        continue;
      }

      // 获取当前字符的像素宽度 example："中文" .length=2 stringWidth=4
      const width = stringWidth(part.segment);
      if (lineWidth > 0 && lineWidth + width > this.columns) {
        // 当前行已有字符，且加上当前字符的宽度超出终端宽度，则收尾成一行存入lines
        lines.push(this.makeLine(lineStart, part.index));
        lineStart = part.index;
        lineWidth = 0;
      }

      // 否则，当前字符宽度加到当前行已累计宽度上
      lineWidth += width;
    }

    // 最后一行收尾存入lines
    lines.push(this.makeLine(lineStart, this.text.length));
    return lines;
  }

  /**
   * 行构造器 
   * 给他开头坐标、结束坐标，他自己去拿用户输入的所有this.text，然后把这段文本切割出来，然后返回一个"显示行"对象
   * @param start 起始下标（在原始文本中的位置）
   * @param end 结束下标（在原始文本中的位置）
   * @returns {WrappedLine} 一个"显示行"对象
   */ 
  private makeLine(start: number, end: number): WrappedLine {
    return { start, end, text: this.text.slice(start, end) };
  }

  /**
   * 根据 offset（原始文本里的字符下标），反推出它落在哪一行
   * 后续可做二分查找优化
   * @returns {number} 从 0 开始的视觉行下标
   */
  private lineForOffset(offset: number): number {
    for (let index = this.lines.length - 1; index >= 0; index--) {
      // 如果offset大于等于当前行的起始下标，说明在这一行，则返回当前行下标
      if (offset >= this.lines[index]!.start) return index;
    }
    return 0;
  }

  /**
   * 光标向上移动
   * 给定目标行 + 目标列，光标应该落在原文的哪个 offset？
   */
  private moveToPosition(line: number, column: number): TextCursor {
    // 如果目标行超出范围，则取边界值
    const targetLine = this.lines[clamp(line, 0, this.lines.length - 1)]!;
    return this.next(this.text, this.offsetAtColumn(targetLine, column));
  }

  /**
   * 这一行里，光标停在『第 column 列』时，应该对应原文的哪个 offset？
   * 已知这一行，已知列数，求offset
   */
  private offsetAtColumn(line: WrappedLine, column: number): number {
    let width = 0;
    for (const part of graphemes(line.text)) {
      // nextWidth 是当前字素的结尾列；若结尾已超过目标列，则停在这个字素的开头（= 上个字素的右边界）
      const nextWidth = width + stringWidth(part.segment);
      if (nextWidth > column) return line.start + part.index;
      width = nextWidth;
    }
    return line.end;
  }

  /**
   * 找「前一个词的起点」
   * @returns {number} 字符下标（offset）
   */
  private findPreviousWordStart(): number {
    let previous = 0;// 兜底：光标已在最前/无更早词时，停在文本起点
    for (const word of wordSegments(this.text)) {
      if (!word.isWordLike) continue;// 跳过非词（空格、标点等），跳词只认"词"
      const end = word.index + word.segment.length;
      if (this.offset > word.index && this.offset <= end) return word.index;// 光标在本词内：跳到本词词首
      if (word.index < this.offset) previous = word.index;// 本词整体在光标左边：暂记为更早候选
    }
    return previous;
  }

  /**
   * 找「后一个词的起点」
   * @returns {number} 后一个词的起始字符下标（offset）
   */
  private findNextWordStart(): number {
    for (const word of wordSegments(this.text)) {
      // 遍历所以词，如果这个词在光标右边，则返回这个词的起点
      if (word.isWordLike && word.index > this.offset) return word.index;
    }
    // 兜底循环完都没找到，说明光标在最后/无更晚词时，停在文本末尾
    return this.text.length;
  }

  /**
   * 找「后一个词的终点」
   * @returns {number} 后一个词的结束字符下标（offset）
   */
  private findNextWordEnd(): number {
    for (const word of wordSegments(this.text)) {
      // 当前词结束位置的下标 开头位置+词长度
      const end = word.index + word.segment.length;
      // 结束下标大于当前光标位置，则返回这个词的结束位置下标
      if (word.isWordLike && end > this.offset) return end;
    }
    return this.text.length;
  }
}

interface CursorLineInput {
  text: string;
  index: number;
  line: number;
  column: number;
  cursorChar: string;
  fgCode: string;
}

interface CursorTarget {
  charIndex: number;
  segment: string;
}

function renderCursorLine(input: CursorLineInput): string {
  if (input.index !== input.line) return input.text.trimEnd();
  const target = findCursorTarget(input.text, input.column);
  return target
    ? renderInvertedTarget(input.text, target, input.fgCode)
    : (input.text + invert(input.cursorChar, input.fgCode)).trimEnd();
}

function findCursorTarget(text: string, column: number): CursorTarget | null {
  let width = 0;
  let charIndex = 0;
  for (const part of graphemes(text)) {
    const nextWidth = width + stringWidth(part.segment);
    if (nextWidth > column) return { charIndex, segment: part.segment };
    width = nextWidth;
    charIndex += part.segment.length;
  }
  return null;
}

function renderInvertedTarget(text: string, target: CursorTarget, fgCode: string): string {
  const before = text.slice(0, target.charIndex);
  const after = text.slice(target.charIndex + target.segment.length);
  return (before + invert(target.segment, fgCode) + after).trimEnd();
}
