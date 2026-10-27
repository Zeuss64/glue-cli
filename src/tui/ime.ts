import { displayWidth } from "./text.js";

/**
 * Cell where the real terminal cursor should sit so a Windows IME draws its
 * composition string and candidate window inside the input box.
 *
 * The IME anchors to the console cursor, not to Ink's inverse block. After
 * each paint Ink leaves the cursor at the end of the frame (bottom-left),
 * which is why pinyin showed up outside the border. After every stdout write
 * we save that position, CUP onto this cell, and hide the hardware cursor.
 * Windows Terminal (and other VT hosts) attach preedit/candidates to the
 * cursor position even while the glyph is hidden, so only the inverse block
 * blinks. The saved position is restored before the next paint.
 *
 * Residual limits: some conhost builds ignore CUP and keep the candidate
 * window on the window edge. Glue cannot place the IME overlay anywhere
 * except the console cursor.
 */

/**
 * Rows under the input. The built-in footer is the mode line only.
 * Each non-blank custom status line adds one row above that.
 */
export function statusAreaRows(customLines: readonly string[]): number {
  let extra = 0;
  for (const line of customLines) {
    if (line.trim()) extra += 1;
  }
  return 1 + extra;
}

export function imeAnchor(opts: {
  frameRows: number;
  frameCols: number;
  text: string;
  cursor: number;
  /** Built-in footer plus custom status-line rows under the input. Default 1. */
  statusRows?: number;
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
  const statusRows = Math.max(1, Math.floor(opts.statusRows ?? 1));
  // Status area, then the input's bottom border, then the caret line.
  const row = clamp(rows - statusRows - 1 - linesBelowCaret, 1, rows);
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
