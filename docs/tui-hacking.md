# Customizing the Glue TUI

This is the map for changing the interactive terminal UI. Read it before editing `src/tui/`. The UI is an original Ink + React program. Do not copy another product's source into this repo.

After any code change, run `npm test` and `npm run typecheck` from the repository root. Node.js 20 or newer is required. Do not use Bun.

## Layout

| Path | Role |
| --- | --- |
| `src/cli.ts` | Starts the TUI only when stdin is a terminal and print mode is off. Calls `startTui` from `src/tui/app.tsx`. |
| `src/tui/app.tsx` | Session state, resize, key dispatch, transcript, dialogs, slash menu. |
| `src/tui/components.tsx` | Header, transcript rows, prompt, status bar, help, resume picker, skill picker, dialogs. |
| `src/tui/skill-picker.ts` | `/skill` picker rows, filter, and keyboard reducer. |
| `src/tui/editor.ts` | Pure prompt reducer: cursor, selection, submit, history, Shift+Tab. |
| `src/tui/keys.ts` | Turns raw stdin bytes into `KeyIn` values. |
| `src/tui/console-input.ts` | Subscribes to Ink's stdin `"input"` events and feeds `keys.ts`. |
| `src/tui/text.ts` | Grapheme boundaries and display width (CJK and emoji count as two columns). |
| `src/tui/caret.ts` | Solid inverse-block caret and selection segments. |
| `src/tui/ime.ts` | `imeAnchor` — the input caret cell for IME/preedit. |
| `src/tui/screen.ts` | Resize/exit cleanup and `attachImeCursorSync` (CUP after every paint). |
| `src/tui/viewport.ts` | Frame height, column width, and which transcript rows fit. |
| `src/tui/theme.ts` | `dark`, `light`, and `ansi` color sets. |
| `src/tui/model-picker.ts` | Model list order, `N/M` hint, and up/down/left/right reducer. |
| `src/effort.ts` | Effort levels and the Anthropic `output_config` helper. |
| `src/commands.ts` | Slash commands, including `/model`, `/effort`, and `/resume`. |
| `tests/input.test.ts` | Decoded keys and editor edits. |
| `tests/viewport.test.ts` | Frame size and long-output clipping. |
| `tests/more.test.ts` | Shift+Tab, `?` help, and submit. |
| `tests/components.test.ts` | Rendered labels for status, tools, and the resume picker. |

`npm test` runs `node scripts/run-tests.mjs`, which loads every `tests/**/*.test.ts` with `node --import tsx --test`. Add a test next to the behavior you change. A doc-only edit still needs the existing suite to pass.

## Prompt

`PromptBox` in `src/tui/components.tsx` draws the input chrome: a full-width `─` rule in `theme.border`, then a `>` prompt and the caret on the next row, then a second rule. There is no side border and no rounded box. It must keep `flexShrink={0}` on both the outer box and the rule box. The caret comes from `promptSegments` in `src/tui/caret.ts`: an inverse grapheme that stays solid. Do not put it on a timer. A 530ms blink repaints the whole frame while an IME is composing, and that repaint is what flickers pinyin under the input — the terminal does not send the composition to the app, so `preedit` stays empty and cannot suppress the timer. The placeholder is the trailing hint on the input row, and only when `showPromptPlaceholder` is true: the buffer is empty and there is no preedit. A preedit string is the only glyph at the caret (underlined, not a second block) and the placeholder is omitted.

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

Ink calls `clearTerminal` (erase screen and scrollback, CSI 3J) when the painted frame is at least `stdout.rows` tall. Classic cmd freezes on that, and the prompt scrolls off the bottom. `frameSize` in `src/tui/viewport.ts` keeps a single report one row shorter than the window. The live session uses `reconcileSize` instead of always taking the smaller report: the stdout that just changed wins, so a grow into fullscreen is not pinned by a stale smaller value, and a shrink is not pinned by a stale fullscreen value. When both reports change in the same read, the smaller one still wins. Values of 0 or 1 are ignored. The root box is `height={termRows} width={termCols} overflow="hidden"`, and `termCols` is `layoutColumns` (terminal columns minus one).

