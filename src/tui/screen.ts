/**
 * Visible-frame cleanup for resize and exit.
 *
 * Ink's log-update erases only the logical line count from the previous paint.
 * After a Windows resize those lines have wrapped or the window has grown, so
 * the old input border stays on screen (a second orange box, or chrome left
 * mid-window). `log.done()` on exit does not erase that frame either, so the
 * box sits on top of cmd's prompt.
 *
 * Erase the visible screen with CSI 2J and home the cursor. Do not send CSI 3J
 * (erase scrollback) and do not enter the alternate screen: that pair freezes
 * classic conhost. Leaving the alternate screen (`?1049l`) on exit is a no-op
 * when this process never entered it, and it drops a leftover alt buffer if a
 * host turned one on.
 */

/** Reset SGR, home, erase the visible screen, keep the cursor hidden for the next paint. */
export const RESIZE_REFLOW_SEQUENCE = "\x1b[0m\x1b[H\x1b[2J\x1b[?25l";

/**
 * Hand the terminal back to the shell.
 * Mouse tracking off, attributes reset, leave any alternate screen, erase the
 * leftover frame, show the cursor. Scrollback is left intact on purpose.
 */
export const RESTORE_TERMINAL_SEQUENCE = [
  "\x1b[?1000l",
  "\x1b[?1002l",
  "\x1b[?1003l",
  "\x1b[?1006l",
  "\x1b[?1007l",
  "\x1b[0m",
  "\x1b[?1049l",
  "\x1b[H\x1b[2J",
  "\x1b[?25h",
].join("");

/** SGR mouse (1006) plus normal tracking (1000) so the wheel can scroll the transcript. */
export const ENABLE_WHEEL_SEQUENCE = "\x1b[?1006h\x1b[?1000h";

export function placeCursorSequence(row: number, column: number): string {
  const r = Math.max(1, Math.floor(row));
  const c = Math.max(1, Math.floor(column));
  return `\x1b[${r};${c}H`;
}

/**
 * CUP onto the input caret and hide the hardware cursor.
 * IME/preedit follows the console cursor position. The glyph stays hidden so
 * it does not blink at the caret or at the bottom of the screen; the inverse
 * block in the input is the only visible caret.
 */
export function imeCursorSequence(row: number, column: number): string {
  return `${placeCursorSequence(row, column)}\x1b[?25l`;
}

/** Hide, remember the post-paint cursor, then CUP to the caret and hide again. */
export function imeParkSequence(row: number, column: number): string {
  return `\x1b[?25l\x1b7${imeCursorSequence(row, column)}`;
}

/**
 * Put the cursor back where the previous paint left it (end of the frame) and
 * keep it hidden. log-update erases upward from the current cursor; leaving
 * the cursor on the input caret makes that erase miss the orange border.
 */
export const IME_PARK_RESTORE = "\x1b8\x1b[?25l";

const IME_CURSOR_CHUNK = /^(?:\x1b\[\?25l)?(?:\x1b7)?\x1b\[\d+;\d+H\x1b\[\?25l$/;

export function isImeCursorChunk(chunk: unknown): boolean {
  const text = chunkToText(chunk);
  return Boolean(text) && IME_CURSOR_CHUNK.test(text);
}

/**
 * After Ink paints, the hardware cursor sits past the last frame cell (the
 * lower-left of the window). Showing it there is the ghost blink under the
 * input. Patch stdout.write so each paint is followed by a save + CUP onto
 * the input caret, with the hardware cursor kept hidden.
 *
 * The saved position is restored before the next write. log-update erases
 * relative to the cursor; skipping the restore leaves the previous orange
 * input border on screen (an empty bar under the prompt).
 */
export function attachImeCursorSync(
  stdout: { write: (...args: any[]) => any },
  getAnchor: () => { row: number; column: number } | null,
): () => void {
  type Write = (...args: any[]) => any;
  const original = stdout.write.bind(stdout) as Write;
  let scheduled = false;
  let active = true;
  let parked = false;

  const restorePark = () => {
    if (!parked) return;
    parked = false;
    try {
      (original as (chunk: string) => unknown)(IME_PARK_RESTORE);
    } catch {
      /* stdout may be closed while the process is exiting */
    }
  };

  const flush = () => {
    scheduled = false;
    if (!active) return;
    const anchor = getAnchor();
    try {
      if (!anchor) {
        restorePark();
        (original as (chunk: string) => unknown)("\x1b[?25l");
        return;
      }
      (original as (chunk: string) => unknown)(imeParkSequence(anchor.row, anchor.column));
      parked = true;
    } catch {
      /* stdout may be closed while the process is exiting */
    }
  };

  const schedule = () => {
    if (!active || scheduled) return;
    scheduled = true;
    queueMicrotask(flush);
  };

  stdout.write = ((...args: any[]) => {
    if (active && parked && !isImeCursorChunk(args[0])) restorePark();
    const result = original(...args);
    if (!isImeCursorChunk(args[0])) schedule();
    return result;
  }) as Write;

  schedule();

  return () => {
    active = false;
    restorePark();
    stdout.write = original;
  };
}

function chunkToText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return "";
}

type ClearInk = () => void;

let clearInk: ClearInk = () => {};

/** Register Ink's `instance.clear`, which resets log-update's line count. */
export function bindInkClear(fn: ClearInk | null): void {
  clearInk = fn ?? (() => {});
}

export function reflowTerminal(stdout: NodeJS.WriteStream): void {
  try {
    clearInk();
  } catch {
    /* Ink may already be unmounted. */
  }
  stdout.write(RESIZE_REFLOW_SEQUENCE);
}

export function restoreTerminal(stdout: NodeJS.WriteStream): void {
  try {
    clearInk();
  } catch {
    /* already unmounted */
  }
  stdout.write(RESTORE_TERMINAL_SEQUENCE);
}
