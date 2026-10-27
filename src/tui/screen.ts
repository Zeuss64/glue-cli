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
