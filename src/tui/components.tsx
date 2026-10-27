import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { compactDiff } from "../diff.js";
import { displayName } from "../render/format.js";
import { slashRowLines, slashRowTone } from "./complete.js";
import type { ApprovalMode } from "../permissions.js";
import type { DiffLine, PermissionMode, TodoItem, TranscriptItem } from "../types.js";
import { VERSION } from "../version.js";
import type { PermissionPrompt } from "../agent/loop.js";
import { promptCaretMode, promptSegments, showPromptPlaceholder } from "./caret.js";
import { effortBlurb, effortColor, effortGlyphColor, effortTitle, ULTRACODE_DESCRIPTION } from "../effort.js";
import { effortTrackLines } from "./effort-picker.js";
import { footerModeLine } from "./footer.js";
import { modelDescription, modelListLines, type ModelListEntry } from "./model-picker.js";
import type { Theme } from "./theme.js";

const FRAMES = ["✻", "✽", "✶", "✢", "✺"];
const VERBS = ["Thinking", "Pondering", "Tracing", "Sifting", "Drafting", "Checking", "Mulling", "Shaping"];

export function Header({ theme, model, cwd, branch }: { theme: Theme; model: string; cwd: string; branch?: string }) {
  return (
    <Text>
      <Text color={theme.accent}>✻ </Text>
      <Text bold color={theme.text}>Glue</Text>
      <Text color={theme.muted}>{` ${VERSION}  ·  ${model}  ·  ${cwd}${branch ? `  ·  ${branch}` : ""}`}</Text>
    </Text>
  );
}

export function Welcome({ theme, profile }: { theme: Theme; profile: string }) {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text color={theme.text}>Glue Cli · profile {profile}</Text>
      <Text color={theme.muted}>/help for commands · ? for shortcuts · shift+tab cycles permissions</Text>
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
          {item.type === "system" ? <Text color={theme.muted}>{item.text}</Text> : null}
          {item.type === "error" ? <Text color={theme.bad}>{item.text}</Text> : null}
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
      <Text bold={!item.queued && tone.bold} color={color}>{`${item.queued ? "… " : "> "}${item.text}`}</Text>
      {item.attached?.length ? <Text color={theme.muted}>{`  attached ${item.attached.join(", ")}`}</Text> : null}
    </Box>
  );
}

