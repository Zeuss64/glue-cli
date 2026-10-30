import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { compactDiff } from "../diff.js";
import { displayName } from "../render/format.js";
import { slashRowLines, slashRowTone } from "./complete.js";
import { skillPickerLine, skillPickerWindow, type SkillPickerItem } from "./skill-picker.js";
import type { ApprovalMode } from "../permissions.js";
import type { DiffLine, PermissionMode, TodoItem, TranscriptItem } from "../types.js";
import { VERSION } from "../version.js";
import type { PermissionPrompt } from "../agent/loop.js";
import type { ResumePickerRow } from "../resume.js";
import { promptCaretMode, promptSegments, showPromptPlaceholder } from "./caret.js";
import { effortBlurb, effortColor, effortGlyphColor, effortTitle, ULTRACODE_DESCRIPTION } from "../effort.js";
import { effortTrackLines } from "./effort-picker.js";
import { footerModeInk, statusBarPieces } from "./footer.js";
import { modelDescription, modelListLines, type ModelListEntry } from "./model-picker.js";
import { horseRows, PET_COLOR } from "./pet.js";
import { resumeSelectedInk, textInk, type Theme } from "./theme.js";

const FRAMES = ["✻", "✽", "✶", "✢", "✺"];
const VERBS = ["Thinking", "Pondering", "Tracing", "Sifting", "Drafting", "Checking", "Mulling", "Shaping"];

export function Header({ theme, model, cwd, branch }: { theme: Theme; model: string; cwd: string; branch?: string }) {
  const petInk = theme.bg ? { color: PET_COLOR, backgroundColor: theme.bg } : { color: PET_COLOR };
  const where = `${cwd}${branch ? `  ·  ${branch}` : ""}`;
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Box flexDirection="column" marginRight={1} flexShrink={0}>
        {horseRows().map((row, index) => (
          <Text key={index} wrap="truncate" {...petInk}>{row}</Text>
        ))}
      </Box>
      <Box flexDirection="column" flexShrink={0}>
        <Text>
          <Text bold {...textInk(theme, theme.text)}>Glue</Text>
          <Text {...textInk(theme, theme.muted)}>{` ${VERSION}`}</Text>
        </Text>
        <Text {...textInk(theme, theme.muted)}>{model}</Text>
        <Text {...textInk(theme, theme.muted)}>{where}</Text>
      </Box>
    </Box>
  );
}

export function Welcome({ theme, profile }: { theme: Theme; profile: string }) {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text {...textInk(theme, theme.text)}>Glue Cli · profile {profile}</Text>
      <Text {...textInk(theme, theme.muted)}>/help for commands · ? for shortcuts · shift+tab cycles permissions</Text>
    </Box>
  );
}

export function TranscriptView({
  items,
  theme,
  expanded,
}: {
  items: TranscriptItem[];
  theme: Theme;
  expanded: boolean;
}) {
  return (
    <Box flexDirection="column">
      {items.map((item) => (
        <Box key={item.id} flexDirection="column" marginTop={item.type === "user" && item.gap !== false ? 1 : 0}>
          {item.type === "user" ? <UserLine item={item} theme={theme} /> : null}
          {item.type === "assistant" ? <AssistantLine text={item.text} theme={theme} /> : null}
          {item.type === "system" ? <Text {...textInk(theme, theme.muted)}>{item.text}</Text> : null}
          {item.type === "error" ? <Text {...textInk(theme, theme.bad)}>{item.text}</Text> : null}
          {item.type === "tool" ? <ToolBlock item={item} theme={theme} expanded={expanded} /> : null}
        </Box>
      ))}
    </Box>
  );
}

/** User lines are bold and use `theme.user`. Assistant lines stay regular `theme.text`. */
export function transcriptTone(kind: "user" | "assistant"): { bold: boolean; slot: "user" | "text" } {
  if (kind === "user") return { bold: true, slot: "user" };
  return { bold: false, slot: "text" };
}

function UserLine({ item, theme }: { item: Extract<TranscriptItem, { type: "user" }>; theme: Theme }) {
  const tone = transcriptTone("user");
  const color = item.queued ? theme.muted : theme[tone.slot];
  return (
    <Box flexDirection="column">
      <Text bold={!item.queued && tone.bold} {...textInk(theme, color)}>{`${item.queued ? "… " : "> "}${item.text}`}</Text>
      {item.attached?.length ? <Text {...textInk(theme, theme.muted)}>{`  attached ${item.attached.join(", ")}`}</Text> : null}
    </Box>
  );
}

