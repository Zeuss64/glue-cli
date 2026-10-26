# Customizing the Glue TUI

This is the map for changing the interactive terminal UI. Read it before editing `src/tui/`. The UI is an original Ink + React program. Do not copy another product's source into this repo.

After any code change, run `npm test` and `npm run typecheck` from the repository root. Node.js 20 or newer is required. Do not use Bun.

## Layout

| Path | Role |
| --- | --- |
| `src/cli.ts` | Starts the TUI only when stdin is a terminal and print mode is off. Calls `startTui` from `src/tui/app.tsx`. |
| `src/tui/app.tsx` | Session state, resize, key dispatch, transcript, dialogs, slash menu. |
| `src/tui/components.tsx` | Header, transcript rows, prompt, status bar, help, resume picker, dialogs. |
| `src/tui/editor.ts` | Pure prompt reducer: cursor, selection, submit, history, Shift+Tab. |
| `src/tui/keys.ts` | Turns raw stdin bytes into `KeyIn` values. |
| `src/tui/console-input.ts` | Subscribes to Ink's stdin `"input"` events and feeds `keys.ts`. |
| `src/tui/text.ts` | Grapheme boundaries and display width (CJK and emoji count as two columns). |
| `src/tui/caret.ts` | Blinking inverse-block caret and selection segments. |
| `src/tui/viewport.ts` | Frame height, column width, and which transcript rows fit. |
| `src/tui/theme.ts` | `dark`, `light`, and `ansi` color sets. |
| `src/commands.ts` | Slash commands, including `/model` and `/resume`. |
| `tests/input.test.ts` | Decoded keys and editor edits. |
| `tests/viewport.test.ts` | Frame size and long-output clipping. |
| `tests/more.test.ts` | Shift+Tab, `?` help, and submit. |
| `tests/components.test.ts` | Rendered labels for status, tools, and the resume picker. |

`npm test` runs `node scripts/run-tests.mjs`, which loads every `tests/**/*.test.ts` with `node --import tsx --test`. Add a test next to the behavior you change. A doc-only edit still needs the existing suite to pass.

## Prompt

`PromptBox` in `src/tui/components.tsx` draws the input bar. It must keep `flexShrink={0}` on both the outer box and the border. The caret comes from `promptSegments` in `src/tui/caret.ts`: an inverse grapheme that blinks every 530ms, reset when the text, cursor, or selection changes. Empty prompts may also show the placeholder.

Editing logic is `reduceEditor` in `src/tui/editor.ts`. It returns the next `EditorState` plus an optional effect (`submit`, `ctrl-c`, `escape`, `cycle-mode`, `history-prev`, and the others listed in that file). `app.tsx` applies the effect. Do not perform I/O inside `reduceEditor`.

Keep these bindings:

- Ctrl+A (`\x01`) and Home move to the start of the line. Ctrl+A is not select-all.
- Ctrl+E and End move to the end of the line.
- Shift+arrows set `anchor`. Backspace, Delete, or a typed character replaces that selection.
- Ctrl+B stays "background" in the app. It is not word-left.
- Ctrl+F moves one grapheme forward.
- Ctrl+H and Backspace delete one grapheme backward. Alt+Backspace deletes a word.
- `?` opens help only when the prompt is empty.

`emptyEditor()` sets `anchor` to `null`. Any new `EditorState` field needs a value there, or `tests/more.test.ts` will fail.

## Layout and resize

Ink calls `clearTerminal` (erase screen and scrollback) when the painted frame is at least `stdout.rows` tall. Classic cmd freezes on that, and the prompt scrolls off the bottom. `frameSize` in `src/tui/viewport.ts` keeps the root `Box` one row shorter than the smallest reported window.

`app.tsx` passes three reports into `frameSize`: React state, Ink's stdout, and `process.stdout`. Values of 0 or 1 are ignored. If the reports disagree, the smaller one wins, so a leftover fullscreen size cannot paint past a window that was just dragged smaller. The root box is `height={termRows} width={termCols} overflow="hidden"`.

On `resize`, the app reads rows and columns immediately and again after 40ms. Legacy cmd often updates the window size a moment after Alt+Enter. Listen on Ink's stdout, and also on `process.stdout` when it is a different stream. Do not enter the alternate screen (`?1049h`). A shorter frame is enough, and conhost's alternate buffer plus a scrollback clear is the freeze.

