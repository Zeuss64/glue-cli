import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";
import type { Key } from "ink";
import { runAgentTurn, type PermissionChoice, type PermissionPrompt } from "../agent/loop.js";
import type { AppConfig } from "../config.js";
import {
  filterCommands,
  gitText,
  isImmediateCommand,
  readMemoryPreview,
  runSlashCommand,
  type CommandHost,
} from "../commands.js";
import { listProjectFiles, completePath } from "../files.js";
import { createId } from "../id.js";
import { createOpenAIClient } from "../llm/client.js";
import { expandMentions, mentionQuery } from "../mentions.js";
import { nextMode } from "../permissions.js";
import { buildSystemPrompt, memoryPath } from "../prompt.js";
import { snapsToRestore } from "../rewind.js";
import { Sandbox } from "../sandbox.js";
import {
  appendPromptHistory,
  createSession,
  findSessionFile,
  listSessions,
  loadSession,
  readPromptHistory,
  SessionLog,
  type SessionSnapshot,
} from "../session.js";
import type { ToolContext } from "../tools/execute.js";
import { executeTool } from "../tools/execute.js";
import { toolDefinitions } from "../tools/defs.js";
import type { ChatMessage, FileSnap, PermissionMode, TodoItem, TokenUsage, TranscriptItem } from "../types.js";
import { emptyEditor, reduceEditor, type EditorState, type KeyIn } from "./editor.js";
import {
  ChoiceDialog,
  Header,
  HelpPanel,
  PermissionDialog,
  PromptBox,
  SlashMenu,
  Spinner,
  StatusBar,
  TodoList,
  TranscriptView,
  Welcome,
} from "./components.js";
import { NAMED_ACCENTS, THEMES, type Theme } from "./theme.js";

export interface Boot {
  config: AppConfig;
  initialPrompt?: string;
  resumeFile?: string;
  openResume?: boolean;
  includeBypass: boolean;
  addDirs: string[];
  appendSystem?: string;
}

interface Checkpoint {
  id: string;
  label: string;
  messageIndex: number;
  itemCount: number;
  files: FileSnap[];
}

type Phase =
  | { type: "idle" }
  | { type: "running" }
  | {
      type: "permission";
      prompt: PermissionPrompt;
      selected: number;
      step: "choose" | "feedback";
      feedback: string;
      resolve: (choice: PermissionChoice) => void;
    }
  | {
      type: "ask";
      question: string;
      options: string[];
      selected: number;
      other: boolean;
      otherText: string;
      resolve: (answer: string) => void;
    }
  | { type: "plan"; plan: string; selected: number; resolve: (answer: { approved: boolean; feedback?: string }) => void };

type Picker =
  | { kind: "resume"; rows: SessionSnapshot[]; selected: number }
  | { kind: "rewind"; rows: Checkpoint[]; selected: number };

