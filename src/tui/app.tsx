import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, render, Text, useApp, useStdout } from "ink";
import { runAgentTurn, type AgentHooks, type PermissionChoice, type PermissionPrompt } from "../agent/loop.js";
import { ensureGlobalConfigForSession, type AppConfig } from "../config.js";
import { effortSetMessage, normalizeEffort, type EffortLevel } from "../effort.js";
import {
  filterCommands,
  gitText,
  helpLines,
  isImmediateCommand,
  presentCommandOutput,
  readMemoryPreview,
  resolveSubmittedSlash,
  runSlashCommand,
  type CommandHost,
} from "../commands.js";
import { listProjectFiles, completePath } from "../files.js";
import { createId } from "../id.js";
import { createLlmClient } from "../llm/client.js";
import { expandMentions, mentionQuery } from "../mentions.js";
import { isPermissionMode, nextPermissionState, type ApprovalMode } from "../permissions.js";
import { buildSystemPrompt, memoryPath } from "../prompt.js";
import { writeUiSettings } from "../settings.js";
import { discoverSkills, resolveSkill, toActiveSkill, type ActiveSkill } from "../skills.js";
import {
  addTokenUsage,
  buildStatusLinePayload,
  formatStatusLineOutput,
  readStatusLineConfig,
  runStatusLineCommand,
  statusLineFrame,
  STATUSLINE_DEBOUNCE_MS,
  type StatusLineConfig,
} from "../statusline.js";
import { decideResume, openResumePicker, reduceResumePicker, resumePickerView } from "../resume.js";
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
import { runSpawnedSubagent, toolsForSession } from "../agent/subagent.js";
import type { ChatMessage, FileSnap, PermissionMode, TodoItem, TokenUsage, TranscriptItem } from "../types.js";
import { emptyEditor, reduceEditor, type EditorState, type KeyIn } from "./editor.js";
import { useConsoleInput } from "./console-input.js";
import { openEffortPicker, reduceEffortPicker, type EffortPickerState } from "./effort-picker.js";
import { prevGrapheme } from "./text.js";
import { frameRows, layoutColumns, moveScroll, pageLines, reconcileSize, scrollHint, transcriptBudget, transcriptLineCount, transcriptWindow, WHEEL_LINES, type SizeMemory } from "./viewport.js";
import { cycleSlash, slashTabIndex, type SlashCycle } from "./complete.js";
import { statusBarLine } from "./footer.js";
import { imeAnchor, statusAreaRows, wrappedRowCount } from "./ime.js";
import { isEffortPickerShortcut, MOUSE_TRACKING_ON, pickerSurface } from "./keys.js";
import { attachImeCursorSync, bindInkClear, reflowTerminal, restoreTerminal } from "./screen.js";
import {
  ChoiceDialog,
  CustomStatusLine,
  EffortPicker,
  Header,
  HelpPanel,
  ModelPicker,
  PermissionDialog,
  PromptBox,
  ResumePicker,
  SlashMenu,
  Spinner,
  StatusBar,
  TodoList,
  TranscriptView,
  Welcome,
  CommandHelp,
} from "./components.js";
import { isModelDraft, modelWindow, openModelPicker, reduceModelPicker, type ModelPickerState } from "./model-picker.js";
import { NAMED_ACCENTS, THEMES, textInk, type Theme } from "./theme.js";

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
  | { kind: "model"; state: ModelPickerState }
  | { kind: "effort"; state: EffortPickerState }
  | { kind: "resume"; state: ReturnType<typeof openResumePicker> }
  | { kind: "rewind"; rows: Checkpoint[]; selected: number };