On `resize` and `SIGWINCH`, and again after 40ms, the app reads Ink's stdout and `process.stdout`. A 200ms poll covers classic cmd, which sometimes never emits the event. A real size change calls `reflowTerminal`: Ink's `clear()` resets the log-update line count, then CSI `H` + `2J` erases wrapped leftovers and homes the cursor so the next paint starts clean. That is what removes a doubled input rule and the chrome left mid-window. Do not enter the alternate screen (`?1049h`). Do not send CSI 3J. On exit, `restoreTerminal` leaves any alternate screen (`?1049l`), erases the visible frame, and shows the cursor so the input rules are not painted over `cmd`'s prompt.

The transcript region is the only flexible child: `flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden"`. Header, prompt, and status bar use `flexShrink={0}`. The header is four rows: a purple (`#9B6BFF`) side-view horse on the left, with Glue, the version, the model, and the working directory on the right. `transcriptBudget` reserves those rows plus the prompt and the status bar. `transcriptWindow` paints only the visual lines that fit in `transcriptBudget`. Scroll is a line offset from the bottom: `0` follows the tail, and a larger value reaches older lines, including the start of a long reply. `visibleTranscript` returns the items from that window. Do not render the full history into the tree; Yoga will measure it and shrink the prompt.

Fullscreen and a resized window use the same frame rule. A 30-row window becomes a 29-row frame. A 55-row fullscreen console becomes 54. The root box width is `layoutColumns`: one less than the terminal. A rule that occupies every column wraps on the last cell and leaves a second line under the input; log-update does not count that wrapped row, so the next paint cannot erase it. Cover new size rules in `tests/viewport.test.ts`.

Page Up and Page Down move about one screen (`pageLines`). The mouse wheel moves `WHEEL_LINES` (3) per notch. `startTui` enables SGR mouse tracking (`1000` + `1006`) so the wheel is delivered as input instead of scrolling a console buffer the next repaint overwrites. It is turned off when the session exits, and the visible frame is erased so the input rules do not stay over cmd. Legacy conhost may ignore the wheel request; Page Up and Page Down still move the same window. A hint line (`scrollHint`) is reserved when any lines are hidden. New output keeps the window still while it is scrolled up, and follows the tail when scroll is `0`.

## Scroll

The host scrollbar does not track the transcript. The frame is repainted in place, and the alternate screen stays off, so the Windows slider is not the position of the conversation. Wheel (SGR mouse), PgUp, and PgDn move `transcriptWindow`. The hint from `scrollHint` (`… wheel or pgup for earlier · pgdn for latest`) is the indicator. Legacy conhost often does not send wheel bytes; PgUp and PgDn still work. Do not tell the user the host scrollbar moves.

## Chinese IME

English input is committed bytes and stays in the prompt. A composing IME draws its preedit and candidate window at the real console cursor. Ink's paint leaves that cursor past the last frame cell (the lower-left of the window), which is why pinyin used to appear under the footer. `imeAnchor` is the caret cell on the input row, under the top rule and above the bottom rule. `statusAreaRows` is the wrapped built-in footer (`wrappedRowCount` of the status-bar line; a narrow terminal can take two or more rows) plus each visible custom status line. Blank statusline stdout adds no row. `attachImeCursorSync` patches `stdout.write` so each paint is **one** write: DEC 2026 open, restore the saved end-of-frame cursor (`ESC 8`) when the previous paint parked it, the Ink bytes, then save that end position and CUP onto the caret with `CSI ?25l`, then DEC 2026 close. The terminal must not see the cursor at the bottom between those steps — a microtask between the frame and the CUP is the pinyin flicker. log-update erases upward from the current cursor; skipping the restore leaves the previous input rules on screen. The hardware cursor stays hidden. The inverse block does not blink, and a statusline refresh that paints the same rows does not `setState`. Composition is not delivered on stdin until the user commits, so the console cursor position must already sit on the input before IME starts.