export async function startTui(boot: Boot): Promise<void> {
  const title = `\x1b]0;Glue ${path.basename(boot.config.workspace)}\x07`;
  process.stdout.write(title);
  const instance = render(<App boot={boot} />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
  process.stdout.write("\x1b]0;\x07");
}

function App({ boot }: { boot: Boot }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [rows, setRows] = useState(stdout?.rows ?? 24);
  const [cols, setCols] = useState(stdout?.columns ?? 100);
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [phase, setPhase] = useState<Phase>({ type: "idle" });
  const [editor, setEditorState] = useState<EditorState>(() => emptyEditor(boot.config.editor === "vim"));
  const [mode, setModeState] = useState<PermissionMode>(boot.config.permissionMode);
  const [model, setModelState] = useState(boot.config.model);
  const [profile, setProfileState] = useState(boot.config.profile);
  const [themeName, setThemeName] = useState(boot.config.theme);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [help, setHelp] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showTodos, setShowTodos] = useState(true);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [usage, setUsage] = useState<TokenUsage>({ input: 0, output: 0 });
  const [scroll, setScroll] = useState(0);
  const [hint, setHint] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [spinFrom, setSpinFrom] = useState(0);
  const [outputStyle, setOutputStyle] = useState(boot.config.outputStyle);
  const [shellEnabled, setShellEnabled] = useState(boot.config.shellEnabled);
  const [sessionName, setSessionName] = useState("");
  const [picker, setPicker] = useState<Picker | null>(null);
  const [rev, setRev] = useState<{ query: string; index: number; prev: EditorState } | null>(null);
  const [branch, setBranch] = useState<string | undefined>(() => gitBranch(boot.config.workspace));
  const [cwdLabel, setCwdLabel] = useState(() => shorten(boot.config.workspace));

  const itemsRef = useRef<TranscriptItem[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const modeRef = useRef(mode);
  const modelRef = useRef(model);
  const profileRef = useRef(profile);
  const styleRef = useRef(outputStyle);
  const shellRef = useRef(shellEnabled);
  const workspaceRef = useRef(boot.config.workspace);
  const rootsRef = useRef<string[]>([boot.config.workspace, ...boot.addDirs]);
  const rulesRef = useRef({
    allow: [...boot.config.permissions.allow],
    deny: [...boot.config.permissions.deny],
    ask: [...boot.config.permissions.ask],
  });
  const usageRef = useRef(usage);
  const logRef = useRef<SessionLog | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const historyRef = useRef<string[]>(readPromptHistory(boot.config.workspace));
  const historyPos = useRef<number | null>(null);
  const draftRef = useRef("");
  const stashRef = useRef<EditorState | null>(null);
  const lastCtrlC = useRef(0);
  const lastEsc = useRef(0);
  const lastCtrlD = useRef(0);
  const bgRef = useRef(false);
  const checkpointsRef = useRef<Checkpoint[]>([]);
  const editorRef = useRef(editor);
  function commitEditor(next: EditorState | ((current: EditorState) => EditorState)): void {
    const resolved = typeof next === "function" ? next(editorRef.current) : next;
    editorRef.current = resolved;
    setEditorState(resolved);
  }
  const phaseRef = useRef(phase);
  const runTurnRef = useRef<(text: string, opts?: TurnOpts) => Promise<void>>(async () => {});
  const [taskRev, setTaskRev] = useState(0);

  const ctxRef = useRef<ToolContext>({
    sandbox: new Sandbox(rootsRef.current),
    shellEnabled: boot.config.shellEnabled,
    shellCwd: path.resolve(boot.config.workspace),
    readFiles: new Set<string>(),
    todos: [],
    tasks: new Map(),
    consumeBackground: () => {
      if (!bgRef.current) return false;
      bgRef.current = false;
      return true;
    },
  });

  modeRef.current = mode;
  modelRef.current = model;
  profileRef.current = profile;
  styleRef.current = outputStyle;
  shellRef.current = shellEnabled;
  editorRef.current = editor;
  phaseRef.current = phase;
  usageRef.current = usage;
  ctxRef.current.shellEnabled = shellEnabled;

  const theme = useMemo<Theme>(() => {
    const base = THEMES[themeName] ?? THEMES.dark;
    return accent ? { ...base, accent } : base;
  }, [themeName, accent]);

  const placeholder = useMemo(() => suggest(boot.config.workspace), [boot.config.workspace]);

  function rebuildSystem(): void {
    const content = buildSystemPrompt({
      workspace: workspaceRef.current,
      profile: profileRef.current,
      permissionMode: modeRef.current,
      shellEnabled: shellRef.current,
      outputStyle: styleRef.current,
      extraRoots: rootsRef.current.slice(1),
      append: boot.appendSystem,
    });
    const messages = messagesRef.current;
    if (messages[0]?.role === "system") messages[0] = { role: "system", content };
    else messages.unshift({ role: "system", content });
  }

  function pushItem(item: TranscriptItem, persist = true): void {
    itemsRef.current = [...itemsRef.current, item];
    setItems(itemsRef.current);
    if (persist) logRef.current?.item(item);
  }

  function patchItem(id: string, update: (item: TranscriptItem) => TranscriptItem): void {
    itemsRef.current = itemsRef.current.map((item) => (item.id === id ? update(item) : item));
    setItems(itemsRef.current);
  }

  function system(text: string, kind: "system" | "error" = "system"): void {
    pushItem({ id: createId("s"), type: kind, text });
  }

  const hostRef = useRef<CommandHost>(null as unknown as CommandHost);
  hostRef.current = {
    workspace: workspaceRef.current,
    config: { ...boot.config, model, permissionMode: mode, profile, workspace: workspaceRef.current, shellEnabled, outputStyle, theme: themeName },
    model,
    permissionMode: mode,
    profile,
    themeName,
    editor: editor.vim ? "vim" : "normal",
    outputStyle,
    shellEnabled,
    usage,
    contextWindow: boot.config.contextWindow,
    sessionName,
    sessionId: logRef.current?.meta.id ?? "",
    rules: rulesRef.current,
    tasks: taskRev >= 0 ? [...ctxRef.current.tasks.values()].map((task) => ({ id: task.id, command: task.command, status: task.status })) : [],
    push: (text, kind) => system(text, kind ?? "system"),
    setModel: (next) => {
      modelRef.current = next;
      setModelState(next);
      logRef.current?.updateMeta({ model: next });
    },
    setMode: (next) => {
      modeRef.current = next;
      setModeState(next);
      logRef.current?.updateMeta({ permissionMode: next });
      rebuildSystem();
    },
    setProfile: (next) => {
      profileRef.current = next;
      setProfileState(next);
      rebuildSystem();
    },
    setTheme: (next) => setThemeName(next),
    setAccent: (name) => {
      if (!name || name === "default") {
        setAccent(undefined);
        system("Accent reset.");
        return;
      }
      const color = NAMED_ACCENTS[name];
      if (!color) {
        system(`Unknown color ${name}. Try red, blue, green, yellow, purple, orange, pink, cyan.`, "error");
        return;
      }
      setAccent(color);
      system(`Accent set to ${name}.`);
    },
    setEditor: (next) => commitEditor((current) => ({ ...current, vim: next === "vim", vimMode: "insert" })),
    setOutputStyle: (next) => {
      styleRef.current = next;
      setOutputStyle(next);
      rebuildSystem();
    },
    setShell: (enabled) => {
      shellRef.current = enabled;
      setShellEnabled(enabled);
      ctxRef.current.shellEnabled = enabled;
      rebuildSystem();
    },
    setSessionName: (name) => {
      setSessionName(name);
      logRef.current?.updateMeta({ name });
    },
    addRule: (kind, rule) => {
      rulesRef.current[kind].push(rule);
    },
    clear: () => {
      const log = createSession(workspaceRef.current, {
        cwd: workspaceRef.current,
        model: modelRef.current,
        profile: profileRef.current,
        permissionMode: modeRef.current,
      });
      logRef.current = log;
      messagesRef.current = [];
      rebuildSystem();
      itemsRef.current = [];
      setItems([]);
      checkpointsRef.current = [];
      setSessionName("");
      system("Started a new conversation. Project memory is unchanged. /resume returns to the previous one.");
    },
    exit: () => requestExit(),
    runTurn: (text, opts) => runTurnRef.current(text, opts),
    compact: async (instructions) => {
      const summary = await sideText(
        `Summarize this conversation so another coding agent can continue. Include the goal, files changed, decisions, and remaining work. ${instructions}`.trim(),
        true,
      );
      const note = `[Conversation compacted]\n\n${summary}`;
      messagesRef.current = messagesRef.current.filter((message) => message.role === "system");
      messagesRef.current.push({ role: "user", content: note });
      const nextItems: TranscriptItem[] = [
        { id: createId("s"), type: "system", text: "Compacted the conversation." },
        { id: createId("u"), type: "user", text: summary },
      ];
      itemsRef.current = nextItems;
      setItems(nextItems);
      logRef.current?.replace(messagesRef.current, nextItems, ctxRef.current.todos);
    },
    btw: async (question) => {
      const answer = await sideText(`Side question, do not use tools and do not continue the task:\n${question}`, true);
      system(`btw: ${answer}`);
    },
    recap: async () => {
      const answer = await sideText("One sentence recap of this session. No preamble.", true);
      system(answer || "Nothing to recap yet.");
    },
    resume: async (id) => {
      if (!id) {
        const rows = listSessions(workspaceRef.current);
        if (!rows.length) {
          system("No saved sessions.");
          return;
        }
        setPicker({ kind: "resume", rows, selected: 0 });
        return;
      }
      const file = findSessionFile(workspaceRef.current, id);
      if (!file) {
        system(`No session matches ${id}.`, "error");
        return;
      }
      applySnapshot(loadSession(file), file);
    },
    rewind: (index) => {
      const rows = checkpointsRef.current;
      if (!rows.length) {
        system("Nothing to rewind in this process. Checkpoints last for the current session.");
        return;
      }
      if (index === undefined || Number.isNaN(index)) {
        setPicker({ kind: "rewind", rows, selected: rows.length - 1 });
        return;
      }
      restoreCheckpoint(index);
    },
    branch: (name) => {
      const log = createSession(workspaceRef.current, {
        cwd: workspaceRef.current,
        model: modelRef.current,
        profile: profileRef.current,
        permissionMode: modeRef.current,
        name: name || `${sessionName || "branch"}`,
      });
      for (const message of messagesRef.current) log.message(message);
      for (const item of itemsRef.current) log.item(item);
      logRef.current = log;
      setSessionName(log.meta.name);
      system(`Branched to ${log.meta.id}. The previous session is still on disk.`);
    },
    addDir: (dir) => {
      const abs = path.resolve(workspaceRef.current, dir);
      if (!existsSync(abs)) {
        system(`No such directory: ${abs}`, "error");
        return;
      }
      rootsRef.current = [...rootsRef.current, abs];
      ctxRef.current.sandbox = new Sandbox(rootsRef.current);
      rebuildSystem();
      system(`Added ${abs}`);
    },
    cd: (dir) => {
      const abs = path.resolve(workspaceRef.current, dir);
      if (!existsSync(abs)) {
        system(`No such directory: ${abs}`, "error");
        return;
      }
      process.chdir(abs);
      workspaceRef.current = abs;
      rootsRef.current = [abs, ...rootsRef.current.slice(1)];
      ctxRef.current.sandbox = new Sandbox(rootsRef.current);
      ctxRef.current.shellCwd = ctxRef.current.sandbox.primary;
      setCwdLabel(shorten(abs));
      setBranch(gitBranch(abs));
      rebuildSystem();
      system(`Workspace is now ${abs}`);
    },
    killTask: (id) => {
      const task = ctxRef.current.tasks.get(id);
      if (!task) {
        system(`No task ${id}.`, "error");
        return;
      }
      task.child?.kill("SIGTERM");
      task.status = "killed";
      setTaskRev((value) => value + 1);
      system(`Killed ${id}.`);
    },
    copyLast: () => {
      const last = [...itemsRef.current].reverse().find((item) => item.type === "assistant");
      const text = last && last.type === "assistant" ? last.text : "";
      const file = path.join(workspaceRef.current, ".agent", "last-response.md");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text + "\n");
      system(text ? `Saved the last reply to ${file}` : "No assistant reply to copy.");
    },
    exportSession: (file) => {
      const target = path.resolve(workspaceRef.current, file || `.agent/sessions/${logRef.current?.meta.id ?? "session"}.md`);
      const body = itemsRef.current
        .map((item) => {
          if (item.type === "user") return `> ${item.text}`;
          if (item.type === "assistant") return item.text;
          if (item.type === "tool") return `⏺ ${item.name}(${item.target})\n  ⎿  ${item.summary ?? ""}`;
          return item.text;
        })
        .join("\n\n");
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, body + "\n");
      system(`Exported to ${target}`);
    },
    showMemory: () => system(readMemoryPreview(workspaceRef.current)),
    showDiff: () => system(clip(gitText(workspaceRef.current, ["diff", "--stat"]) + "\n\n" + gitText(workspaceRef.current, ["diff"]), 8000)),
  };
  function applySnapshot(snap: SessionSnapshot, file: string): void {
    logRef.current = SessionLog.open(file);
    const convo = snap.messages.filter((message) => message.role !== "system");
    messagesRef.current = convo;
    if (snap.meta.permissionMode === "default" || snap.meta.permissionMode === "acceptEdits" || snap.meta.permissionMode === "plan" || snap.meta.permissionMode === "dontAsk" || snap.meta.permissionMode === "bypassPermissions") {
      modeRef.current = snap.meta.permissionMode;
      setModeState(snap.meta.permissionMode);
    }
    if (snap.meta.model) {
      modelRef.current = snap.meta.model;
      setModelState(snap.meta.model);
    }
    setSessionName(snap.meta.name);
    rebuildSystem();
    itemsRef.current = snap.items;
    setItems(snap.items);
    ctxRef.current.todos.splice(0, ctxRef.current.todos.length, ...snap.todos);
    setTodos([...snap.todos]);
    system(`Resumed ${snap.meta.id}${snap.meta.name ? ` · ${snap.meta.name}` : ""}`);
  }

  function restoreCheckpoint(index: number): void {
    const rows = checkpointsRef.current;
    if (index < 0 || index >= rows.length) {
      system(`No checkpoint ${index}.`, "error");
      return;
    }
    const snaps = snapsToRestore(rows, index);
    for (const snap of snaps) {
      if (snap.content === null) rmSync(snap.path, { force: true });
      else writeFileSync(snap.path, snap.content);
    }
    const point = rows[index] as Checkpoint;
    messagesRef.current = messagesRef.current.slice(0, point.messageIndex);
    itemsRef.current = itemsRef.current.slice(0, point.itemCount);
    checkpointsRef.current = rows.slice(0, index);
    setItems(itemsRef.current);
    logRef.current?.replace(messagesRef.current, itemsRef.current, ctxRef.current.todos);
    system(`Rewound to before “${point.label}”. Restored ${snaps.length} file snapshot${snaps.length === 1 ? "" : "s"}.`);
  }

  function requestExit(): void {
    abortRef.current?.abort();
    for (const task of ctxRef.current.tasks.values()) task.child?.kill("SIGTERM");
    exit();
  }

  async function sideText(instruction: string, withHistory: boolean): Promise<string> {
    if (!boot.config.apiKey) return "No API key is set, so Glue cannot ask the model.";
    const messages: ChatMessage[] = withHistory
      ? [...messagesRef.current]
      : [{ role: "system", content: "You are Glue, a concise coding assistant." }];
    messages.push({ role: "user", content: instruction });
    let text = "";
    const result = await createOpenAIClient({ ...boot.config, model: modelRef.current }).stream(messages, [], undefined, (delta) => {
      if (delta.text) text += delta.text;
      if (delta.usage) setUsage((current) => ({ input: current.input + delta.usage!.input, output: current.output + delta.usage!.output }));
    });
    return (result.text || text).trim();
  }

  async function runTurn(text: string, opts: TurnOpts = {}): Promise<void> {
    if (busyRef.current) {
      queueRef.current.push(text);
      pushItem({ id: createId("q"), type: "user", text: opts.display ?? text, queued: true }, false);
      return;
    }
    busyRef.current = true;
    setPhase({ type: "running" });
    setSpinFrom(Date.now());
    setScroll(0);
    const display = opts.display ?? text;
    const expanded = expandMentions(text, ctxRef.current.sandbox, ctxRef.current.readFiles);
    if (opts.alreadyShown) {
      itemsRef.current = itemsRef.current.map((item) =>
        item.type === "user" && item.queued && item.text === display ? { ...item, queued: false, attached: expanded.attached } : item,
      );
      setItems(itemsRef.current);
    } else {
      pushItem({ id: createId("u"), type: "user", text: display, attached: expanded.attached });
    }
    rebuildSystem();
    messagesRef.current.push({ role: "user", content: expanded.text });
    logRef.current?.message(messagesRef.current[messagesRef.current.length - 1] as ChatMessage);
    const checkpoint: Checkpoint = {
      id: createId("cp"),
      label: display.slice(0, 80),
      messageIndex: messagesRef.current.length - 1,
      itemCount: itemsRef.current.length - 1,
      files: [],
    };
    checkpointsRef.current.push(checkpoint);
    ctxRef.current.noteFile = (filePath, before) => {
      if (!checkpoint.files.some((file) => file.path === filePath)) checkpoint.files.push({ path: filePath, content: before });
    };
    const ac = new AbortController();
    abortRef.current = ac;
    ctxRef.current.signal = ac.signal;
    const before = messagesRef.current.length;
    let assistantId: string | null = null;
    try {
      await runAgentTurn({
        client: createOpenAIClient({ ...boot.config, model: modelRef.current }),
        messages: messagesRef.current,
        tools: toolDefinitions(shellRef.current),
        ctx: ctxRef.current,
        maxSteps: boot.config.maxSteps,
        signal: ac.signal,
        readOnly: opts.readOnly,
        hooks: {
          onTextDelta: (chunk) => {
            if (!assistantId) {
              assistantId = createId("a");
              pushItem({ id: assistantId, type: "assistant", text: chunk, streaming: true }, false);
            } else {
              const id = assistantId;
              patchItem(id, (item) => (item.type === "assistant" ? { ...item, text: item.text + chunk } : item));
            }
          },
          onSegmentDone: (full) => {
            if (!assistantId) return;
            const id = assistantId;
            assistantId = null;
            patchItem(id, (item) => (item.type === "assistant" ? { ...item, text: full, streaming: false } : item));
            const finalItem = itemsRef.current.find((item) => item.id === id);
            if (finalItem) logRef.current?.item(finalItem);
          },
          onToolStart: (event) => {
            assistantId = null;
            pushItem({ id: event.id, type: "tool", name: event.name, target: event.target, status: "running" }, false);
          },
          onToolEnd: (event) => {
            patchItem(event.id, (item) =>
              item.type === "tool"
                ? {
                    ...item,
                    status: event.denied ? "denied" : event.ok ? "ok" : "error",
                    summary: event.summary,
                    diff: event.diff,
                    detail: event.detail,
                  }
                : item,
            );
            const finalItem = itemsRef.current.find((item) => item.id === event.id);
            if (finalItem) logRef.current?.item(finalItem);
            setTodos([...ctxRef.current.todos]);
            setTaskRev((value) => value + 1);
          },
          onUsage: (part) => setUsage((current) => ({ input: current.input + part.input, output: current.output + part.output })),
          onNotice: (text) => system(text),
          askPermission: (prompt) =>
            new Promise((resolve) => {
              setPhase({
                type: "permission",
                prompt,
                selected: 0,
                step: "choose",
                feedback: "",
                resolve: (choice) => {
                  setPhase({ type: "running" });
                  resolve(choice);
                },
              });
            }),
          askUser: (question, options) =>
            new Promise((resolve) => {
              setPhase({
                type: "ask",
                question,
                options,
                selected: 0,
                other: false,
                otherText: "",
                resolve: (answer) => {
                  setPhase({ type: "running" });
                  resolve(answer);
                },
              });
            }),
          askPlan: (plan) =>
            new Promise((resolve) => {
              setPhase({
                type: "plan",
                plan,
                selected: 0,
                resolve: (answer) => {
                  setPhase({ type: "running" });
                  resolve(answer);
                },
              });
            }),
          getMode: () => modeRef.current,
          setMode: (next) => hostRef.current.setMode(next),
          getRules: () => rulesRef.current,
          addRule: (kind, rule) => hostRef.current.addRule(kind, rule),
        },
      });
      for (const message of messagesRef.current.slice(before)) logRef.current?.message(message);
    } catch (error) {
      const aborted = ac.signal.aborted || (error instanceof Error && error.name === "AbortError");
      system(aborted ? "Interrupted. Work already applied is kept." : error instanceof Error ? error.message : String(error), aborted ? "system" : "error");
    } finally {
      abortRef.current = null;
      busyRef.current = false;
      setPhase({ type: "idle" });
      const next = queueRef.current.shift();
      if (next) await runTurn(next, { alreadyShown: true });
    }
  }
  runTurnRef.current = runTurn;

  async function runBang(command: string): Promise<void> {
    if (!shellRef.current) {
      system("Shell is off. Set shell.enabled = true in .agent/config.toml, then restart the prompt.");
      return;
    }
    pushItem({ id: createId("u"), type: "user", text: `! ${command}` });
    const id = createId("sh");
    pushItem({ id, type: "tool", name: "run_shell", target: command, status: "running" }, false);
    const outcome = await executeTool("run_shell", { command }, ctxRef.current);
    patchItem(id, (item) =>
      item.type === "tool" ? { ...item, status: outcome.ok ? "ok" : "error", summary: outcome.summary, detail: outcome.detail } : item,
    );
    await runTurn(`I ran this command in the terminal:\n\n$ ${command}\n\n${outcome.output}\n\nRespond to the result.`, {
      display: `! ${command}`,
      alreadyShown: true,
    });
  }

  function addMemory(note: string): void {
    const file = path.join(workspaceRef.current, "AGENT.md");
    const prior = existsSync(file) ? readFileSync(file, "utf8").trimEnd() + "\n\n" : "# Project memory\n\n";
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${prior}- ${note.trim()}\n`);
    rebuildSystem();
    system(`Added to ${memoryPath(workspaceRef.current)}`);
  }

  useEffect(() => {
    const roots = rootsRef.current.filter((root) => existsSync(root));
    try {
      ctxRef.current.sandbox = new Sandbox(roots.length ? roots : [boot.config.workspace]);
    } catch (error) {
      system(error instanceof Error ? error.message : String(error), "error");
    }
    if (boot.resumeFile && existsSync(boot.resumeFile)) applySnapshot(loadSession(boot.resumeFile), boot.resumeFile);
    else {
      logRef.current = createSession(boot.config.workspace, {
        cwd: boot.config.workspace,
        model: boot.config.model,
        profile: boot.config.profile,
        permissionMode: boot.config.permissionMode,
      });
      rebuildSystem();
    }
    if (boot.openResume) void hostRef.current.resume();
    else if (boot.initialPrompt) void runTurnRef.current(boot.initialPrompt);
    setFiles(listProjectFiles(workspaceRef.current));
    const onResize = () => {
      setRows(stdout?.rows ?? 24);
      setCols(stdout?.columns ?? 100);
    };
    stdout?.on("resize", onResize);
    return () => {
      stdout?.off("resize", onResize);
    };
    // Startup only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slashMatches = editor.text.startsWith("/") && !editor.text.slice(1).includes(" ") ? filterCommands(editor.text.slice(1)) : [];
  const mention = mentionQuery(editor.text, editor.cursor);
  const fileHits = mention ? completePath(files, mention.query) : [];
  const visible = useMemo(() => windowItems(items, scroll, rows), [items, scroll, rows]);

  useInput((input, key) => {
    for (const chunk of splitInput(input, key)) handleKey(chunk.input, chunk.key);
  });

  function handleKey(input: string, key: Key): void {
    const k = toKey(input, key);
    if (help) {
      if (k.escape || k.input === "?" || k.ctrl) setHelp(false);
      return;
    }
    if (picker) {
      handlePicker(k);
      return;
    }
    if (rev) {
      handleRev(k);
      return;
    }
    const current = phaseRef.current;
    if (current.type === "permission" || current.type === "ask" || current.type === "plan") {
      handleDialog(k, current);
      return;
    }
    if (slashMatches.length && (k.up || k.down) && !editor.text.includes("\n")) {
      setSlashIndex((index) => {
        const next = k.down ? index + 1 : index - 1;
        return (next + slashMatches.length) % slashMatches.length;
      });
      return;
    }
    if (fileHits.length && k.up) {
      setFileIndex((index) => (index - 1 + fileHits.length) % fileHits.length);
      return;
    }
    if (fileHits.length && k.down) {
      setFileIndex((index) => (index + 1) % fileHits.length);
      return;
    }
    const result = reduceEditor(editorRef.current, k);
    commitEditor(result.state);
    const slashQuery = result.state.text.startsWith("/") ? result.state.text.slice(1) : "";
    if (slashQuery && !slashQuery.includes(" ") && !k.up && !k.down) setSlashIndex(0);
    if (!result.effect) return;
    void applyEffect(result.effect, result.state);
  }

  function handleDialog(key: KeyIn, current: Phase): void {
    if (current.type === "permission") {
      if (current.step === "feedback") {
        if (key.escape) current.resolve({ decision: "deny" });
        else if (key.return) current.resolve({ decision: "deny", feedback: current.feedback });
        else if (key.backspace) setPhase({ ...current, feedback: current.feedback.slice(0, -1) });
        else if (key.input && !key.ctrl) setPhase({ ...current, feedback: current.feedback + key.input });
        return;
      }
      const count = 3;
      if (key.escape) current.resolve({ decision: "deny" });
      else if (key.up) setPhase({ ...current, selected: (current.selected + count - 1) % count });
      else if (key.down) setPhase({ ...current, selected: (current.selected + 1) % count });
      else if (key.input === "1") current.resolve({ decision: "allow" });
      else if (key.input === "2") current.resolve({ decision: "allow-session" });
      else if (key.input === "3") setPhase({ ...current, step: "feedback" });
      else if (key.return) {
        if (current.selected === 0) current.resolve({ decision: "allow" });
        else if (current.selected === 1) current.resolve({ decision: "allow-session" });
        else setPhase({ ...current, step: "feedback" });
      } else if (key.ctrl && key.input === "c") {
        current.resolve({ decision: "deny", feedback: "Interrupted." });
        abortRef.current?.abort();
      }
      return;
    }
    if (current.type === "ask") {
      const options = [...current.options, "Other"];
      if (current.other) {
        if (key.escape) current.resolve("The user dismissed the question.");
        else if (key.return) current.resolve(current.otherText || "Other");
        else if (key.backspace) setPhase({ ...current, otherText: current.otherText.slice(0, -1) });
        else if (key.input && !key.ctrl) setPhase({ ...current, otherText: current.otherText + key.input });
        return;
      }
      if (key.escape) current.resolve("The user dismissed the question.");
      else if (key.up) setPhase({ ...current, selected: (current.selected + options.length - 1) % options.length });
      else if (key.down) setPhase({ ...current, selected: (current.selected + 1) % options.length });
      else if (/^[1-9]$/.test(key.input)) {
        const index = Number(key.input) - 1;
        if (index === options.length - 1) setPhase({ ...current, other: true, selected: index });
        else if (options[index]) current.resolve(options[index] as string);
      } else if (key.return) {
        if (current.selected === options.length - 1) setPhase({ ...current, other: true });
        else current.resolve(options[current.selected] ?? options[0] ?? "");
      }
      return;
    }
    if (current.type === "plan") {
      if (key.escape || key.input === "2") current.resolve({ approved: false });
      else if (key.input === "1") current.resolve({ approved: true });
      else if (key.up || key.down) setPhase({ ...current, selected: current.selected === 0 ? 1 : 0 });
      else if (key.return) current.resolve({ approved: current.selected === 0 });
    }
  }

  function handlePicker(key: KeyIn): void {
    if (!picker) return;
    if (key.escape) {
      setPicker(null);
      return;
    }
    const count = picker.rows.length;
    if (key.up) setPicker({ ...picker, selected: (picker.selected + count - 1) % count });
    else if (key.down) setPicker({ ...picker, selected: (picker.selected + 1) % count });
    else if (key.return) {
      const selected = picker.selected;
      if (picker.kind === "resume") {
        const row = picker.rows[selected];
        setPicker(null);
        if (row) {
          const file = findSessionFile(workspaceRef.current, row.meta.id);
          if (file) applySnapshot(loadSession(file), file);
        }
      } else {
        setPicker(null);
        restoreCheckpoint(selected);
      }
    }
  }

  function handleRev(key: KeyIn): void {
    if (!rev) return;
    const matches = historyRef.current.filter((entry) => entry.includes(rev.query)).reverse();
    const current = matches[Math.min(rev.index, Math.max(0, matches.length - 1))] ?? "";
    if (key.escape) {
      commitEditor(rev.prev);
      setRev(null);
    } else if (key.return) {
      setRev(null);
      void submit(current || rev.query);
    } else if (key.tab) {
      commitEditor({ ...rev.prev, text: current, cursor: current.length });
      setRev(null);
    } else if (key.ctrl && key.input === "r") setRev({ ...rev, index: rev.index + 1 });
    else if (key.backspace) setRev({ ...rev, query: rev.query.slice(0, -1), index: 0 });
    else if (key.input && !key.ctrl && !key.meta) setRev({ ...rev, query: rev.query + key.input, index: 0 });
  }

  async function applyEffect(effect: string, state: EditorState): Promise<void> {
    if (effect === "help") {
      setHelp((open) => !open);
      return;
    }
    if (effect === "cycle-mode") {
      const include = boot.includeBypass || modeRef.current === "bypassPermissions";
      const next = nextMode(modeRef.current, include);
      hostRef.current.setMode(next);
      return;
    }
    if (effect === "toggle-expand") {
      setExpanded((value) => !value);
      return;
    }
    if (effect === "toggle-todos") {
      setShowTodos((value) => !value);
      return;
    }
    if (effect === "scroll-up") {
      setScroll((value) => Math.min(itemsRef.current.length - 1, value + 2));
      return;
    }
    if (effect === "scroll-down") {
      setScroll((value) => Math.max(0, value - 2));
      return;
    }
    if (effect === "redraw") {
      setHint("redrawn");
      return;
    }
    if (effect === "background") {
      bgRef.current = true;
      setHint("background requested");
      return;
    }
    if (effect === "stash") {
      if (state.text) {
        stashRef.current = state;
        commitEditor(emptyEditor(state.vim));
        setHint("draft stashed · ctrl+s restores");
      } else if (stashRef.current) {
        commitEditor(stashRef.current);
        stashRef.current = null;
        setHint("");
      }
      return;
    }
    if (effect === "reverse-search") {
      setRev({ query: "", index: 0, prev: state });
      return;
    }
    if (effect === "escape") {
      if (busyRef.current) {
        abortRef.current?.abort();
        return;
      }
      if (state.text.startsWith("!")) {
        commitEditor(emptyEditor(state.vim));
        return;
      }
      const now = Date.now();
      if (state.text && now - lastEsc.current < 450) {
        historyRef.current.push(state.text);
        commitEditor(emptyEditor(state.vim));
        setHint("draft cleared · up to recall");
      }
      lastEsc.current = now;
      return;
    }
    if (effect === "ctrl-c") {
      if (busyRef.current) {
        abortRef.current?.abort();
        return;
      }
      if (state.text) {
        historyRef.current.push(state.text);
        commitEditor(emptyEditor(state.vim));
        setHint("cleared · up to recall");
        return;
      }
      const now = Date.now();
      if (now - lastCtrlC.current < 1000) requestExit();
      else {
        lastCtrlC.current = now;
        setHint("press ctrl+c again to exit");
      }
      return;
    }
    if (effect === "exit-hint") {
      const now = Date.now();
      if (now - lastCtrlD.current < 800) requestExit();
      else {
        lastCtrlD.current = now;
        setHint("press ctrl+d again to exit");
      }
      return;
    }
    if (effect === "history-prev" || effect === "history-next") {
      recall(effect === "history-prev" ? -1 : 1);
      return;
    }
    if (effect === "complete") {
      complete(state);
      return;
    }
    if (effect === "submit") await submit(state.text);
  }

  function recall(dir: -1 | 1): void {
    if (dir < 0 && queueRef.current.length && editorRef.current.text === "") {
      const text = queueRef.current.pop() ?? "";
      itemsRef.current = itemsRef.current.filter((item) => !(item.type === "user" && item.queued && item.text === text));
      setItems(itemsRef.current);
      commitEditor({ ...editorRef.current, text, cursor: text.length });
      return;
    }
    if (historyPos.current === null) {
      draftRef.current = editorRef.current.text;
      historyPos.current = historyRef.current.length;
    }
    const next = historyPos.current + dir;
    if (next >= historyRef.current.length) {
      historyPos.current = null;
      const text = draftRef.current;
      commitEditor({ ...editorRef.current, text, cursor: text.length });
      return;
    }
    if (next < 0) return;
    historyPos.current = next;
    const text = historyRef.current[next] ?? "";
    commitEditor({ ...editorRef.current, text, cursor: text.length });
  }

  function complete(state: EditorState): void {
    if (!state.text && placeholder) {
      commitEditor({ ...state, text: placeholder, cursor: placeholder.length });
      return;
    }
    const slashQuery = state.text.startsWith("/") ? state.text.slice(1) : "";
    const slashHits = slashQuery && !slashQuery.includes(" ") ? filterCommands(slashQuery) : [];
    if (slashHits.length) {
      const command = slashHits[Math.min(slashIndex, slashHits.length - 1)];
      if (command) commitEditor({ ...state, text: `/${command.name} `, cursor: command.name.length + 2 });
      return;
    }
    if (mention && fileHits.length) {
      const file = fileHits[Math.min(fileIndex, fileHits.length - 1)];
      if (file) {
        const next = state.text.slice(0, mention.start) + `@${file} ` + state.text.slice(mention.end);
        commitEditor({ ...state, text: next, cursor: mention.start + file.length + 2 });
      }
    }
  }

  async function submit(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    historyPos.current = null;
    if (historyRef.current[historyRef.current.length - 1] !== text) {
      historyRef.current.push(text);
      appendPromptHistory(workspaceRef.current, text);
    }
    commitEditor(emptyEditor(editorRef.current.vim));
    setScroll(0);
    setHint("");
    if (text.startsWith("/")) {
      const slashQuery = text.slice(1);
      const slashHits = slashQuery && !raw.includes(" ") ? filterCommands(slashQuery) : [];
      const picked = slashHits[Math.min(slashIndex, Math.max(0, slashHits.length - 1))];
      const runnable = slashHits.length && !raw.includes(" ") ? `/${picked?.name ?? slashQuery}` : text;
      if (busyRef.current && !isImmediateCommand(runnable)) {
        queueRef.current.push(runnable);
        pushItem({ id: createId("q"), type: "user", text: runnable, queued: true }, false);
        return;
      }
      try {
        await runSlashCommand(runnable, hostRef.current);
      } catch (error) {
        system(error instanceof Error ? error.message : String(error), "error");
      }
      return;
    }
    if (text.startsWith("!")) {
      if (busyRef.current) {
        queueRef.current.push(text);
        pushItem({ id: createId("q"), type: "user", text, queued: true }, false);
        return;
      }
      await runBang(text.slice(1).trim());
      return;
    }
    if (text.startsWith("#")) {
      addMemory(text.slice(1));
      return;
    }
    await runTurn(text);
  }

  const promptHint = rev
    ? "reverse-i-search · ctrl+r older · tab edit · enter run · esc cancel"
    : editor.text.startsWith("!")
      ? "shell mode · enter runs locally · esc cancels"
      : editor.text.startsWith("#")
        ? "memory · appends a line to AGENT.md"
        : phase.type === "running"
          ? "esc interrupt · enter queues a message"
          : hint;

  const revMatch = rev
    ? (historyRef.current.filter((entry) => entry.includes(rev.query)).reverse()[rev.index] ?? "")
    : "";

  return (
    <Box flexDirection="column" height={rows} width={cols}>
      <Header theme={theme} model={model} cwd={cwdLabel} branch={branch} />
      <Box flexGrow={1} flexDirection="column" overflow="hidden" justifyContent="flex-end">
        {items.length === 0 ? <Welcome theme={theme} profile={profile} /> : null}
        {scroll > 0 ? <Text color={theme.muted}>… pgdn for latest</Text> : null}
        <TranscriptView items={visible} theme={theme} expanded={expanded} />
      </Box>
      {showTodos ? <TodoList todos={todos} theme={theme} /> : null}
      {phase.type === "running" ? <Spinner theme={theme} startedAt={spinFrom || Date.now()} /> : null}
      {help ? <HelpPanel theme={theme} /> : null}
      {picker ? (
        <ChoiceDialog
          theme={theme}
          title={picker.kind === "resume" ? "Resume" : "Rewind"}
          options={picker.rows.map((row) =>
            picker.kind === "resume"
              ? `${(row as SessionSnapshot).meta.id}  ${(row as SessionSnapshot).meta.name || firstUser(row as SessionSnapshot)}`
              : (row as Checkpoint).label,
          )}
          selected={picker.selected}
        />
      ) : null}
      {phase.type === "permission" && phase.step === "choose" ? (
        <PermissionDialog theme={theme} prompt={phase.prompt} selected={phase.selected} />
      ) : null}
      {phase.type === "permission" && phase.step === "feedback" ? (
        <Box borderStyle="round" borderColor={theme.accent} paddingX={1}>
          <Text color={theme.text}>{`Tell Glue what to do instead: ${phase.feedback}`}</Text>
        </Box>
      ) : null}
      {phase.type === "ask" ? (
        <ChoiceDialog
          theme={theme}
          title={phase.question}
          body={phase.other ? phase.otherText : undefined}
          options={[...phase.options, "Other"]}
          selected={phase.selected}
        />
      ) : null}
      {phase.type === "plan" ? (
        <ChoiceDialog
          theme={theme}
          title="Approve this plan?"
          body={clip(phase.plan, 800)}
          options={["Yes, approve and accept edits", "No, keep planning"]}
          selected={phase.selected}
        />
      ) : null}
      {slashMatches.length ? (
        <SlashMenu
          theme={theme}
          selected={visibleSlash(slashMatches, slashIndex).selected}
          rows={visibleSlash(slashMatches, slashIndex).rows.map((command) => ({ name: command.name, summary: command.summary }))}
        />
      ) : null}
      {fileHits.length ? (
        <SlashMenu
          theme={theme}
          selected={Math.min(fileIndex, fileHits.length - 1)}
          rows={fileHits.map((file) => ({ name: file, summary: "file" }))}
        />
      ) : null}
      <PromptBox
        theme={theme}
        text={rev ? rev.query : editor.text}
        cursor={rev ? rev.query.length : editor.cursor}
        placeholder={placeholder}
        hint={revMatch ? `${promptHint}\n${revMatch}` : promptHint}
      />
      <StatusBar theme={theme} mode={mode} usage={usage} hint={shellEnabled ? "? for shortcuts · shell on" : "? for shortcuts"} />
    </Box>
  );
}

interface TurnOpts {
  readOnly?: boolean;
  display?: string;
  alreadyShown?: boolean;
}

function windowItems(items: TranscriptItem[], scroll: number, rows: number): TranscriptItem[] {
  const end = Math.max(0, items.length - scroll);
  const sliced = items.slice(0, end);
  const budget = Math.max(6, rows - 12);
  const kept: TranscriptItem[] = [];
  let used = 0;
  for (let i = sliced.length - 1; i >= 0; i--) {
    const item = sliced[i];
    if (!item) continue;
    const cost = item.type === "tool" ? 3 + Math.min(6, item.diff?.length ?? 0) : Math.max(1, Math.ceil(textOf(item).length / 80));
    if (kept.length && used + cost > budget) break;
    kept.push(item);
    used += cost;
  }
  return kept.reverse();
}

function textOf(item: TranscriptItem): string {
  if (item.type === "tool") return item.summary ?? item.target;
  return item.text;
}

function visibleSlash<T>(rows: T[], index: number, size = 6): { rows: T[]; selected: number } {
  const start = Math.max(0, Math.min(Math.max(0, index - 1), Math.max(0, rows.length - size)));
  return { rows: rows.slice(start, start + size), selected: index - start };
}

function splitInput(input: string, key: Key): Array<{ input: string; key: Key }> {
  if (key.return || (!input.includes("\r") && !input.includes("\n"))) return [{ input, key }];
  const parts = input.split(/(\r\n|\n|\r)/);
  const chunks: Array<{ input: string; key: Key }> = [];
  for (const part of parts) {
    if (!part) continue;
    if (part === "\r" || part === "\n" || part === "\r\n") chunks.push({ input: "", key: { ...key, return: true } });
    else chunks.push({ input: part, key: { ...key, return: false } });
  }
  return chunks.length ? chunks : [{ input, key }];
}

function toKey(input: string, key: Key): KeyIn {
  return {
    input,
    ctrl: key.ctrl,
    meta: key.meta,
    shift: key.shift,
    return: key.return,
    escape: key.escape,
    tab: key.tab,
    backspace: key.backspace,
    delete: key.delete,
    up: key.upArrow,
    down: key.downArrow,
    left: key.leftArrow,
    right: key.rightArrow,
    pageUp: key.pageUp,
    pageDown: key.pageDown,
  };
}

function shorten(target: string): string {
  const home = process.env.HOME ?? "";
  if (home && target.startsWith(home)) return `~${target.slice(home.length)}`;
  return target;
}

function gitBranch(cwd: string): string | undefined {
  try {
    const head = readFileSync(path.join(cwd, ".git", "HEAD"), "utf8").trim();
    const match = /^ref: refs\/heads\/(.+)$/.exec(head);
    return match?.[1] ?? (head ? head.slice(0, 7) : undefined);
  } catch {
    return undefined;
  }
}

function suggest(cwd: string): string {
  const result = spawnSync("git", ["diff", "--name-only"], { cwd, encoding: "utf8" });
  const file = result.stdout?.split("\n").find(Boolean);
  return file ? `Look at the changes in ${file}` : "Ask Glue to change this project";
}

function firstUser(session: SessionSnapshot): string {
  const message = session.messages.find((item) => item.role === "user");
  return message && message.role === "user" ? message.content.slice(0, 60) : "";
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}
