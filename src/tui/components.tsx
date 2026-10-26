import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { compactDiff } from "../diff.js";
import { modeLabel } from "../permissions.js";
import { displayName } from "../render/format.js";
import type { DiffLine, PermissionMode, TodoItem, TokenUsage, TranscriptItem } from "../types.js";
import { VERSION } from "../version.js";
import type { PermissionPrompt } from "../agent/loop.js";
import { promptSegments } from "./caret.js";
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
        <Box key={item.id} flexDirection="column" marginTop={item.type === "user" ? 1 : 0}>
          {item.type === "user" ? <UserLine item={item} theme={theme} /> : null}
          {item.type === "assistant" ? <Text color={theme.text}>{item.text || (item.streaming ? "" : "")}</Text> : null}
          {item.type === "system" ? <Text color={theme.muted}>{item.text}</Text> : null}
          {item.type === "error" ? <Text color={theme.bad}>{item.text}</Text> : null}
          {item.type === "tool" ? <ToolBlock item={item} theme={theme} expanded={expanded} /> : null}
        </Box>
      ))}
    </Box>
  );
}

function UserLine({ item, theme }: { item: Extract<TranscriptItem, { type: "user" }>; theme: Theme }) {
  return (
    <Box flexDirection="column">
      <Text color={item.queued ? theme.muted : theme.text}>
        <Text color={theme.accent}>{item.queued ? "… " : "> "}</Text>
        {item.text}
      </Text>
      {item.attached?.length ? <Text color={theme.muted}>{`  attached ${item.attached.join(", ")}`}</Text> : null}
    </Box>
  );
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
      <Text>
        <Text color={theme.accent}>⏺ </Text>
        <Text bold color={theme.text}>{displayName(item.name)}</Text>
        <Text color={theme.muted}>{item.target ? `(${trim(item.target, 90)})` : ""}</Text>
        {item.status === "running" ? <Text color={theme.muted}> …</Text> : null}
      </Text>
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
}: {
  theme: Theme;
  text: string;
  cursor: number;
  anchor?: number | null;
  placeholder?: string;
  hint?: string;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(0);
    const timer = setInterval(() => setTick((value) => value + 1), 530);
    return () => clearInterval(timer);
  }, [text, cursor, anchor]);
  const parts = promptSegments(text, cursor, anchor, tick);
  const showPlaceholder = text.length === 0 && placeholder;
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={0}>
      {hint ? <Text color={theme.muted}>{hint}</Text> : null}
      <Box borderStyle="round" borderColor={theme.accent} paddingLeft={1} paddingRight={1} flexShrink={0}>
        <Text>
          <Text color={theme.accent}>{"> "}</Text>
          {parts.map((part, index) =>
            part.inverse ? (
              <Text key={index} inverse color={theme.text}>
                {part.text}
              </Text>
            ) : (
              <Text key={index} color={theme.text}>
                {part.text}
              </Text>
            ),
          )}
          {showPlaceholder ? <Text color={theme.muted}>{placeholder}</Text> : null}
        </Text>
      </Box>
    </Box>
  );
}

export function StatusBar({
  theme,
  mode,
  usage,
  hint,
  effort,
}: {
  theme: Theme;
  mode: PermissionMode;
  usage: TokenUsage;
  hint?: string;
  effort?: string;
}) {
  const tokens = usage.input + usage.output;
  const tokenLabel = tokens > 0 ? `  ${formatTokens(tokens)} tok` : "";
  const effortLabel = effort ? ` · effort ${effort}` : "";
  return (
    <Box marginTop={0} flexShrink={0}>
      <Text color={theme.muted}>{hint || "? for shortcuts"}{effortLabel}{tokenLabel}</Text>
      <Box flexGrow={1} />
      <Text color={theme.mode[mode]}>{modeLabel(mode)}</Text>
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
    ["/model", "model list · ←→ effort"],
    ["/effort", "low, medium, high, xhigh, max, auto"],
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
}: {
  theme: Theme;
  rows: Array<{ name: string; summary: string }>;
  selected: number;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {rows.map((row, index) => (
        <Text key={row.name} color={index === selected ? theme.accent : theme.muted}>
          {index === selected ? "❯ " : "  "}
          /{row.name.padEnd(16)}
          {row.summary}
        </Text>
      ))}
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
  position,
  effort,
}: {
  theme: Theme;
  rows: string[];
  selected: number;
  position: string;
  effort: string;
}) {
  return (
    <Box flexDirection="column" flexShrink={0} borderStyle="round" borderColor={theme.accent} paddingX={1} marginTop={1}>
      <Text bold color={theme.text}>Model</Text>
      <Text color={theme.muted}>{position}</Text>
      {rows.map((row, index) => (
        <Text key={`${row}:${index}`} color={index === selected ? theme.accent : theme.text}>
          {index === selected ? "❯ " : "  "}
          {row}
        </Text>
      ))}
      <Text color={theme.muted}>{`↑↓ model · ←→ effort ${effort} · enter select · esc cancel`}</Text>
    </Box>
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

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