Residual limits: some legacy conhost builds ignore CUP and still pin the candidate window to the window edge. Windows Terminal and other VT hosts pick up the synced position. Glue cannot place the IME overlay anywhere except the console cursor.

## Slash commands, `/goal`, `/auto`, `/statusline`

`/help` opens a bounded panel (`CommandHelp`). It does not append another copy of the catalog to the transcript, so unavailable samples cannot stack a second "Glue Cli commands" dump. `/login`, `/mcp`, `/ide`, `/hooks`, `/voice`, `/desktop`, and the other unavailable names push one line and close that panel. `/skill` with no name opens `SkillPicker` in the TUI and still prints `formatSkillList` when the host has no picker. `/skill <name>` loads one. `/plugin load <dir>` and `/plugin install <owner/repo>` register a skill library and refresh the cached skill list. A marketplace with one plugin installs that plugin. Several plugins open a picker; `/plugin install <plugin>@<owner/repo>` selects one without the picker. Relative sources resolve under the marketplace root and are rejected when they escape it. The read-only `skill` tool returns the skill body prefixed with `Base directory for this skill: <dir>`. `disable-model-invocation` skills are omitted from the catalog and from that tool. `user-invocable: false` stays out of the slash menu. `argument-hint` is shown on the menu row and in the catalog.

Tab completion is prefix-only. `filterSlashEntries` lists commands, then skills (`cycleSlash`). A skill whose short name collides with a command is offered only as its full id. `user-invocable: false` hides a skill from that menu. `argument-hint` is drawn at the end of the row. After `/skill `, `cycleSkillArg` prefix-matches skill ids. After `/plugin remove `, `cyclePluginRemove` prefix-matches installed plugin names. The highlighted menu row is the source of truth: `slashTabIndex` passes that index unless Tab is repeating a cycle. Arrow keys move the highlight, and the next Tab fills that row (`/status` then ↓ then Tab becomes `/statusline`, `/td` becomes `/tdd`), not the shortest prefix. One match accepts the name with a trailing space. Repeated Tab with no new arrow movement still cycles. The skill list is cached and refreshed on startup, after `/plugin install|load|remove`, and when the prompt becomes `/`-prefixed — not on every keystroke. Plain Tab is `\t`. Kitty `CSI 9 u` and modifyOtherKeys `CSI 27 ; modifier ; 9 ~` are Tab as well. Shift+Tab cycles permission modes in a fixed order: plan → manual → accept edits → auto → YOLO, then back to plan. A new session starts in manual.

`/goal` stores a sentence on the session and in `.agent/ui.json`. The system prompt includes it. `/goal clear` removes it. `/auto on` selects auto mode: low-risk edits and local commands pass; `rm -rf`, network installs, and privilege escalation still ask. Paths outside the workspace and protected paths stay denied. `/auto off` returns to manual. YOLO approves every prompt, including high-risk commands. The footer shows the active mode (`plan mode on`, `manual mode on`, `accept edits on`, `auto mode on`, or `YOLO mode on`). `/statusline` writes a command script and `statusLine` settings under **`~/.glue/`** (never the project `.glue/` or `.agent/`). No args auto-configures model + context %. A description such as `/statusline show model name and context percentage with a progress bar` regenerates the script. `/statusline clear` / `delete` / `remove` drops the `statusLine` field. Glue runs the command with session JSON on stdin (model, effort, context_window, cwd, session_id, version, cache when known) and paints stdout above the built-in footer. Whitespace-only or SGR-only stdout is not a row: nothing is drawn between the input and the footer, and the IME anchor does not move up for it. `refreshInterval` (seconds, min 1) re-runs the command on a timer. The mode badge stays on the right.

