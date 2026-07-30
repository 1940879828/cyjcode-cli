import stringWidth from "string-width";

type TextSegment = {
  segment: string;
  index: number;
  isWordLike?: boolean;
};

type SegmenterLike = {
  segment(input: string): Iterable<TextSegment>;
};

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: "grapheme" | "word" },
) => SegmenterLike;

type WrappedLine = {
  start: number;
  end: number;
  text: string;
};

export type EditorPosition = {
  line: number;
  column: number;
};

const getSegmenter = (granularity: "grapheme" | "word") => {
  const segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor })
    .Segmenter;
  return segmenter ? new segmenter(undefined, { granularity }) : undefined;
};

const fallbackGraphemes = (text: string): TextSegment[] => {
  const result: TextSegment[] = [];
  let index = 0;
  for (const segment of Array.from(text)) {
    result.push({ segment, index });
    index += segment.length;
  }
  return result;
};

const graphemes = (text: string): TextSegment[] => {
  const segmenter = getSegmenter("grapheme");
  return segmenter ? Array.from(segmenter.segment(text)) : fallbackGraphemes(text);
};

const wordSegments = (text: string): TextSegment[] => {
  const segmenter = getSegmenter("word");
  if (segmenter) return Array.from(segmenter.segment(text));

  const matches = text.matchAll(/\S+/gu);
  return Array.from(matches, (match) => ({
    segment: match[0],
    index: match.index,
    isWordLike: true,
  }));
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export class TextCursor {
  private readonly lines: WrappedLine[];
  private readonly boundaries: number[];

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
