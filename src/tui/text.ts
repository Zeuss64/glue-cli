const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface Grapheme {
  start: number;
  end: number;
  segment: string;
}

export function graphemes(text: string): Grapheme[] {
  const out: Grapheme[] = [];
  for (const part of segmenter.segment(text)) {
    out.push({ start: part.index, end: part.index + part.segment.length, segment: part.segment });
  }
  return out;
}

/** Start of the grapheme that contains `cursor`, or `cursor` when it is on a boundary. */
export function snapGrapheme(text: string, cursor: number): number {
  const at = Math.max(0, Math.min(text.length, cursor));
  let prev = 0;
  for (const part of segmenter.segment(text)) {
    if (part.index === at) return at;
    if (part.index > at) return prev;
    prev = part.index;
  }
  return at;
}

/** Start of the grapheme before `cursor`. A cursor inside a grapheme returns that grapheme's start. */
export function prevGrapheme(text: string, cursor: number): number {
  const at = Math.max(0, Math.min(text.length, cursor));
  if (at === 0) return 0;
  let prev = 0;
  for (const part of segmenter.segment(text)) {
    if (part.index >= at) return prev;
    prev = part.index;
  }
  return prev;
}

/** End of the grapheme that contains `cursor`, or the next one when `cursor` is on a boundary. */
export function nextGrapheme(text: string, cursor: number): number {
  const at = Math.max(0, Math.min(text.length, cursor));
  for (const part of segmenter.segment(text)) {
    if (part.index + part.segment.length > at) return part.index + part.segment.length;
  }
  return text.length;
}

const WIDE: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

function isWide(codePoint: number): boolean {
  if (codePoint >= 0x1f000 && codePoint <= 0x1ffff) return true;
  return WIDE.some(([start, end]) => codePoint >= start && codePoint <= end);
}

function isIgnorable(codePoint: number): boolean {
  return codePoint === 0x200d || codePoint === 0xfe0f || codePoint === 0xfe0e || codePoint === 0x20e3;
}

/** Terminal columns for one grapheme. CJK and emoji take two. */
export function graphemeWidth(segment: string): number {
  let width = 0;
  let wide = false;
  for (const codePoint of codePoints(segment)) {
    if (codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) continue;
    if (isIgnorable(codePoint)) continue;
    wide = wide || isWide(codePoint);
    width = 1;
  }
  if (width === 0) return 0;
  return wide ? 2 : 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const part of graphemes(text)) width += graphemeWidth(part.segment);
  return width;
}

export function visualLines(text: string, columns: number): number {
  const width = Math.max(1, columns);
  if (!text) return 1;
  let lines = 0;
  for (const line of text.split("\n")) {
    const taken = displayWidth(line);
    lines += Math.max(1, Math.ceil(taken / width));
  }
  return lines;
}

/** Display columns `[startCol, startCol + maxCols)` of one logical line. A wide grapheme that straddles an edge is skipped. */
export function sliceColumns(text: string, startCol: number, maxCols: number): string {
  if (maxCols <= 0) return "";
  const end = Math.max(0, startCol) + maxCols;
  let col = 0;
  let out = "";
  for (const part of graphemes(text)) {
    const width = graphemeWidth(part.segment);
    if (col >= end) break;
    if (col >= startCol && (width === 0 || col + width <= end)) out += part.segment;
    col += width;
  }
  return out;
}

/**
 * Visual lines `[start, start + count)` after wrapping at `columns`.
 * The result is at most `count` visual lines, so it can be painted inside a viewport.
 */
export function sliceVisual(text: string, columns: number, start: number, count: number): string {
  if (count <= 0 || start < 0) return "";
  const width = Math.max(1, columns);
  const end = start + count;
  const kept: string[] = [];
  let index = 0;
  for (const line of text.split("\n")) {
    const wraps = Math.max(1, Math.ceil(displayWidth(line) / width) || 1);
    const lineStart = index;
    const lineEnd = index + wraps;
    index = lineEnd;
    if (lineEnd <= start) continue;
    if (lineStart >= end) break;
    const from = Math.max(lineStart, start);
    const to = Math.min(lineEnd, end);
    kept.push(sliceWrapped(line, width, from - lineStart, to - from));
  }
  return kept.join("\n");
}

function sliceWrapped(line: string, width: number, skipVisual: number, takeVisual: number): string {
  if (takeVisual <= 0) return "";
  return sliceColumns(line, skipVisual * width, takeVisual * width);
}

export function tailColumns(text: string, columns: number): string {
  if (columns <= 0) return "";
  const parts = graphemes(text);
  const kept: string[] = [];
  let used = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (!part) continue;
    const width = graphemeWidth(part.segment);
    if (used + width > columns) break;
    kept.push(part.segment);
    used += width;
  }
  return kept.reverse().join("");
}

/** Keep the last `maxLines` wrapped lines. A leading ellipsis marks a cut. */
export function tailText(text: string, maxLines: number, columns: number): string {
  if (maxLines <= 0) return "";
  if (visualLines(text, columns) <= maxLines) return text;
  const width = Math.max(1, columns);
  const kept: string[] = [];
  let used = 0;
  const parts = text.split("\n");
  for (let i = parts.length - 1; i >= 0 && used < maxLines; i--) {
    const line = parts[i] ?? "";
    const wraps = Math.max(1, Math.ceil(displayWidth(line) / width) || 1);
    const room = maxLines - used;
    if (wraps > room) {
      kept.push(tailColumns(line, room * width));
      used += room;
      break;
    }
    kept.push(line);
    used += wraps;
  }
  kept.reverse();
  while (kept.length > 0 && visualLines(["…", ...kept].join("\n"), columns) > maxLines) kept.shift();
  const body = kept.join("\n");
  return body ? `…\n${body}` : "…";
}

function codePoints(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i) ?? 0;
    out.push(codePoint);
    i += codePoint > 0xffff ? 2 : 1;
  }
  return out;
}