User lines in the transcript are bold and use `theme.user`. Assistant lines stay regular `theme.text`. Light theme paints that text as truecolor `#1c1917` on background `#fafaf9` (`textInk`). Do not switch it back to ANSI `black`: palette color 0 is often the same as a light terminal background, so the reply and the input caret disappear.

The selected slash row uses one color for the command and the full description (`slashRowTone`). Lines wrap on spaces (`slashRowLines`) so a narrow terminal does not cut a word such as `statusline` and change color in the middle.

## `/model`

`ModelPicker` in `src/tui/components.tsx` is the list. It uses `flexShrink={0}`. Drive it from `handleKey` in `app.tsx`. Read `pickerRef.current` or `modelDraftRef.current`, not React state, so a key in the same stdin chunk is not stale. Update the ref and state together, the way `setPickerBoth` does for `/resume`. Do not also call Ink `useInput`.

The draft `/model` (no trailing text) opens the list, including when there is only one id. Up and down move the highlight. Enter selects. Esc or Ctrl+C closes it and clears the draft. Left and right change effort and do not move the prompt cursor. `/model <id>` still calls `setModel` and does not open the list. Submitting `/model` with no id calls `openModelPicker` when the host provides it.

Order is `modelChoices`: the current model, then `models` from user or project config. Each id appears once. When `models` is empty, the list is only the current id. Do not append unrelated built-in ids on top of that. One `base_url` and key can offer several models by setting `models = ["id-a", "id-b"]` in config.toml. The picker is four layers: a top rule, **Select model** plus a short subtitle, a numbered list (`modelListLines`), then a separate effort row, then `Enter to select · Esc to cancel`. The focused row has `>`. The session's current id keeps `✓` in green while the caret moves. Descriptions sit in one muted column (`Current session model` or `Configured id`). `modelPosition` is still `N/M · id` for tests. Cover the reducer in `tests/model-picker.test.ts`.

## `/effort`

Levels are `low`, `medium`, `high`, `xhigh`, `max`, and `auto` (`EFFORT_PICKER_LEVELS` in `src/tui/effort-picker.ts` is the track and does not include `ultracode` or `auto`; `EFFORT_CYCLE` in `src/effort.ts` is the model-picker order and still starts at `auto`). UltraCode is a Tab toggle beside the track, not a stop. It turns on subagent dispatch (`spawn_subagent`) and does not change the highlighted level. The line under the track says `Ultracode: dynamic workflows on every task` while it is on. That same sentence is the session mode: `ultracodeWorkflow` is included in `buildSystemPrompt` only while the flag is on, and it tells the model to decompose every task and prefer `spawn_subagent` for each independent step. `spawnSubagentTool` carries the same sentence. The next turn rebuilds the system prompt, so turning the flag off drops both the sentence and the tool. `/effort ultracode` and `/effort ultracode on` flip that flag and leave the level. `/effort ultracode off` clears it. `GLUE_EFFORT=ultracode` still starts the session at `max` with the flag on, because that env value has no separate level.

The overlay is centered. `Faster` and `Smarter` flank one thin track, and the level names sit under that line. A single `▲` is in the same columns as the highlighted name. Only that name is colored: `low` yellow, `medium` green, `high` cyan, `xhigh` purple with a white wash that moves left to right (`effortGlyphColor`), and `max` still cycles `MAX_EFFORT_SHIMMER`. `max` and an on toggle add the token caution. There is no `s for this session only` hint: Glue keeps the choice on the session and does not also write a separate saved default. Bare `/effort` (Enter) opens that overlay when the host provides `openEffortPicker`. Alt+P (`isEffortPickerShortcut`) opens the model list with the effort row (`pickerSurface` is `model-effort`) and leaves the draft in the prompt. Left and right move the highlight and stop at the ends. Tab toggles UltraCode. Enter confirms the level and the flag. Esc or Ctrl+C cancels. `/effort <level>` still sets it directly and does not open the picker. `/effort status` prints the level, plus `· ultracode` while the flag is on. Without `openEffortPicker`, bare `/effort` prints the level. `auto` is the model default; the overlay opens on `high` when the session is `auto`, because `auto` is not a track stop.

