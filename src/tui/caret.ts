import { nextGrapheme, snapGrapheme } from "./text.js";

/** Even ticks show the block. Typing resets the tick so the caret is visible. */
export function caretVisible(tick: number): boolean {
  return tick % 2 === 0;
}

/**
 * Placeholder and caret while an IME composition may own the caret cell.
 * The placeholder is only for a truly empty buffer that is not composing.
 * A composition is the only glyph at the caret: the inverse block does not blink on top of it.
 * An empty buffer keeps a steady caret (no timer) so a repaint does not wipe the IME string.
 */
export function promptCaretMode(text: string, preedit = ""): "compose" | "steady" | "blink" {
  if (preedit.length > 0) return "compose";
  if (text.length === 0) return "steady";
  return "blink";
}

export function showPromptPlaceholder(text: string, preedit = "", placeholder?: string): boolean {
  return text.length === 0 && preedit.length === 0 && Boolean(placeholder);
}

export interface PromptSegment {
  text: string;
  inverse: boolean;
}

export function promptSegments(text: string, cursor: number, anchor: number | null, tick: number): PromptSegment[] {
  const on = caretVisible(tick);
  const caret = clamp(cursor, text.length);
  const mark = anchor == null ? caret : clamp(anchor, text.length);
  const start = Math.min(caret, mark);
  const end = Math.max(caret, mark);
  if (start !== end) {
    return compact([
      { text: text.slice(0, start), inverse: false },
      { text: text.slice(start, end), inverse: true },
      { text: text.slice(end), inverse: false },
    ]);
  }
  const origin = snapGrapheme(text, caret);
  const graphemeEnd = caret >= text.length ? caret : nextGrapheme(text, origin);
  const ch = graphemeEnd > origin ? text.slice(origin, graphemeEnd) : " ";
  return compact([
    { text: text.slice(0, origin), inverse: false },
    { text: ch, inverse: on },
    { text: text.slice(Math.max(graphemeEnd, caret)), inverse: false },
  ]);
}

function compact(parts: PromptSegment[]): PromptSegment[] {
  return parts.filter((part) => part.text.length > 0);
}

function clamp(value: number, length: number): number {
  return Math.max(0, Math.min(length, value));
}