function AssistantLine({ text, theme }: { text: string; theme: Theme }) {
  const tone = transcriptTone("assistant");
  return <Text bold={tone.bold} {...textInk(theme, theme[tone.slot])}>{text}</Text>;
}

export function ToolBlock({
  item,
  theme,
  expanded,
}: {
  item: Extract<TranscriptItem, { type: "tool" }>;
  theme: Theme;
  expanded: boolean;
}) {
  const summaryColor = item.status === "error" || item.status === "denied" ? theme.bad : theme.muted;
  return (
    <Box flexDirection="column">
      {item.showHeader === false ? null : (
        <Text>
          <Text {...textInk(theme, theme.accent)}>⏺ </Text>
          <Text bold {...textInk(theme, theme.text)}>{displayName(item.name)}</Text>
          <Text {...textInk(theme, theme.muted)}>{item.target ? `(${trim(item.target, 90)})` : ""}</Text>
          {item.status === "running" ? <Text {...textInk(theme, theme.muted)}> …</Text> : null}
        </Text>
      )}
      {item.summary ? <Text {...textInk(theme, summaryColor)}>{`  ⎿  ${item.summary}`}</Text> : null}
      {item.diff?.length ? <DiffView lines={item.diff} theme={theme} /> : null}
      {expanded && item.detail ? (
        <Box flexDirection="column" paddingLeft={4}>
          {item.detail.split("\n").slice(0, 40).map((line, index) => (
            <Text key={index} {...textInk(theme, theme.muted)}>{line}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function DiffView({ lines, theme }: { lines: DiffLine[]; theme: Theme }) {
  const shown = compactDiff(lines, 2, 12);
  return (
    <Box flexDirection="column" paddingLeft={4}>
      {shown.map((line, index) => (
        <Text key={index} {...textInk(theme, line.kind === "add" ? theme.add : line.kind === "del" ? theme.del : theme.muted)}>
          {(line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  ") + line.text}
        </Text>
      ))}
    </Box>
  );
}

export function TodoList({ todos, theme }: { todos: TodoItem[]; theme: Theme }) {
  if (!todos.length) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text {...textInk(theme, theme.muted)}>Todos</Text>
      {todos.map((todo) => (
        <Text key={todo.id} {...textInk(theme, todo.status === "completed" ? theme.ok : theme.text)}>
          {todo.status === "completed" ? "● " : todo.status === "in_progress" ? "◐ " : "○ "}
          {todo.content}
        </Text>
      ))}
    </Box>
  );
}

export function Spinner({ theme, startedAt }: { theme: Theme; startedAt: number }) {
  const [frame, setFrame] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((value) => value + 1);
      setNow(Date.now());
    }, 120);
    return () => clearInterval(timer);
  }, []);
  const verb = VERBS[Math.floor(now / 2000) % VERBS.length] ?? "Thinking";
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <Text {...textInk(theme, theme.accent)}>
      {FRAMES[frame % FRAMES.length]} {verb}… <Text {...textInk(theme, theme.muted)}>{`(${seconds}s · esc to interrupt)`}</Text>
    </Text>
  );
}

export function PromptBox({
  theme,
  text,
  cursor,
  anchor = null,
  placeholder,
  hint,
  preedit,
}: {
  theme: Theme;
  text: string;
  cursor: number;
  anchor?: number | null;
  placeholder?: string;
  hint?: string;
  /** IME composition, drawn on the input row when the host can see it. */
  preedit?: string;
}) {
  const composing = promptCaretMode(text, preedit ?? "") === "compose";
  const showPlaceholder = showPromptPlaceholder(text, preedit ?? "", placeholder);
  // Tick stays 0: the inverse block is solid. An idle interval repaints the
  // frame and parks the hardware cursor, which flickers IME preedit.
  const parts = composing ? [] : promptSegments(text, cursor, anchor, 0);
  return (
    <Box flexDirection="column" flexShrink={0}>
      {hint ? <Text {...textInk(theme, theme.muted)}>{hint}</Text> : null}
      <Box
        flexShrink={0}
        width="100%"
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderColor={theme.border}
      >
        <Box flexShrink={0}>
          <Text>
            <Text {...textInk(theme, theme.text)}>{"> "}</Text>
            {composing ? (
              <Text underline {...textInk(theme, theme.text)}>{preedit ?? ""}</Text>
            ) : (
              parts.map((part, index) =>
                part.inverse ? (
                  <Text key={index} inverse {...textInk(theme, theme.text)}>
                    {part.text}
                  </Text>
                ) : (
                  <Text key={index} {...textInk(theme, theme.text)}>
                    {part.text}
                  </Text>
                ),
              )
            )}
          </Text>
        </Box>
        {showPlaceholder ? <Box flexGrow={1} /> : null}
        {showPlaceholder ? (
          <Text {...textInk(theme, theme.muted)} wrap="truncate-end">{placeholder}</Text>
        ) : null}
      </Box>
    </Box>
  );
}

export function StatusBar({
  theme,
  mode,
  hint,
  approval = "manual",
  goal,
  shell,
  session,
}: {
  theme: Theme;
  mode: PermissionMode;
  hint?: string;
  approval?: ApprovalMode;
  goal?: string;
  shell?: boolean;
  session?: string;
}) {
  const pieces = statusBarPieces({ mode, approval, hint, shell, session, goal });
  return (
    <Box flexShrink={0}>
      <Text wrap="wrap">
        {pieces.map((piece, index) => (
          <Text
            key={`${piece.tone}:${index}`}
            {...textInk(theme, piece.tone === "mode" ? footerModeInk(mode, approval, theme.mode[mode]) : theme.muted)}
          >
            {piece.text}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

/** Custom `/statusline` command output, above the built-in footer. Blank stdout renders nothing. */
export function CustomStatusLine({
  theme,
  lines,
}: {
  theme: Theme;
  lines: string[];
}) {
  const visible = lines.filter((line) => line.trim().length > 0);
  if (!visible.length) return null;
  return (
    <Box flexDirection="column" flexShrink={0}>
      {visible.map((line, index) => (
        <Text key={index} {...textInk(theme, theme.muted)} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}

export function ScrollMeter({ theme, label }: { theme: Theme; label: string }) {
  if (!label) return null;
  return (
    <Box flexShrink={0}>
      <Text {...textInk(theme, theme.muted)}>{label}</Text>
    </Box>
  );
}

export function CommandHelp({
  theme,
  lines,
  offset,
  windowSize = 10,
}: {
  theme: Theme;
  lines: string[];
  offset: number;
  windowSize?: number;
}) {
  const max = Math.max(0, lines.length - 1);
  const start = Math.max(0, Math.min(offset, max));
  const slice = lines.slice(start, start + windowSize);
  const from = lines.length === 0 ? 0 : start + 1;
  const to = start + slice.length;
  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.border} paddingX={1} marginTop={1}>
      <Text {...textInk(theme, theme.accent)}>命令</Text>
      {slice.map((line, index) => (
        <Text key={`${start}:${index}`} {...textInk(theme, theme.muted)}>{line || " "}</Text>
      ))}
      <Text {...textInk(theme, theme.muted)}>{`${from}–${to}/${lines.length}  ·  ↑↓ 滚动 · Esc 关闭 · 不可用命令只提示一行`}</Text>
    </Box>
  );
}

export function HelpPanel({ theme }: { theme: Theme }) {
  const rows: Array<[string, string]> = [
    ["enter", "send"],
    ["\\ + enter", "newline"],
    ["shift+tab", "cycle plan, manual, accept, auto, YOLO"],
    ["backspace", "delete the previous character"],
    ["delete", "delete the next character"],
    ["esc", "interrupt, or deny a prompt"],
    ["ctrl+c", "clear input, then exit"],
    ["ctrl+d", "exit on an empty prompt"],
    ["ctrl+r", "search prompt history"],
    ["ctrl+o", "expand tool output"],
    ["ctrl+t", "toggle the todo list"],
    ["ctrl+s", "stash the draft"],
    ["up/down", "history, or queued messages"],
    ["! command", "run a shell command"],
    ["# note", "append to AGENT.md"],
    ["@path", "attach a file"],
    ["/", "commands and skills"],
    ["/skill", "skill picker · tab fills /skill <id>"],
    ["/model", "model list · ←→ effort · alt+p"],
    ["/effort", "Faster/Smarter track · tab toggles UltraCode"],
    ["alt+p", "model list and effort row"],
    ["pgup / wheel", "earlier messages"],
  ];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} marginTop={1}>
      <Text {...textInk(theme, theme.accent)}>shortcuts</Text>
      {rows.map(([key, label]) => (
        <Text key={key}>
          <Text {...textInk(theme, theme.text)}>{key.padEnd(16)}</Text>
          <Text {...textInk(theme, theme.muted)}>{label}</Text>
        </Text>
      ))}
    </Box>
  );
}

export function SlashMenu({
  theme,
  rows,
  selected,
  columns = 80,
}: {
  theme: Theme;
  rows: Array<{ name: string; summary: string }>;
  selected: number;
  /** Terminal columns. Rows wrap on spaces so a highlight cannot split a word. */
  columns?: number;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {rows.map((row, index) => {
        const selectedRow = index === selected;
        const color = theme[slashRowTone(selectedRow)];
        const lines = slashRowLines(selectedRow, row.name, row.summary, columns);
        return (
          <Box key={`${row.name}:${index}`} flexDirection="column">
            {lines.map((line, lineIndex) => (
              <Text key={lineIndex} {...textInk(theme, color)} wrap="truncate-end">{line}</Text>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

export function SkillPicker({
  theme,
  items,
  selected,
  query,
  columns = 80,
}: {
  theme: Theme;
  items: SkillPickerItem[];
  selected: number;
  query: string;
  columns?: number;
}) {
  const windowed = skillPickerWindow(items, selected, 6);
  const filter = query ? `filter: ${query}` : "filter: type to search";
  const width = Math.max(4, columns - 2);
  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold {...textInk(theme, theme.text)}>技能</Text>
      <Text {...textInk(theme, theme.muted)}>{`${filter}  ·  ${items.length}`}</Text>
      {items.length === 0 ? <Text {...textInk(theme, theme.muted)}>没有匹配的技能</Text> : null}
      {windowed.rows.map((item, index) => {
        const on = index === windowed.selected;
        return (
          <Text key={`${item.id}:${index}`} {...textInk(theme, on ? theme.accent : theme.text)} wrap="truncate-end">
            {skillPickerLine(item, width, on)}
          </Text>
        );
      })}
      <Text {...textInk(theme, theme.muted)}>↑↓ select · enter load · tab fill · esc close</Text>
    </Box>
  );
}

export function PermissionDialog({ theme, prompt, selected }: { theme: Theme; prompt: PermissionPrompt; selected: number }) {
  const options = ["Yes", prompt.allowLabel, "No, and tell Glue what to do differently"];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold {...textInk(theme, theme.text)}>{prompt.title}</Text>
      <Text {...textInk(theme, theme.muted)}>{trim(prompt.detail, 200)}</Text>
      {prompt.diff?.length ? <DiffView lines={prompt.diff} theme={theme} /> : null}
      <Text {...textInk(theme, theme.text)}>Do you want to proceed?</Text>
      {options.map((option, index) => (
        <Text key={option} {...textInk(theme, index === selected ? theme.accent : theme.text)}>
          {index === selected ? "❯ " : "  "}
          {index + 1}. {option}
        </Text>
      ))}
    </Box>
  );
}

export function ResumePicker({
  theme,
  rows,
  selected,
  query,
  matchCount,
  preview,
  hiddenAbove = 0,
  hiddenBelow = 0,
}: {
  theme: Theme;
  rows: ResumePickerRow[];
  selected: number;
  query: string;
  matchCount: number;
  preview: string[];
  hiddenAbove?: number;
  hiddenBelow?: number;
}) {
  const filter = query ? `filter: ${query}` : "filter: type to search";
  const count = `${matchCount} ${matchCount === 1 ? "session" : "sessions"}`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold {...textInk(theme, theme.text)}>Resume session</Text>
      <Text {...textInk(theme, theme.muted)}>{`${filter}  ·  ${count}`}</Text>
      {hiddenAbove > 0 ? <Text {...textInk(theme, theme.muted)}>{`  ${hiddenAbove} earlier`}</Text> : null}
      {rows.length === 0 ? <Text {...textInk(theme, theme.muted)}>No matching sessions</Text> : null}
      {rows.map((row, index) => {
        const on = index === selected;
        // Hex accent as a lone foreground collapses on classic cmd. The title
        // carries the selection. The age is bold; the session id stays plain.
        const titleInk = on ? resumeSelectedInk(theme) : textInk(theme, theme.text);
        return (
          <Box key={row.id} flexDirection="column">
            <Text wrap="truncate" {...titleInk}>
              {on ? "❯ " : "  "}
              {row.title}
            </Text>
            <Text wrap="truncate">
              <Text bold {...textInk(theme, theme.muted)}>{`    ${row.age}`}</Text>
              {row.detail ? <Text {...textInk(theme, theme.muted)}>{` · ${row.detail}`}</Text> : null}
            </Text>
          </Box>
        );
      })}
      {hiddenBelow > 0 ? <Text {...textInk(theme, theme.muted)}>{`  ${hiddenBelow} later`}</Text> : null}
      {rows.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text {...textInk(theme, theme.muted)}>preview</Text>
          {preview.length ? (
            preview.map((line, index) => (
              <Text key={index} wrap="truncate" {...textInk(theme, theme.text)}>{line}</Text>
            ))
          ) : (
            <Text {...textInk(theme, theme.muted)}>Empty session</Text>
          )}
        </Box>
      ) : null}
      <Text {...textInk(theme, theme.muted)}>↑↓ select · enter resume · esc cancel</Text>
      <Text {...textInk(theme, theme.muted)}>{"/rename <name> labels the open session"}</Text>
    </Box>
  );
}

export function ModelPicker({
  theme,
  rows,
  selected,
  effort,
  current,
  start = 0,
  columns = 72,
}: {
  theme: Theme;
  rows: string[];
  selected: number;
  effort: string;
  /** Session model. The checkmark stays here while the caret moves. */
  current: string;
  /** Index of `rows[0]` in the full list. */
  start?: number;
  columns?: number;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (effort !== "max" && effort !== "xhigh") return;
    const timer = setInterval(() => setTick((value) => value + 1), 160);
    return () => clearInterval(timer);
  }, [effort]);
  const entries: ModelListEntry[] = rows.map((id, index) => ({
    id,
    number: start + index + 1,
    current: id === current,
    focused: index === selected,
    description: modelDescription(id, current),
  }));
  const lines = modelListLines(entries);
  const rule = "─".repeat(Math.max(24, Math.min(columns, 88)));
  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1}>
      <Text {...textInk(theme, theme.border)}>{rule}</Text>
      <Text bold {...textInk(theme, theme.text)}>Select model</Text>
      <Text {...textInk(theme, theme.muted)}>Switch the model for this session. The list is the configured ids.</Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, index) => (
          <ModelListRow key={`${entry.number}:${entry.id}`} line={lines[index] ?? ""} entry={entry} theme={theme} />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text {...textInk(theme, effortColor(effort, tick))}>◎ </Text>
        <EffortWord theme={theme} level={effort} tick={tick} />
        <Text bold {...textInk(theme, effortColor(effort, tick))}> effort</Text>
        <Text {...textInk(theme, theme.muted)}>  ←/→ to adjust</Text>
      </Box>
      <Box marginTop={1}>
        <Text {...textInk(theme, theme.muted)}>Enter to select · Esc to cancel</Text>
      </Box>
    </Box>
  );
}

function ModelListRow({ line, entry, theme }: { line: string; entry: ModelListEntry; theme: Theme }) {
  const idAt = line.indexOf(entry.id);
  const descAt = line.lastIndexOf(entry.description);
  if (idAt < 0 || descAt < idAt) return <Text {...textInk(theme, theme.text)}>{line}</Text>;
  const nameColor = entry.current ? "green" : theme.text;
  const gapColor = entry.current ? "green" : theme.muted;
  return (
    <Text>
      <Text {...textInk(theme, entry.focused ? theme.accent : theme.muted)}>{line.slice(0, idAt)}</Text>
      <Text {...textInk(theme, nameColor)} bold={entry.current}>{entry.id}</Text>
      <Text {...textInk(theme, gapColor)}>{line.slice(idAt + entry.id.length, descAt)}</Text>
      <Text {...textInk(theme, theme.muted)}>{line.slice(descAt)}</Text>
    </Text>
  );
}

export function EffortPicker({
  theme,
  levels,
  selected,
  ultracode = false,
}: {
  theme: Theme;
  levels: string[];
  selected: number;
  ultracode?: boolean;
}) {
  const choice = levels[selected] ?? levels[0] ?? "high";
  const lines = effortTrackLines(levels, selected);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (choice !== "max" && choice !== "xhigh") return;
    const timer = setInterval(() => setTick((value) => value + 1), 160);
    return () => clearInterval(timer);
  }, [choice]);
  const tone = effortColor(choice, tick);
  const caution = choice === "max" || ultracode;
  const knob = lines.track.indexOf("▲");
  const nameAt = lines.labels.indexOf(choice);
  return (
    <Box flexDirection="column" flexShrink={0} marginTop={1} alignItems="center">
      <Text bold {...textInk(theme, theme.text)}>Effort</Text>
      <Box marginTop={1}>
        <Box flexDirection="column">
          <Text>
            <Text {...textInk(theme, theme.muted)}>{knob >= 0 ? lines.track.slice(0, knob) : lines.track}</Text>
            {knob >= 0 ? <Text {...textInk(theme, tone)}>▲</Text> : null}
            {knob >= 0 ? <Text {...textInk(theme, theme.muted)}>{lines.track.slice(knob + 1)}</Text> : null}
          </Text>
          <EffortLabels labels={lines.labels} name={choice} nameAt={nameAt} tick={tick} theme={theme} />
        </Box>
        <Box flexDirection="column" marginLeft={4}>
          <Text {...textInk(theme, "#c084fc")}>{ultracode ? "Ultracode on" : "Ultracode off"}</Text>
          <Text {...textInk(theme, theme.muted)}>Tab to toggle</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text {...textInk(theme, ultracode ? "#c084fc" : theme.text)}>
          {ultracode ? ULTRACODE_DESCRIPTION : effortBlurb(choice)}
        </Text>
      </Box>
      {caution ? (
        <Text {...textInk(theme, theme.muted)}>May use excessive tokens resulting in long response times or overthinking. Use sparingly for the hardest tasks.</Text>
      ) : null}
      <Text {...textInk(theme, theme.muted)}>←/→ to adjust · Enter to confirm · Esc to cancel</Text>
    </Box>
  );
}

function EffortWord({ theme, level, tick }: { theme: Theme; level: string; tick: number }) {
  const title = effortTitle(level);
  if (level !== "xhigh") return <Text bold {...textInk(theme, effortColor(level, tick))}>{title}</Text>;
  return (
    <Text bold>
      {title.split("").map((glyph, index) => (
        <Text key={`${glyph}:${index}`} {...textInk(theme, effortGlyphColor("xhigh", index, title.length, tick))}>{glyph}</Text>
      ))}
    </Text>
  );
}

function EffortLabels({
  labels,
  name,
  nameAt,
  tick,
  theme,
}: {
  labels: string;
  name: string;
  nameAt: number;
  tick: number;
  theme: Theme;
}) {
  if (nameAt < 0) return <Text {...textInk(theme, theme.muted)}>{labels}</Text>;
  const end = nameAt + name.length;
  return (
    <Text>
      <Text {...textInk(theme, theme.muted)}>{labels.slice(0, nameAt)}</Text>
      {name === "xhigh" ? (
        name.split("").map((glyph, index) => (
          <Text key={`${glyph}:${index}`} {...textInk(theme, effortGlyphColor("xhigh", index, name.length, tick))}>{glyph}</Text>
        ))
      ) : (
        <Text {...textInk(theme, effortColor(name, tick))} bold>{labels.slice(nameAt, end)}</Text>
      )}
      <Text {...textInk(theme, theme.muted)}>{labels.slice(end)}</Text>
    </Text>
  );
}

export function ChoiceDialog({
  theme,
  title,
  body,
  options,
  selected,
}: {
  theme: Theme;
  title: string;
  body?: string;
  options: string[];
  selected: number;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold {...textInk(theme, theme.text)}>{title}</Text>
      {body ? <Text {...textInk(theme, theme.muted)}>{body}</Text> : null}
      {options.map((option, index) => (
        <Text key={option} {...textInk(theme, index === selected ? theme.accent : theme.text)}>
          {index === selected ? "❯ " : "  "}
          {index + 1}. {option}
        </Text>
      ))}
    </Box>
  );
}

function trim(value: string, max: number): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
