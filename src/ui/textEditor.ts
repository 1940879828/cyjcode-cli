import stringWidth from "string-width";

/**
 * 文本小切片：从一段文本里切出来的一个小块
 * 
 */
type TextSegment = {
  // 切出来的那一小段文本内容
  segment: string;
  // 这一小段在原始文本里的起始位置（下标）
  index: number;
  // 这一小段是不是"像词"的内容
  isWordLike?: boolean;
};

type SegmenterLike = {
  segment(input: string): Iterable<TextSegment>;
};

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: "grapheme" | "word" },
) => SegmenterLike;

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

export type EditorPosition = {
  line: number;
  column: number;
};

/**
 * 文本切分器。
 * Node 22+ 保证存在 Intl.Segmenter，直接使用。
 */
const createSegmenter = (granularity: "grapheme" | "word") => {
  const Segmenter = (Intl as typeof Intl & { Segmenter: SegmenterConstructor })
    .Segmenter;
  return new Segmenter(undefined, { granularity });
};

// 返回按“用户眼里的字符”分割的文本小切片数组
const graphemes = (text: string): TextSegment[] =>
  Array.from(createSegmenter("grapheme").segment(text));

// 返回按“用户眼里的词”分割的文本小切片数组
const wordSegments = (text: string): TextSegment[] =>
  Array.from(createSegmenter("word").segment(text));

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

  static fromText(text: string, columns: number, offset = text.length): TextCursor {
    return new TextCursor(text, columns, offset);
  }

  getPosition(): EditorPosition {
    const line = this.lineForOffset(this.offset);
    return {
      line,
      column: stringWidth(this.text.slice(this.lines[line]!.start, this.offset)),
    };
  }

  getRenderedText(): string {
    return this.lines.map((line) => line.text).join("\n");
  }

  insert(input: string): TextCursor {
    const normalized = normalizeNewlines(input);
    const text =
      this.text.slice(0, this.offset) + normalized + this.text.slice(this.offset);
    return this.next(text, this.offset + normalized.length);
  }

  left(): TextCursor {
    return this.next(this.text, this.previousBoundary(this.offset));
  }

  right(): TextCursor {
    return this.next(this.text, this.nextBoundary(this.offset));
  }

  up(): TextCursor {
    const position = this.getPosition();
    return this.moveToPosition(position.line - 1, position.column);
  }

  down(): TextCursor {
    const position = this.getPosition();
    return this.moveToPosition(position.line + 1, position.column);
  }

  startOfLine(): TextCursor {
    return this.next(this.text, this.lines[this.lineForOffset(this.offset)]!.start);
  }

  endOfLine(): TextCursor {
    return this.next(this.text, this.lines[this.lineForOffset(this.offset)]!.end);
  }

  prevWord(): TextCursor {
    return this.next(this.text, this.findPreviousWordStart());
  }

  nextWord(): TextCursor {
    return this.next(this.text, this.findNextWordStart());
  }

  backspace(): TextCursor {
    if (this.offset === 0) return this;
    const start = this.previousBoundary(this.offset);
    return this.next(this.text.slice(0, start) + this.text.slice(this.offset), start);
  }

  deleteForward(): TextCursor {
    if (this.offset >= this.text.length) return this;
    const end = this.nextBoundary(this.offset);
    return this.next(this.text.slice(0, this.offset) + this.text.slice(end), this.offset);
  }

  deleteWordBefore(): TextCursor {
    const start = this.findPreviousWordStart();
    return this.next(this.text.slice(0, start) + this.text.slice(this.offset), start);
  }

  deleteWordAfter(): TextCursor {
    const end = this.findNextWordEnd();
    return this.next(this.text.slice(0, this.offset) + this.text.slice(end), this.offset);
  }

  deleteToLineStart(): TextCursor {
    const start = this.lines[this.lineForOffset(this.offset)]!.start;
    return this.next(this.text.slice(0, start) + this.text.slice(this.offset), start);
  }

  deleteToLineEnd(): TextCursor {
    const end = this.lines[this.lineForOffset(this.offset)]!.end;
    return this.next(this.text.slice(0, this.offset) + this.text.slice(end), this.offset);
  }

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

  private previousBoundary(offset: number): number {
    let result = 0;
    for (const boundary of this.boundaries) {
      if (boundary >= offset) break;
      result = boundary;
    }
    return result;
  }

  private nextBoundary(offset: number): number {
    return this.boundaries.find((boundary) => boundary > offset) ?? this.text.length;
  }

  /**
   * 把一整段原始文本按照终端（输入框）的屏幕宽度 columns 自动换行，拆分成一个"显示行"列表。
   */
  private wrapText(): WrappedLine[] {
    const lines: WrappedLine[] = [];
    let lineStart = 0;
    let lineWidth = 0;

    for (const part of graphemes(this.text)) {
      if (part.segment === "\n") {
        lines.push(this.makeLine(lineStart, part.index));
        lineStart = part.index + part.segment.length;
        lineWidth = 0;
        continue;
      }

      const width = stringWidth(part.segment);
      if (lineWidth > 0 && lineWidth + width > this.columns) {
        lines.push(this.makeLine(lineStart, part.index));
        lineStart = part.index;
        lineWidth = 0;
      }
      lineWidth += width;
    }

    lines.push(this.makeLine(lineStart, this.text.length));
    return lines;
  }

  private makeLine(start: number, end: number): WrappedLine {
    return { start, end, text: this.text.slice(start, end) };
  }

  private lineForOffset(offset: number): number {
    for (let index = this.lines.length - 1; index >= 0; index--) {
      if (offset >= this.lines[index]!.start) return index;
    }
    return 0;
  }

  private moveToPosition(line: number, column: number): TextCursor {
    const targetLine = this.lines[clamp(line, 0, this.lines.length - 1)]!;
    return this.next(this.text, this.offsetAtColumn(targetLine, column));
  }

  private offsetAtColumn(line: WrappedLine, column: number): number {
    let width = 0;
    for (const part of graphemes(line.text)) {
      const nextWidth = width + stringWidth(part.segment);
      if (nextWidth > column) return line.start + part.index;
      width = nextWidth;
    }
    return line.end;
  }

  private findPreviousWordStart(): number {
    let previous = 0;
    for (const word of wordSegments(this.text)) {
      if (!word.isWordLike) continue;
      const end = word.index + word.segment.length;
      if (this.offset > word.index && this.offset <= end) return word.index;
      if (word.index < this.offset) previous = word.index;
    }
    return previous;
  }

  private findNextWordStart(): number {
    for (const word of wordSegments(this.text)) {
      if (word.isWordLike && word.index > this.offset) return word.index;
    }
    return this.text.length;
  }

  private findNextWordEnd(): number {
    for (const word of wordSegments(this.text)) {
      const end = word.index + word.segment.length;
      if (word.isWordLike && end > this.offset) return end;
    }
    return this.text.length;
  }
}
