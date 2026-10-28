import { displayWidth } from "./text.js";

/**
 * Cell where the real terminal cursor should sit so a Windows IME draws its
 * composition string and candidate window inside the input box.
 *
 * The IME anchors to the console cursor, not to Ink's inverse block. After
 * each paint Ink leaves the cursor at the end of the frame (bottom-left),
 * which is why pinyin showed up outside the border. Each stdout write restores
 * that saved position, draws the frame, then CUPs onto this cell and hides the
 * hardware cursor, as one sequence. Windows Terminal (and other VT hosts)
 * attach preedit/candidates to the cursor position even while the glyph is
 * hidden. The caret stays solid so that sequence is not repeated on an idle timer.
 *
 * Residual limits: some conhost builds ignore CUP and keep the candidate
 * window on the window edge. Glue cannot place the IME overlay anywhere
 * except the console cursor.
 */

/**
 * Rows under the input. `footerRows` is the wrapped built-in status bar
 * (one row when the line fits, more when a narrow terminal wraps it).
 * Each non-blank custom status line adds one row above that.
 */
export function statusAreaRows(customLines: readonly string[], footerRows = 1): number {
  let extra = 0;
  for (const line of customLines) {
    if (line.trim()) extra += 1;
  }
  const footer = Number.isFinite(footerRows) ? Math.max(1, Math.floor(footerRows)) : 1;
  return footer + extra;
}

/**
 * Visual rows of one status-bar line at `columns`.
 * Hard-wraps on spaces the way Ink wraps a single `Text` (`wrap-ansi` hard, no trim),
 * so a narrow footer that spills onto a second row moves the IME anchor up with it.
 */
export function wrappedRowCount(text: string, columns: number): number {
  const lines = text.split("\n");
  let total = 0;
  for (const line of lines) total += wrapPlainLine(line, columns).length;
  return Math.max(1, total);
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

function wrapPlainLine(text: string, columns: number): string[] {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const words = text.split(" ");
  const lengths = words.map((word) => displayWidth(word));
  const rows: string[] = [""];
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    const len = lengths[index] ?? 0;
    let rowLength = displayWidth(rows[rows.length - 1] ?? "");
    if (index !== 0) {
      if (rowLength >= cols) {
        rows.push("");
        rowLength = 0;
      }
      rows[rows.length - 1] = `${rows[rows.length - 1] ?? ""} `;
      rowLength += 1;
    }
    if (len > cols) {
      const remaining = cols - rowLength;
      const breaksStartingThisLine = 1 + Math.floor((len - remaining - 1) / cols);
      const breaksStartingNextLine = Math.floor((len - 1) / cols);
      if (breaksStartingNextLine < breaksStartingThisLine) rows.push("");
      wrapHardWord(rows, word, cols);
      continue;
    }
    if (rowLength + len > cols && rowLength > 0 && len > 0) rows.push("");
    rows[rows.length - 1] = `${rows[rows.length - 1] ?? ""}${word}`;
  }
  return rows.length ? rows : [""];
}

function wrapHardWord(rows: string[], word: string, columns: number): void {
  const characters = [...word];
  let visible = displayWidth(rows[rows.length - 1] ?? "");
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index] ?? "";
    const characterLength = displayWidth(character);
    if (visible + characterLength <= columns) {
      rows[rows.length - 1] = `${rows[rows.length - 1] ?? ""}${character}`;
    } else {
      rows.push(character);
      visible = 0;
    }
    visible += characterLength;
    if (visible === columns && index < characters.length - 1) {
      rows.push("");
      visible = 0;
    }
  }
}