export async function startTui(boot: Boot): Promise<void> {
  ensureGlobalConfigForSession();
  const stdout = process.stdout;
  const tty = Boolean(stdout.isTTY);
  stdout.write(`\x1b]0;Glue ${path.basename(boot.config.workspace)}\x07`);
  if (tty) stdout.write(MOUSE_TRACKING_ON);
  const instance = render(<App boot={boot} />, { exitOnCtrlC: false });
  bindInkClear(() => {
    instance.clear();
  });
  const onProcessExit = () => {
    try {
      stdout.write("\x1b]0;\x07");
      restoreTerminal(stdout);
    } catch {
      /* the pipe may already be closed */
    }
  };
  process.once("exit", onProcessExit);
  try {
    await instance.waitUntilExit();
  } finally {
    process.removeListener("exit", onProcessExit);
    try {
      stdout.write("\x1b]0;\x07");
    } catch {
      /* ignore */
    }
    restoreTerminal(stdout);
    bindInkClear(null);
  }
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
  const [goal, setGoalState] = useState(boot.config.goal);
  const [approval, setApprovalState] = useState<ApprovalMode>(boot.config.approval);
  const [statusLineConfig, setStatusLineConfig] = useState<StatusLineConfig | null>(boot.config.statusLine);
  const [statusLineOutput, setStatusLineOutput] = useState("");
  const [model, setModelState] = useState(boot.config.model);
  const [effort, setEffortState] = useState<EffortLevel>(boot.config.effort);
  const [ultracode, setUltracodeState] = useState(boot.config.ultracode);
  const [profile, setProfileState] = useState(boot.config.profile);
  const [themeName, setThemeName] = useState(boot.config.theme);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [help, setHelp] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showTodos, setShowTodos] = useState(true);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [usage, setUsage] = useState<TokenUsage>({ input: 0, output: 0 });
  const [scroll, setScroll] = useState(0);
  const [commandHelp, setCommandHelp] = useState(false);
  const [helpOffset, setHelpOffset] = useState(0);
  const scrollRef = useRef(0);
  const metricsRef = useRef({ total: 0, budget: 1 });
  const prevTotalRef = useRef(0);
  const [hint, setHint] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [spinFrom, setSpinFrom] = useState(0);
  const [outputStyle, setOutputStyle] = useState(boot.config.outputStyle);
  const [shellEnabled, setShellEnabled] = useState(boot.config.shellEnabled);
  const [sessionName, setSessionName] = useState("");
  const [picker, setPicker] = useState<Picker | null>(null);
  const pickerRef = useRef<Picker | null>(null);
  const [modelDraft, setModelDraft] = useState<ModelPickerState | null>(null);
  const modelDraftRef = useRef<ModelPickerState | null>(null);
  const [rev, setRev] = useState<{ query: string; index: number; prev: EditorState } | null>(null);
  const [branch, setBranch] = useState<string | undefined>(() => gitBranch(boot.config.workspace));
  const [cwdLabel, setCwdLabel] = useState(() => shorten(boot.config.workspace));

  const itemsRef = useRef<TranscriptItem[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const modeRef = useRef(mode);
  const goalRef = useRef(goal);
  const approvalRef = useRef(approval);
  const statusLineConfigRef = useRef(statusLineConfig);
  const statusLineOutputRef = useRef("");
  const glueHomeRef = useRef(homedir());
  const statusAbortRef = useRef<AbortController | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameSizeRef = useRef({ rows: 23, cols: 80 });
  const imeLayoutRef = useRef({ frameRows: 23, frameCols: 80, text: "", cursor: 0, statusRows: 1 });
  const prevStatusCommandRef = useRef<string | null>(null);
  const activeSkillRef = useRef<ActiveSkill | null>(null);
  const modelRef = useRef(model);
  const effortRef = useRef(effort);
  const ultracodeRef = useRef(ultracode);
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
  const slashIndexRef = useRef(0);
  const completionRef = useRef<SlashCycle | null>(null);
  const commandHelpRef = useRef(false);
  const sizeMem = useRef<SizeMemory>({
    rows: stdout?.rows && stdout.rows > 1 ? stdout.rows : 0,
    columns: stdout?.columns && stdout.columns > 1 ? stdout.columns : 0,
    inkRows: stdout?.rows,
    inkColumns: stdout?.columns,
    procRows: process.stdout.rows,
    procColumns: process.stdout.columns,
  });
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
  goalRef.current = goal;
  approvalRef.current = approval;
  statusLineConfigRef.current = statusLineConfig;
  modelRef.current = model;
  effortRef.current = effort;
  ultracodeRef.current = ultracode;
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

  function skillPromptParts(): { skillCatalog?: Array<{ id: string; description: string }>; activeSkill?: { id: string; body: string } } {
    try {
      const skills = discoverSkills({ workspace: workspaceRef.current, home: homedir() });
      const active = activeSkillRef.current;
      return {
        skillCatalog: skills.map((skill) => ({ id: skill.id, description: skill.description })),
        activeSkill: active ? { id: active.id, body: active.body } : undefined,
      };
    } catch {
      return {};
    }
  }

  function rebuildSystem(): void {
    const content = buildSystemPrompt({
      workspace: workspaceRef.current,
      profile: profileRef.current,
      permissionMode: modeRef.current,
      shellEnabled: shellRef.current,
      outputStyle: styleRef.current,
      extraRoots: rootsRef.current.slice(1),
      append: boot.appendSystem,
      goal: goalRef.current,
      ultracode: ultracodeRef.current,
      ...skillPromptParts(),
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

  function setPickerBoth(next: Picker | null): void {
    pickerRef.current = next;
    setPicker(next);
  }

  function setScrollBoth(next: number): void {
    scrollRef.current = next;
    setScroll(next);
  }

  function scrollBy(delta: number): void {
    const { total, budget } = metricsRef.current;
    setScrollBoth(moveScroll(scrollRef.current, delta, total, budget));
  }

  function applySelection(selection: { effort: EffortLevel; ultracode: boolean }): void {
    effortRef.current = selection.effort;
    ultracodeRef.current = selection.ultracode;
    setEffortState(selection.effort);
    setUltracodeState(selection.ultracode);
    logRef.current?.updateMeta({ effort: selection.effort, ultracode: selection.ultracode });
    rebuildSystem();
  }

  function rememberGoal(next: string): void {
    goalRef.current = next;
    setGoalState(next);
    logRef.current?.updateMeta({ goal: next });
    writeUiSettings(workspaceRef.current, { goal: next });
    rebuildSystem();
  }

  function rememberApproval(next: ApprovalMode): void {
    approvalRef.current = next;
    setApprovalState(next);
    logRef.current?.updateMeta({ approval: next });
    writeUiSettings(workspaceRef.current, { approval: next });
  }

  function reloadStatusLine(immediate = true): void {
    const next = readStatusLineConfig(glueHomeRef.current);
    statusLineConfigRef.current = next;
    setStatusLineConfig(next);
    queueStatusLine(immediate);
  }

  function queueStatusLine(immediate = false): void {
    const config = statusLineConfigRef.current;
    if (!config?.command) {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusAbortRef.current?.abort();
      publishStatusLine("");
      return;
    }
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    const wait = immediate ? 0 : STATUSLINE_DEBOUNCE_MS;
    statusTimerRef.current = setTimeout(() => {
      void refreshStatusLineNow();
    }, wait);
  }

  async function refreshStatusLineNow(): Promise<void> {
    const config = statusLineConfigRef.current;
    if (!config?.command) {
      publishStatusLine("");
      return;
    }
    statusAbortRef.current?.abort();
    const ac = new AbortController();
    statusAbortRef.current = ac;
    const payload = buildStatusLinePayload(
      {
        cwd: workspaceRef.current,
        sessionId: logRef.current?.meta.id ?? "",
        sessionName: sessionName,
        model: modelRef.current,
        effort: effortRef.current,
        usage: usageRef.current,
        contextWindow: boot.config.contextWindow,
      },
      {
        goal: goalRef.current,
        shell: shellRef.current,
        session: sessionName,
        branch,
        cwd: cwdLabel,
      },
    );
    const text = await runStatusLineCommand(config.command, payload, {
      home: glueHomeRef.current,
      cwd: workspaceRef.current,
      columns: frameSizeRef.current.cols,
      lines: frameSizeRef.current.rows,
      signal: ac.signal,
    });
    if (!ac.signal.aborted) publishStatusLine(text);
  }

  function publishStatusLine(text: string): void {
    const next = statusLineFrame(statusLineOutputRef.current, text, frameSizeRef.current.cols, statusLineConfigRef.current?.padding ?? 0);
    if (next === undefined) return;
    statusLineOutputRef.current = next;
    setStatusLineOutput(next);
  }

  function setSlash(index: number): void {
    slashIndexRef.current = index;
    setSlashIndex(index);
  }

  function freshModelPicker(): ModelPickerState {
    return openModelPicker(modelRef.current, boot.config.models ?? [], effortRef.current);
  }

  function closeModelDraft(): void {
    modelDraftRef.current = null;
    setModelDraft(null);
  }

  const hostRef = useRef<CommandHost>(null as unknown as CommandHost);
  hostRef.current = {
    workspace: workspaceRef.current,
    config: { ...boot.config, model, effort, ultracode, permissionMode: mode, profile, workspace: workspaceRef.current, shellEnabled, outputStyle, theme: themeName, goal, approval, statusLine: statusLineConfig },
    model,
    effort,
    ultracode,
    goal,
    approval,
    statusLine: statusLineConfig,
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
    push: (text, kind) => {
      const presented = presentCommandOutput(text);
      if (presented.helpPanel) {
        commandHelpRef.current = true;
        setCommandHelp(true);
        setHelpOffset(0);
        return;
      }
      if (commandHelpRef.current) {
        commandHelpRef.current = false;
        setCommandHelp(false);
      }
      system(presented.line ?? text, kind ?? "system");
    },
    setGoal: (next) => rememberGoal(next),
    setApproval: (next) => rememberApproval(next),
    onStatusLineChange: () => reloadStatusLine(true),
    home: homedir(),
    setActiveSkill: (skill) => {
      activeSkillRef.current = skill;
      logRef.current?.updateMeta({ skill: skill?.id ?? "" });
      rebuildSystem();
    },
    setModel: (next) => {
      modelRef.current = next;
      setModelState(next);
      logRef.current?.updateMeta({ model: next });
    },
    openModelPicker: () => {
      closeModelDraft();
      commitEditor(emptyEditor(editorRef.current.vim));
      setPickerBoth({ kind: "model", state: freshModelPicker() });
    },
    openEffortPicker: () => {
      closeModelDraft();
      commitEditor(emptyEditor(editorRef.current.vim));
      setPickerBoth({ kind: "effort", state: openEffortPicker(effortRef.current, ultracodeRef.current) });
    },
    setEffort: (level) => applySelection({ effort: level, ultracode: ultracodeRef.current }),
    setUltracode: (on) => applySelection({ effort: effortRef.current, ultracode: on }),
    setMode: (next) => {
      modeRef.current = next;
      setModeState(next);
      logRef.current?.updateMeta({ permissionMode: next });
      if (next === "auto") {
        if (approvalRef.current !== "auto") rememberApproval("auto");
      } else if (approvalRef.current === "auto") {
        rememberApproval("manual");
      }
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
        effort: effortRef.current,
        ultracode: ultracodeRef.current,
        goal: goalRef.current,
        approval: approvalRef.current,
        skill: activeSkillRef.current?.id ?? "",
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
      queueStatusLine(true);
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
      const decision = decideResume(id, listSessions(workspaceRef.current), logRef.current?.meta.id);
      if (decision.action === "message") {
        system(decision.text, decision.level);
        return;
      }
      if (decision.action === "load") {
        loadResumed(decision.id);
        return;
      }
      setPickerBoth({ kind: "resume", state: openResumePicker(decision.items, decision.query) });
    },
    rewind: (index) => {
      const rows = checkpointsRef.current;
      if (!rows.length) {
        system("Nothing to rewind in this process. Checkpoints last for the current session.");
        return;
      }
      if (index === undefined || Number.isNaN(index)) {
        setPickerBoth({ kind: "rewind", rows, selected: rows.length - 1 });
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
        effort: effortRef.current,
        ultracode: ultracodeRef.current,
        goal: goalRef.current,
        approval: approvalRef.current,
        skill: activeSkillRef.current?.id ?? "",
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
  function loadResumed(id: string): void {
    const file = findSessionFile(workspaceRef.current, id);
    if (!file) {
      system(`No session matches ${id}.`, "error");
      return;
    }
    applySnapshot(loadSession(file), file);
  }

  function restoreSkill(id: string | undefined): void {
    if (!id) {
      activeSkillRef.current = null;
      return;
    }
    const found = resolveSkill(discoverSkills({ workspace: workspaceRef.current, home: homedir() }), id);
    activeSkillRef.current = found && found !== "ambiguous" ? toActiveSkill(found) : null;
  }

  function applySnapshot(snap: SessionSnapshot, file: string): void {
    logRef.current = SessionLog.open(file);
    const convo = snap.messages.filter((message) => message.role !== "system");
    messagesRef.current = convo;
    if (isPermissionMode(snap.meta.permissionMode)) {
      modeRef.current = snap.meta.permissionMode;
      setModeState(snap.meta.permissionMode);
    }
    if (snap.meta.model) {
      modelRef.current = snap.meta.model;
      setModelState(snap.meta.model);
    }
    const resumedUltra = snap.meta.ultracode === true;
    const resumedEffort = resumedUltra ? "max" : normalizeEffort(snap.meta.effort);
    if (resumedEffort) applySelection({ effort: resumedEffort, ultracode: resumedUltra });
    if (typeof snap.meta.goal === "string") rememberGoal(snap.meta.goal);
    if (snap.meta.approval === "auto" || snap.meta.approval === "manual") rememberApproval(snap.meta.approval);
    restoreSkill(snap.meta.skill);
    if (snap.meta.profile) {
      profileRef.current = snap.meta.profile;
      setProfileState(snap.meta.profile);
    }
    setSessionName(snap.meta.name);
    rebuildSystem();
    itemsRef.current = snap.items;
    setItems(snap.items);
    ctxRef.current.todos.splice(0, ctxRef.current.todos.length, ...snap.todos);
    setTodos([...snap.todos]);
    queueRef.current = [];
    checkpointsRef.current = [];
    rememberReads(snap);
    setScrollBoth(0);
    logRef.current.updateMeta({});
    const label = snap.meta.name ? `${snap.meta.id} · ${snap.meta.name}` : snap.meta.id;
    pushItem({ id: createId("s"), type: "system", text: `Resumed ${label}` }, false);
  }

  function rememberReads(snap: SessionSnapshot): void {
    ctxRef.current.readFiles.clear();
    for (const item of snap.items) {
      if (item.type !== "tool" || item.status !== "ok" || !item.target) continue;
      if (item.name !== "read_file" && item.name !== "write_file" && item.name !== "edit_file") continue;
      try {
        ctxRef.current.readFiles.add(ctxRef.current.sandbox.resolve(item.target));
      } catch {
        /* the file may be gone, or it lived outside the current roots */
      }
    }
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
    const result = await createLlmClient({ ...boot.config, model: modelRef.current, effort: effortRef.current }).stream(messages, [], undefined, (delta) => {
      if (delta.text) text += delta.text;
      if (delta.usage) setUsage((current) => addTokenUsage(current, delta.usage!));
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
    setScrollBoth(0);
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
    const hooks: AgentHooks = {
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
          onUsage: (part) => setUsage((current) => addTokenUsage(current, part)),
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
          getApproval: () => approvalRef.current,
          getRules: () => rulesRef.current,
          addRule: (kind, rule) => hostRef.current.addRule(kind, rule),
    };
    ctxRef.current.spawnSubagent = ultracodeRef.current
      ? (prompt, readOnly) =>
          runSpawnedSubagent({
            client: createLlmClient({ ...boot.config, model: modelRef.current, effort: effortRef.current }),
            task: prompt,
            ctx: ctxRef.current,
            shellEnabled: shellRef.current && !readOnly,
            readOnly,
            hooks,
            maxSteps: boot.config.maxSteps,
            signal: ac.signal,
            workspace: workspaceRef.current,
          })
      : undefined;
    try {
      await runAgentTurn({
        client: createLlmClient({ ...boot.config, model: modelRef.current, effort: effortRef.current }),
        messages: messagesRef.current,
        tools: toolsForSession(shellRef.current, ultracodeRef.current),
        ctx: ctxRef.current,
        maxSteps: boot.config.maxSteps,
        signal: ac.signal,
        readOnly: opts.readOnly,
        hooks,
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
        effort: boot.config.effort,
        ultracode: boot.config.ultracode,
        goal: boot.config.goal,
        approval: boot.config.approval,
      });
      rebuildSystem();
    }
    if (boot.openResume) void hostRef.current.resume();
    else if (boot.initialPrompt) void runTurnRef.current(boot.initialPrompt);
    setFiles(listProjectFiles(workspaceRef.current));
    const timers: ReturnType<typeof setTimeout>[] = [];
    const readWindow = () => {
      const next = reconcileSize(
        sizeMem.current,
        { rows: stdout?.rows, columns: stdout?.columns },
        { rows: process.stdout.rows, columns: process.stdout.columns },
      );
      sizeMem.current = next.memory;
      if (next.resized) reflowTerminal(stdout ?? process.stdout);
      if (next.rows > 1) setRows(next.rows);
      if (next.columns > 1) setCols(next.columns);
    };
    const onResize = () => {
      readWindow();
      timers.push(setTimeout(readWindow, 40));
    };
    stdout?.on("resize", onResize);
    if (process.stdout !== stdout) process.stdout.on("resize", onResize);
    process.on("SIGWINCH", onResize);
    const poll = setInterval(readWindow, 200);
    return () => {
      for (const timer of timers) clearTimeout(timer);
      clearInterval(poll);
      stdout?.off("resize", onResize);
      if (process.stdout !== stdout) process.stdout.off("resize", onResize);
      process.off("SIGWINCH", onResize);
      try {
        restoreTerminal(process.stdout);
      } catch {
        /* already restored by startTui */
      }
    };
    // Startup only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slashMatches =
    editor.text.startsWith("/") && !editor.text.slice(1).includes(" ") && !isModelDraft(editor.text)
      ? filterCommands(editor.text.slice(1))
      : [];
  const modelList = picker?.kind === "model" ? picker.state : modelDraft;
  const resumeView = picker?.kind === "resume" ? resumePickerView(picker.state) : null;
  const mention = mentionQuery(editor.text, editor.cursor);
  const fileHits = mention ? completePath(files, mention.query) : [];
  const termRows = frameRows(rows > 1 ? rows : undefined);
  const termCols = layoutColumns(cols > 1 ? cols : undefined);
  frameSizeRef.current = { rows: termRows, cols: termCols };
  const helpCatalog = helpLines();
  const customStatusLines = statusLineConfig?.command
    ? formatStatusLineOutput(statusLineOutput, termCols, statusLineConfig.padding)
    : [];
  const statusBar = {
    mode,
    approval,
    hint: shellEnabled ? "? for shortcuts · shell on" : "? for shortcuts",
    shell: shellEnabled,
    session: sessionName,
    goal,
  };
  const statusRows = statusAreaRows(customStatusLines, wrappedRowCount(statusBarLine(statusBar), termCols));
  let extraLines = 0;
  if (statusRows > 1) extraLines += statusRows - 1;
  if (phase.type === "running") extraLines += 1;
  if (help) extraLines += 16;
  if (commandHelp) extraLines += 14;
  if (showTodos && todos.length) extraLines += 1 + todos.length;
  if (slashMatches.length) extraLines += Math.min(6, slashMatches.length);
  if (fileHits.length) extraLines += Math.min(6, fileHits.length);
  if (picker || modelList) extraLines += 12;
  if (phase.type === "permission" || phase.type === "ask" || phase.type === "plan") extraLines += 10;
  const rawBudget = transcriptBudget(termRows, extraLines);
  const totalLines = transcriptLineCount(items, termCols, expanded);
  const budget = Math.max(1, rawBudget - (totalLines > rawBudget ? 1 : 0));
  metricsRef.current = { total: totalLines, budget };
  const view = useMemo(
    () => transcriptWindow(items, scroll, termCols, budget, expanded),
    [items, scroll, termCols, budget, expanded],
  );
  const scrollNote = scrollHint(view.above, view.below);

  useEffect(() => {
    const previous = prevTotalRef.current;
    prevTotalRef.current = totalLines;
    const grew = totalLines - previous;
    if (grew > 0 && scrollRef.current > 0) {
      setScrollBoth(moveScroll(scrollRef.current + grew, 0, totalLines, metricsRef.current.budget));
      return;
    }
    const clamped = moveScroll(scrollRef.current, 0, totalLines, metricsRef.current.budget);
    if (clamped !== scrollRef.current) setScrollBoth(clamped);
  }, [totalLines]);

  useConsoleInput((key) => {
    handleKey(key);
  });

  imeLayoutRef.current = {
    frameRows: termRows,
    frameCols: termCols,
    text: rev ? rev.query : editor.text,
    cursor: rev ? rev.query.length : editor.cursor,
    statusRows,
  };

  useEffect(() => {
    const target = stdout ?? process.stdout;
    if (typeof target?.write !== "function") return;
    return attachImeCursorSync(target, () => imeAnchor(imeLayoutRef.current));
  }, [stdout]);

  useEffect(() => {
    const command = statusLineConfig?.command ?? "";
    const immediate = command !== prevStatusCommandRef.current;
    prevStatusCommandRef.current = command;
    queueStatusLine(immediate);
  }, [usage, model, effort, ultracode, mode, sessionName, statusLineConfig, phase.type, items.length]);

  useEffect(() => {
    const sec = statusLineConfig?.refreshInterval;
    if (!sec) return;
    const timer = setInterval(() => queueStatusLine(true), sec * 1000);
    return () => clearInterval(timer);
  }, [statusLineConfig?.refreshInterval, statusLineConfig?.command]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusAbortRef.current?.abort();
    };
  }, []);

  function handleKey(key: KeyIn): void {
    const k = key;
    if (commandHelpRef.current && (k.up || k.down || k.pageUp || k.pageDown || k.wheel || k.escape || (k.ctrl && k.input === "c"))) {
      if (k.escape || (k.ctrl && k.input === "c")) {
        commandHelpRef.current = false;
        setCommandHelp(false);
        return;
      }
      const max = Math.max(0, helpLines().length - 10);
      const step = k.pageUp || k.pageDown ? 8 : k.wheel ? 3 : 1;
      const dir = k.up || k.pageUp || k.wheel === 1 ? -1 : 1;
      setHelpOffset((offset) => Math.max(0, Math.min(max, offset + dir * step)));
      return;
    }
    if (isEffortPickerShortcut(k) && !pickerRef.current && phaseRef.current.type !== "permission" && phaseRef.current.type !== "ask" && phaseRef.current.type !== "plan") {
      if (help) setHelp(false);
      if (commandHelpRef.current) {
        commandHelpRef.current = false;
        setCommandHelp(false);
      }
      closeModelDraft();
      if (pickerSurface("alt-p") === "model-effort") {
        setPickerBoth({ kind: "model", state: freshModelPicker() });
      }
      return;
    }
    if (k.wheel || k.pageUp || k.pageDown) {
      const step = k.pageUp || k.pageDown ? pageLines(metricsRef.current.budget) : WHEEL_LINES;
      const sign = k.pageDown || k.wheel === -1 ? -1 : 1;
      scrollBy(sign * step);
      return;
    }
    if (help) {
      if (k.escape || k.input === "?" || k.ctrl) setHelp(false);
      return;
    }
    if (pickerRef.current) {
      handlePicker(k);
      return;
    }
    if (isModelDraft(editorRef.current.text)) {
      const draft = modelDraftRef.current ?? freshModelPicker();
      modelDraftRef.current = draft;
      if (k.up || k.down || k.left || k.right || k.return || k.escape || (k.ctrl && k.input === "c")) {
        const next = reduceModelPicker(draft, {
          up: k.up,
          down: k.down,
          left: k.left,
          right: k.right,
          return: k.return,
          escape: k.escape,
          ctrlC: k.ctrl && k.input === "c",
        });
        if (next.effect?.type === "cancel" || next.effect?.type === "select") {
          closeModelDraft();
          commitEditor(emptyEditor(editorRef.current.vim));
          if (next.effect.type === "select") {
            hostRef.current.setModel(next.effect.model);
            system(`Model set to ${next.effect.model} for this session.`);
          }
          return;
        }
        if (next.effect?.type === "effort") applySelection({ effort: next.effect.effort, ultracode: ultracodeRef.current });
        modelDraftRef.current = next.state;
        setModelDraft(next.state);
        return;
      }
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
      const next = k.down ? slashIndexRef.current + 1 : slashIndexRef.current - 1;
      setSlash((next + slashMatches.length) % slashMatches.length);
      completionRef.current = null;
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
    if (isModelDraft(result.state.text)) {
      if (!modelDraftRef.current) {
        const state = freshModelPicker();
        modelDraftRef.current = state;
        setModelDraft(state);
      }
    } else if (modelDraftRef.current) closeModelDraft();
    const slashQuery = result.state.text.startsWith("/") ? result.state.text.slice(1) : "";
    if (slashQuery && !slashQuery.includes(" ") && !k.up && !k.down && result.effect !== "complete") setSlash(0);
    if (result.effect !== "complete") completionRef.current = null;
    if (!result.effect) return;
    void applyEffect(result.effect, result.state);
  }

  function handleDialog(key: KeyIn, current: Phase): void {
    if (current.type === "permission") {
      if (current.step === "feedback") {
        if (key.escape) current.resolve({ decision: "deny" });
        else if (key.return) current.resolve({ decision: "deny", feedback: current.feedback });
        else if (key.backspace) setPhase({ ...current, feedback: dropLast(current.feedback) });
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
        else if (key.backspace) setPhase({ ...current, otherText: dropLast(current.otherText) });
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
    const current = pickerRef.current;
    if (!current) return;
    if (key.escape || (key.ctrl && key.input === "c")) {
      setPickerBoth(null);
      return;
    }
    if (current.kind === "model") {
      const next = reduceModelPicker(current.state, {
        up: key.up,
        down: key.down,
        left: key.left,
        right: key.right,
        return: key.return,
        escape: key.escape,
        ctrlC: key.ctrl && key.input === "c",
      });
      if (next.effect?.type === "cancel") {
        setPickerBoth(null);
        return;
      }
      if (next.effect?.type === "select") {
        setPickerBoth(null);
        hostRef.current.setModel(next.effect.model);
        system(`Model set to ${next.effect.model} for this session.`);
        return;
      }
      if (next.effect?.type === "effort") applySelection({ effort: next.effect.effort, ultracode: ultracodeRef.current });
      setPickerBoth({ kind: "model", state: next.state });
      return;
    }
    if (current.kind === "effort") {
      const next = reduceEffortPicker(current.state, {
        left: key.left,
        right: key.right,
        tab: key.tab,
        return: key.return,
        escape: key.escape,
        ctrlC: Boolean(key.ctrl && key.input === "c"),
      });
      if (next.effect?.type === "cancel") {
        setPickerBoth(null);
        return;
      }
      if (next.effect?.type === "select") {
        setPickerBoth(null);
        const applied = { effort: next.effect.effort, ultracode: next.effect.ultracode };
        applySelection(applied);
        system(applied.ultracode ? `${effortSetMessage({ effort: applied.effort, ultracode: false })} UltraCode on.` : effortSetMessage({ effort: applied.effort, ultracode: false }));
        return;
      }
      setPickerBoth({ kind: "effort", state: next.state });
      return;
    }
    if (current.kind === "rewind") {
      const count = current.rows.length;
      if (!count) return;
      if (key.up) setPickerBoth({ ...current, selected: (current.selected + count - 1) % count });
      else if (key.down) setPickerBoth({ ...current, selected: (current.selected + 1) % count });
      else if (key.return) {
        const selected = current.selected;
        setPickerBoth(null);
        restoreCheckpoint(selected);
      }
      return;
    }
    const next = reduceResumePicker(current.state, key);
    if (next.effect?.type === "close") {
      setPickerBoth(null);
      return;
    }
    if (next.effect?.type === "select") {
      setPickerBoth(null);
      loadResumed(next.effect.id);
      return;
    }
    setPickerBoth({ kind: "resume", state: next.state });
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
      const next = nextPermissionState(modeRef.current, approvalRef.current);
      hostRef.current.setMode(next.mode);
      if (approvalRef.current !== next.approval) hostRef.current.setApproval?.(next.approval);
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
      scrollBy(pageLines(metricsRef.current.budget));
      return;
    }
    if (effect === "scroll-down") {
      scrollBy(-pageLines(metricsRef.current.budget));
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
    if (state.text.startsWith("/") && !state.text.includes(" ") && !state.text.includes("\n")) {
      const prior = completionRef.current;
      const continuing = Boolean(prior && (state.text === `/${prior.lastName}` || state.text === `/${prior.lastName} `));
      const prefix = continuing && prior ? prior.prefix : state.text.slice(1);
      const index = slashTabIndex({
        cycling: continuing,
        cycleIndex: prior ? prior.index + 1 : 0,
        selectedIndex: slashIndexRef.current,
      });
      const next = cycleSlash(prefix, index);
      if (next) {
        const name = next.names[next.index] ?? "";
        completionRef.current = { prefix, index: next.index, lastName: name };
        setSlash(next.index);
        commitEditor({ ...state, text: next.text, cursor: next.text.length, anchor: null });
        return;
      }
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
    setScrollBoth(0);
    setHint("");
    if (text.startsWith("/")) {
      const runnable = resolveSubmittedSlash(text, slashIndexRef.current);
      completionRef.current = null;
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
    <Box flexDirection="column" height={termRows} width={termCols} overflow="hidden">
      <Box flexShrink={0}>
        <Header theme={theme} model={model} cwd={cwdLabel} branch={branch} />
      </Box>
      <Box flexGrow={1} flexShrink={1} minHeight={0} flexDirection="column" overflow="hidden" justifyContent="flex-end">
        {items.length === 0 && !commandHelp ? <Welcome theme={theme} profile={profile} /> : null}
        {scrollNote ? <Text {...textInk(theme, theme.muted)}>{scrollNote}</Text> : null}
        <TranscriptView items={view.items} theme={theme} expanded={expanded} />
      </Box>
      {showTodos ? <TodoList todos={todos} theme={theme} /> : null}
      {phase.type === "running" ? <Spinner theme={theme} startedAt={spinFrom || Date.now()} /> : null}
      {help ? <HelpPanel theme={theme} /> : null}
      {commandHelp ? <CommandHelp theme={theme} lines={helpCatalog} offset={helpOffset} /> : null}
      {picker?.kind === "rewind" ? (
        <ChoiceDialog
          theme={theme}
          title="Rewind"
          options={picker.rows.map((row) => row.label)}
          selected={picker.selected}
        />
      ) : null}
      {modelList ? (
        <ModelPicker
          theme={theme}
          rows={modelWindow(modelList.items, modelList.selected).rows}
          selected={modelWindow(modelList.items, modelList.selected).selected}
          start={modelWindow(modelList.items, modelList.selected).start}
          current={model}
          effort={modelList.effort}
          columns={termCols}
        />
      ) : null}
      {picker?.kind === "effort" ? (
        <EffortPicker theme={theme} levels={picker.state.levels} selected={picker.state.selected} ultracode={picker.state.ultracode} />
      ) : null}
      {resumeView ? (
        <ResumePicker
          theme={theme}
          rows={resumeView.rows}
          selected={resumeView.selected}
          query={resumeView.query}
          matchCount={resumeView.matchCount}
          preview={resumeView.preview}
        />
      ) : null}
      {phase.type === "permission" && phase.step === "choose" ? (
        <PermissionDialog theme={theme} prompt={phase.prompt} selected={phase.selected} />
      ) : null}
      {phase.type === "permission" && phase.step === "feedback" ? (
        <Box borderStyle="round" borderColor={theme.accent} paddingX={1}>
          <Text {...textInk(theme, theme.text)}>{`Tell Glue what to do instead: ${phase.feedback}`}</Text>
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
          columns={termCols}
          rows={visibleSlash(slashMatches, slashIndex).rows.map((command) => ({
            name: command.name,
            summary: command.available ? command.summary : `${command.summary} · 不可用`,
          }))}
        />
      ) : null}
      {fileHits.length ? (
        <SlashMenu
          theme={theme}
          selected={Math.min(fileIndex, fileHits.length - 1)}
          columns={termCols}
          rows={fileHits.map((file) => ({ name: file, summary: "file" }))}
        />
      ) : null}
      <PromptBox
        theme={theme}
        text={rev ? rev.query : editor.text}
        cursor={rev ? rev.query.length : editor.cursor}
        anchor={rev ? null : editor.anchor}
        placeholder={placeholder}
        hint={revMatch ? `${promptHint}\n${revMatch}` : promptHint}
      />
      {statusRows > 1 ? <CustomStatusLine theme={theme} lines={customStatusLines} /> : null}
      <StatusBar theme={theme} {...statusBar} />
    </Box>
  );
}

interface TurnOpts {
  readOnly?: boolean;
  display?: string;
  alreadyShown?: boolean;
}

function dropLast(text: string): string {
  return text.slice(0, prevGrapheme(text, text.length));
}

function visibleSlash<T>(rows: T[], index: number, size = 6): { rows: T[]; selected: number } {
  const start = Math.max(0, Math.min(Math.max(0, index - 1), Math.max(0, rows.length - size)));
  return { rows: rows.slice(start, start + size), selected: index - start };
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

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…` : text;
}
