import stringWidth from "string-width";

type TextSegment = Omit<Intl.SegmentData, "input"> & { isWordLike?: boolean };

type VisualLine = {
  startOffset: number;
  endOffset: number;
  text: string;
};

export type EditorPosition = {
  visualLine: number;
  column: number;
};

const graphemes = (text: string): TextSegment[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text));

const wordSegments = (text: string): TextSegment[] =>
  Array.from(new Intl.Segmenter(undefined, { granularity: "word" }).segment(text));

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const ANSI_FG_RESET = "\u001B[39m";

// 反色块依赖 ANSI 交换前景/背景色；前景色码会变成色块背景。
const invert = (text: string, fgCode = ""): string =>
  `${fgCode}\u001B[7m${text}\u001B[27m${ANSI_FG_RESET}`;

export class TextCursor {
  private readonly visualLines: VisualLine[];
  private readonly boundaries: number[];

  private constructor(
    readonly text: string,
    private readonly columns: number,
    readonly offset: number,
  ) {
    this.columns = Math.max(1, columns);
    this.boundaries = this.createBoundaries();
    this.offset = this.snap(clamp(offset, 0, text.length));
    this.visualLines = this.wrapText();
  }

  static fromText(text: string, columns: number, offset = text.length): TextCursor {
    return new TextCursor(text, columns, offset);
  }

  getPosition(): EditorPosition {
    const visualLine = this.visualLineForOffset(this.offset);
    return {
      visualLine,
      column: stringWidth(
        this.text.slice(this.visualLines[visualLine]!.startOffset, this.offset),
      ),
    };
  }

  getLineCount(): number {
    return this.visualLines.length;
  }

  getRenderedText(): string {
    return this.visualLines.map((visualLine) => visualLine.text).join("\n");
  }

  // 这里渲染的是文本内反色字符，不依赖终端物理光标。
  renderWithCursor(cursorChar = " ", fgCode = ""): string {
    const { visualLine, column } = this.getPosition();
    return this.visualLines
      .map((wrapped, index) =>
        renderCursorLine({ text: wrapped.text, index, visualLine, column, cursorChar, fgCode }),
      )
      .join("\n");
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
    return this.moveToPosition(position.visualLine - 1, position.column);
  }

  down(): TextCursor {
    const position = this.getPosition();
    return this.moveToPosition(position.visualLine + 1, position.column);
  }

  startOfLine(): TextCursor {
    return this.next(this.text, this.currentVisualLine().startOffset);
  }

  endOfLine(): TextCursor {
    return this.next(this.text, this.currentVisualLine().endOffset);
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
    const start = this.currentVisualLine().startOffset;
    return this.next(this.text.slice(0, start) + this.text.slice(this.offset), start);
  }

  deleteToLineEnd(): TextCursor {
    const end = this.currentVisualLine().endOffset;
    return this.next(this.text.slice(0, this.offset) + this.text.slice(end), this.offset);
  }

  private next(text: string, offset: number): TextCursor {
    return new TextCursor(text, this.columns, offset);
  }

  private createBoundaries(): number[] {
    const values = new Set([0, this.text.length]);
    for (const segment of graphemes(this.text)) {
      values.add(segment.index);
      values.add(segment.index + segment.segment.length);
    }
    return Array.from(values).sort((left, right) => left - right);
  }

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

  private wrapText(): VisualLine[] {
    const visualLines: VisualLine[] = [];
    let lineStartOffset = 0;
    let lineColumnWidth = 0;

    for (const part of graphemes(this.text)) {
      if (part.segment === "\n") {
        visualLines.push(this.makeLine(lineStartOffset, part.index));
        lineStartOffset = part.index + part.segment.length;
        lineColumnWidth = 0;
        continue;
      }

      const width = stringWidth(part.segment);
      if (lineColumnWidth > 0 && lineColumnWidth + width > this.columns) {
        visualLines.push(this.makeLine(lineStartOffset, part.index));
        lineStartOffset = part.index;
        lineColumnWidth = 0;
      }

      lineColumnWidth += width;
    }

    visualLines.push(this.makeLine(lineStartOffset, this.text.length));
    return visualLines;
  }

  private makeLine(startOffset: number, endOffset: number): VisualLine {
    return {
      startOffset,
      endOffset,
      text: this.text.slice(startOffset, endOffset),
    };
  }

  private visualLineForOffset(offset: number): number {
    for (let index = this.visualLines.length - 1; index >= 0; index--) {
      if (offset >= this.visualLines[index]!.startOffset) return index;
    }
    return 0;
  }

  private currentVisualLine(): VisualLine {
    return this.visualLines[this.visualLineForOffset(this.offset)]!;
  }

  private moveToPosition(visualLine: number, column: number): TextCursor {
    const targetLine = this.visualLines[
      clamp(visualLine, 0, this.visualLines.length - 1)
    ]!;
    return this.next(this.text, this.offsetAtColumn(targetLine, column));
  }

  private offsetAtColumn(visualLine: VisualLine, column: number): number {
    let width = 0;
    for (const part of graphemes(visualLine.text)) {
      const nextWidth = width + stringWidth(part.segment);
      if (nextWidth > column) return visualLine.startOffset + part.index;
      width = nextWidth;
    }
    return visualLine.endOffset;
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

interface CursorLineInput {
  text: string;
  index: number;
  visualLine: number;
  column: number;
  cursorChar: string;
  fgCode: string;
}

interface CursorTarget {
  charIndex: number;
  segment: string;
}

function renderCursorLine(input: CursorLineInput): string {
  if (input.index !== input.visualLine) return input.text.trimEnd();
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