The transcript region is the only flexible child: `flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden"`. Header, prompt, and status bar use `flexShrink={0}`. `visibleTranscript` tails long items to `transcriptBudget` and drops tool diff and detail when the row budget is spent. Do not render the full history into the tree; Yoga will measure it and shrink the prompt.

Fullscreen and a resized window use the same helper. A 30-row window becomes a 29-row frame. A 55-row fullscreen console becomes 54. Both still show the tail of a long reply. Cover new size rules in `tests/viewport.test.ts`.

## `/model`

There is no model picker. `/model` with no arguments prints `Model: <id>`. `/model <name>` calls `host.setModel` in `src/tui/app.tsx` and lasts for this session only. The command lives in the `case "model"` branch of `runSlashCommand` in `src/commands.ts`. Up and down on a normal prompt are history, not a model list.

If you add a picker, put the list component in `src/tui/components.tsx` and drive it from `handleKey` in `app.tsx`. Read `pickerRef.current`, not React state, so a key in the same stdin chunk is not stale. Update the ref and state together, the way `setPickerBoth` does for `/resume`. Give the list `flexShrink={0}`. Do not also call Ink `useInput`. Arrow keys should move the highlight only while the picker is open, and Esc or Ctrl+C should close it. `/model <name>` should still set the model directly. Add tests for the reducer or command; do not rely on a manual keypress.

## Windows input

`useConsoleInput` is the only key listener. It sets raw mode and listens to Ink's stdin context event `"input"`. Do not add a second `useInput`, and do not add a stdin `"data"` listener. Both will double-handle or fight Ink's readable mode. The handler ref is updated every render so picker and editor state stay current.

`pushConsoleChunk` in `src/tui/keys.ts` decodes one `read()` into several keys. That matters when an IME commits a character and Backspace in the same chunk.

Accepted bytes:

| Key | Windows Terminal | Legacy cmd.exe |
| --- | --- | --- |
| Backspace | usually `\x7f` | often `\x08`; both delete the previous grapheme |
| Delete | `CSI 3~` | scan code `S` after `\x00` or `\xE0` |
| Arrows | `CSI A/B/C/D` and SS3 `ESC O A` | scan codes `H P M K` after `\x00` or `\xE0` |
| Enter | `\r` or `\r\n` as one return | same |
| Esc | a lone `\x1b` | same; `\x1b` plus another byte is Alt, not Esc |
| Ctrl+C / Ctrl+A | `\x03` / `\x01` | same |
| Shift+Tab | `CSI Z` | scan code `\x0f` after `\x00` or `\xE0` |
| Printable text, CJK, emoji | one insert per run of characters | same; deletion uses grapheme boundaries |

A scan-code prefix with no second byte yet stays in `DecodeState.pending`.

Caveats that are still real:

- This Linux checkout cannot drive cmd.exe or Windows Terminal. The tests feed the same bytes those consoles emit.
- Legacy conhost does not reliably send bracketed paste or SGR mouse sequences. Do not require them.
- Alt+Enter fullscreen can report the new size slightly late. The 40ms second read covers that; do not remove it.
- If one size report stays large after the window was shrunk, the frame follows the smaller report on purpose.
- The hardware cursor stays hidden. The blinking block is drawn by the prompt. Do not turn the terminal cursor back on or the two carets will disagree.

Extend `tests/input.test.ts` when you add a sequence. Assert both the decoded `KeyIn` and, when it edits text, the `EditorState`.

## What not to break

- Root frame height stays below `stdout.rows`. `frameRows(24)` is 23. `frameRows(0)` is also 23, not 0.
- Prompt and status bar do not shrink. The transcript does.
- Backspace at the end of a line deletes. Only the Delete key deletes forward, and it is a no-op at the end of the line.
- One Backspace removes one CJK character, one emoji, or one supplementary-plane character (`\u{20000}`).
- Ctrl+A remains "start of line".
- `/resume` still opens the picker for other recent sessions and skips the current session and empty unnamed ones.
- `scripts/postbuild.mjs` still skips `chmod` on `win32`. Do not add a bare `chmod` to `npm run build`.
- API keys stay out of generated config and out of commits. See the README for `~/.glue/config.toml`.
- Do not import or transcribe source from another coding-agent product. Match behavior from this file and the tests.
