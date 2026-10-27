import { displayWidth } from "./text.js";

/**
 * Cell where the real terminal cursor should sit so a Windows IME draws its
 * composition string and candidate window inside the input box.
 *
 * The IME anchors to the console cursor, not to Ink's inverse block. After
 * each paint the cursor is left at the end of the frame (bottom-left of the
 * window), which is why pinyin shows up outside the border. We move it onto
 * the caret cell and leave it hidden, so English still uses the drawn block.
 *
 * Residual limits: legacy conhost sometimes ignores the hidden cursor and
 * keeps the candidate window on the window edge. A repaint (the caret blink)
 * can hide the overlay until the IME draws it again. Glue cannot move the
 * candidate window independently of the host.
 */
export function imeAnchor(opts: {
  frameRows: number;
  frameCols: number;
  text: string;
  cursor: number;
}): { row: number; column: number } {
  const rows = Math.max(1, opts.frameRows);
  const cols = Math.max(1, opts.frameCols);
  const inner = Math.max(1, cols - 4);
  const at = Math.max(0, Math.min(opts.text.length, opts.cursor));
  const content = `> ${opts.text.slice(0, at)}`;
  const wrapped = wrapInput(content, inner);
  const lineIndex = Math.max(0, wrapped.length - 1);
  const lineWidth = displayWidth(wrapped[lineIndex] ?? "");
  const linesBelowCaret = wrapped.length - 1 - lineIndex;
  // Status row, then the input's bottom border, then the caret line.
  const row = clamp(rows - 2 - linesBelowCaret, 1, rows);
  // Left border + padding + the width already on this visual line + the caret cell.
  const column = clamp(1 + 1 + lineWidth + 1, 1, cols);
  return { row, column };
}

function wrapInput(text: string, columns: number): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let buf = "";
  let used = 0;
  for (const ch of [...text]) {
    const width = Math.max(1, displayWidth(ch));
    if (buf && used + width > columns) {
      lines.push(buf);
      buf = ch;
      used = width;
    } else {
      buf += ch;
      used += width;
    }
  }
  if (buf) lines.push(buf);
  return lines.length ? lines : [""];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