function AssistantLine({ text, theme }: { text: string; theme: Theme }) {
  const tone = transcriptTone("assistant");
  return <Text bold={tone.bold} color={theme[tone.slot]}>{text}</Text>;
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
          <Text color={theme.accent}>⏺ </Text>
          <Text bold color={theme.text}>{displayName(item.name)}</Text>
          <Text color={theme.muted}>{item.target ? `(${trim(item.target, 90)})` : ""}</Text>
          {item.status === "running" ? <Text color={theme.muted}> …</Text> : null}
        </Text>
      )}
      {item.summary ? <Text color={summaryColor}>{`  ⎿  ${item.summary}`}</Text> : null}
      {item.diff?.length ? <DiffView lines={item.diff} theme={theme} /> : null}
      {expanded && item.detail ? (
        <Box flexDirection="column" paddingLeft={4}>
          {item.detail.split("\n").slice(0, 40).map((line, index) => (
            <Text key={index} color={theme.muted}>{line}</Text>
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
        <Text key={index} color={line.kind === "add" ? theme.add : line.kind === "del" ? theme.del : theme.muted}>
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
      <Text color={theme.muted}>Todos</Text>
      {todos.map((todo) => (
        <Text key={todo.id} color={todo.status === "completed" ? theme.ok : theme.text}>
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
    <Text color={theme.accent}>
      {FRAMES[frame % FRAMES.length]} {verb}… <Text color={theme.muted}>{`(${seconds}s · esc to interrupt)`}</Text>
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
  /** IME composition, drawn inside the border when the host can see it. */
  preedit?: string;
}) {
  const composing = promptCaretMode(text, preedit ?? "") === "compose";
  const blink = promptCaretMode(text, preedit ?? "") === "blink";
  const showPlaceholder = showPromptPlaceholder(text, preedit ?? "", placeholder);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!blink) {
      setTick(0);
      return;
    }
    setTick(0);
    const timer = setInterval(() => setTick((value) => value + 1), 530);
    return () => clearInterval(timer);
  }, [text, cursor, anchor, blink]);
  const parts = composing ? [] : promptSegments(text, cursor, anchor, tick);
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={0}>
      {hint ? <Text color={theme.muted}>{hint}</Text> : null}
      <Box borderStyle="round" borderColor={theme.accent} paddingLeft={1} paddingRight={1} flexShrink={0}>
        <Box flexShrink={0}>
          <Text>
            <Text color={theme.accent}>{"> "}</Text>
            {composing ? (
              <Text underline color={theme.text}>{preedit ?? ""}</Text>
            ) : (
              parts.map((part, index) =>
                part.inverse ? (
                  <Text key={index} inverse color={theme.text}>
                    {part.text}
                  </Text>
                ) : (
                  <Text key={index} color={theme.text}>
                    {part.text}
                  </Text>
                ),
              )
            )}
          </Text>
        </Box>
        {showPlaceholder ? <Box flexGrow={1} /> : null}
        {showPlaceholder ? (
          <Text color={theme.muted} wrap="truncate-end">{placeholder}</Text>
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
  const line = footerModeLine(mode, approval);
  return (
    <Box flexShrink={0}>
      <Text color={approval === "auto" ? "yellow" : theme.mode[mode]}>{line}</Text>
      {hint ? <Text color={theme.muted}>{` · ${hint}`}</Text> : null}
      {shell ? <Text color={theme.muted}> · shell on</Text> : null}
      {session ? <Text color={theme.muted}>{` · ${session}`}</Text> : null}
      {goal ? <Text color={theme.muted}>{` · ${goal}`}</Text> : null}
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
        <Text key={index} color={theme.muted} wrap="truncate-end">
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
      <Text color={theme.muted}>{label}</Text>
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
      <Text color={theme.accent}>命令</Text>
      {slice.map((line, index) => (
        <Text key={`${start}:${index}`} color={theme.muted}>{line || " "}</Text>
      ))}
      <Text color={theme.muted}>{`${from}–${to}/${lines.length}  ·  ↑↓ 滚动 · Esc 关闭 · 不可用命令只提示一行`}</Text>
    </Box>
  );
}

export function HelpPanel({ theme }: { theme: Theme }) {
  const rows: Array<[string, string]> = [
    ["enter", "send"],
    ["\\ + enter", "newline"],
    ["shift+tab", "cycle permission mode"],
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
    ["/", "commands"],
    ["/model", "model list · ←→ effort · alt+p"],
    ["/effort", "Faster/Smarter track · tab toggles UltraCode"],
    ["alt+p", "model list and effort row"],
    ["pgup / wheel", "earlier messages"],
  ];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border} paddingX={1} marginTop={1}>
      <Text color={theme.accent}>shortcuts</Text>
      {rows.map(([key, label]) => (
        <Text key={key}>
          <Text color={theme.text}>{key.padEnd(16)}</Text>
          <Text color={theme.muted}>{label}</Text>
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
              <Text key={lineIndex} color={color} wrap="truncate-end">{line}</Text>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

export function PermissionDialog({ theme, prompt, selected }: { theme: Theme; prompt: PermissionPrompt; selected: number }) {
  const options = ["Yes", prompt.allowLabel, "No, and tell Glue what to do differently"];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold color={theme.text}>{prompt.title}</Text>
      <Text color={theme.muted}>{trim(prompt.detail, 200)}</Text>
      {prompt.diff?.length ? <DiffView lines={prompt.diff} theme={theme} /> : null}
      <Text color={theme.text}>Do you want to proceed?</Text>
      {options.map((option, index) => (
        <Text key={option} color={index === selected ? theme.accent : theme.text}>
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
}: {
  theme: Theme;
  rows: Array<{ id: string; title: string; meta: string }>;
  selected: number;
  query: string;
  matchCount: number;
  preview: string[];
}) {
  const filter = query ? `filter: ${query}` : "filter: type to search";
  const count = `${matchCount} ${matchCount === 1 ? "session" : "sessions"}`;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold color={theme.text}>Resume session</Text>
      <Text color={theme.muted}>{`${filter}  ·  ${count}`}</Text>
      {rows.length === 0 ? <Text color={theme.muted}>No matching sessions</Text> : null}
      {rows.map((row, index) => (
        <Box key={row.id} flexDirection="column">
          <Text color={index === selected ? theme.accent : theme.text}>
            {index === selected ? "❯ " : "  "}
            {row.title}
          </Text>
          <Text color={theme.muted}>{`    ${row.meta}`}</Text>
        </Box>
      ))}
      {rows.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted}>preview</Text>
          {preview.length ? (
            preview.map((line, index) => (
              <Text key={index} color={theme.text}>{line}</Text>
            ))
          ) : (
            <Text color={theme.muted}>Empty session</Text>
          )}
        </Box>
      ) : null}
      <Text color={theme.muted}>↑↓ select · enter resume · esc cancel</Text>
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
      <Text color={theme.border}>{rule}</Text>
      <Text bold color={theme.text}>Select model</Text>
      <Text color={theme.muted}>Switch the model for this session. The list is the configured ids.</Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, index) => (
          <ModelListRow key={`${entry.number}:${entry.id}`} line={lines[index] ?? ""} entry={entry} theme={theme} />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={effortColor(effort, tick)}>◎ </Text>
        <EffortWord level={effort} tick={tick} />
        <Text bold color={effortColor(effort, tick)}> effort</Text>
        <Text color={theme.muted}>  ←/→ to adjust</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>Enter to select · Esc to cancel</Text>
      </Box>
    </Box>
  );
}

function ModelListRow({ line, entry, theme }: { line: string; entry: ModelListEntry; theme: Theme }) {
  const idAt = line.indexOf(entry.id);
  const descAt = line.lastIndexOf(entry.description);
  if (idAt < 0 || descAt < idAt) return <Text color={theme.text}>{line}</Text>;
  const nameColor = entry.current ? "green" : theme.text;
  const gapColor = entry.current ? "green" : theme.muted;
  return (
    <Text>
      <Text color={entry.focused ? theme.accent : theme.muted}>{line.slice(0, idAt)}</Text>
      <Text color={nameColor} bold={entry.current}>{entry.id}</Text>
      <Text color={gapColor}>{line.slice(idAt + entry.id.length, descAt)}</Text>
      <Text color={theme.muted}>{line.slice(descAt)}</Text>
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
      <Text bold color={theme.text}>Effort</Text>
      <Box marginTop={1}>
        <Box flexDirection="column">
          <Text>
            <Text color={theme.muted}>{knob >= 0 ? lines.track.slice(0, knob) : lines.track}</Text>
            {knob >= 0 ? <Text color={tone}>▲</Text> : null}
            {knob >= 0 ? <Text color={theme.muted}>{lines.track.slice(knob + 1)}</Text> : null}
          </Text>
          <EffortLabels labels={lines.labels} name={choice} nameAt={nameAt} tick={tick} muted={theme.muted} />
        </Box>
        <Box flexDirection="column" marginLeft={4}>
          <Text color="#c084fc">{ultracode ? "Ultracode on" : "Ultracode off"}</Text>
          <Text color={theme.muted}>Tab to toggle</Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={ultracode ? "#c084fc" : theme.text}>
          {ultracode ? ULTRACODE_DESCRIPTION : effortBlurb(choice)}
        </Text>
      </Box>
      {caution ? (
        <Text color={theme.muted}>May use excessive tokens resulting in long response times or overthinking. Use sparingly for the hardest tasks.</Text>
      ) : null}
      <Text color={theme.muted}>←/→ to adjust · Enter to confirm · Esc to cancel</Text>
    </Box>
  );
}

function EffortWord({ level, tick }: { level: string; tick: number }) {
  const title = effortTitle(level);
  if (level !== "xhigh") return <Text bold color={effortColor(level, tick)}>{title}</Text>;
  return (
    <Text bold>
      {title.split("").map((glyph, index) => (
        <Text key={`${glyph}:${index}`} color={effortGlyphColor("xhigh", index, title.length, tick)}>{glyph}</Text>
      ))}
    </Text>
  );
}

function EffortLabels({
  labels,
  name,
  nameAt,
  tick,
  muted,
}: {
  labels: string;
  name: string;
  nameAt: number;
  tick: number;
  muted: string;
}) {
  if (nameAt < 0) return <Text color={muted}>{labels}</Text>;
  const end = nameAt + name.length;
  return (
    <Text>
      <Text color={muted}>{labels.slice(0, nameAt)}</Text>
      {name === "xhigh" ? (
        name.split("").map((glyph, index) => (
          <Text key={`${glyph}:${index}`} color={effortGlyphColor("xhigh", index, name.length, tick)}>{glyph}</Text>
        ))
      ) : (
        <Text color={effortColor(name, tick)} bold>{labels.slice(nameAt, end)}</Text>
      )}
      <Text color={muted}>{labels.slice(end)}</Text>
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
      <Text bold color={theme.text}>{title}</Text>
      {body ? <Text color={theme.muted}>{body}</Text> : null}
      {options.map((option, index) => (
        <Text key={option} color={index === selected ? theme.accent : theme.text}>
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