The built-in footer is only the mode line (`shift+tab to cycle`) plus the shortcut hint. It does not print path, model, effort, tokens, ctx, or cache. A custom `~/.glue` statusline still paints above that line when the script prints something. The API level is stored on the session meta (`effort`) with `ultracode` beside it, and is read from config (`effort`) or `GLUE_EFFORT` / `AGENT_EFFORT`. The model picker still cycles `EFFORT_CYCLE` and keeps the UltraCode flag when the level changes.

Anthropic requests send `output_config.effort` only when the level is not `auto`. OpenAI Chat Completions do not get `reasoning_effort`. Keep that split in `src/llm/anthropic.ts` and `src/llm/client.ts`.

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
| Mouse wheel | SGR `\x1b[<64;x;yM` up, `\x1b[<65;x;yM` down, after tracking is enabled | often no wheel bytes; Page Up (`CSI 5~` or scan code `I`) and Page Down still scroll |

A scan-code prefix with no second byte yet stays in `DecodeState.pending`.

Caveats that are still real:

- This Linux checkout cannot drive cmd.exe or Windows Terminal. The tests feed the same bytes those consoles emit.
- Legacy conhost does not reliably send bracketed paste or SGR mouse sequences. Do not require them.
- Alt+Enter fullscreen can report the new size slightly late. The 40ms second read covers that; do not remove it.
- If one size report stays large after the window was shrunk, the frame follows the smaller report on purpose.
- The hardware cursor is restored, the frame is drawn, and the cursor is CUP'd onto the input caret inside one stdout write, kept hidden (`CSI ?25l`), and wrapped in DEC 2026 so the terminal does not paint the bottom position. The inverse block stays solid; do not blink it on a timer. Do not skip `attachImeCursorSync`, and do not leave the cursor at the end of the frame: that is what put Chinese preedit in the lower-left. Do not show the hardware cursor during the session (`CSI ?25h`). The root box stays one column short of the terminal (`layoutColumns`). Blank `/statusline` stdout does not reserve a row. A status bar that wraps on a narrow terminal counts as more than one row under the input.

Extend `tests/input.test.ts` when you add a sequence. Assert both the decoded `KeyIn` and, when it edits text, the `EditorState`.

## What not to break

- Root frame height stays below `stdout.rows`. `frameRows(24)` is 23. `frameRows(0)` is also 23, not 0.
- Prompt and status bar do not shrink. The transcript does.
- Backspace at the end of a line deletes. Only the Delete key deletes forward, and it is a no-op at the end of the line.
- One Backspace removes one CJK character, one emoji, or one supplementary-plane character (`\u{20000}`).
- Ctrl+A remains "start of line".
- `/resume` still opens the picker for other recent sessions and skips the current session and empty unnamed ones.
- `/model` with no id still opens a list when only one model is configured. That list is `models` from config, or only the current id when `models` is empty. `/model <id>` still sets that id directly.
- Bare `/effort` opens the left/right picker when `openEffortPicker` is set. `/effort <level>` still sets the level. `/effort status` still prints it. `/effort ultracode` toggles subagent dispatch and does not remove `low` through `auto`.
- Transcript scroll is visual lines from the bottom. The wheel and Page Up / Page Down move that window. Scroll `0` stays on the latest line.
- Effort `auto` still omits `output_config` and never adds `reasoning_effort` to a chat completion.
- `scripts/postbuild.mjs` still skips `chmod` on `win32`. Do not add a bare `chmod` to `npm run build`.
- API keys stay out of generated config and out of commits. See the README for `~/.glue/config.toml`.
- Do not import or transcribe source from another coding-agent product. Match behavior from this file and the tests.
