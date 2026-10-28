import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { diagnose, formatDoctor } from "./doctor.js";
import { EFFORT_CYCLE, effortSetMessage, effortStatusLabel, parseEffortCommand, ULTRACODE_DESCRIPTION, type EffortLevel } from "./effort.js";
import { INIT_PROMPT, loadMemory, memoryPath } from "./prompt.js";
import { autoEngaged, normalizeMode, normalizeApproval, type ApprovalMode } from "./permissions.js";
import type { PermissionMode, PermissionRules, TokenUsage } from "./types.js";
import type { AppConfig } from "./config.js";
import { formatPluginList, installPlugin, loadPlugin, listPlugins, removePlugin } from "./plugins.js";
import { discoverSkills, formatSkillList, resolveSkill, toActiveSkill, type ActiveSkill, type Skill } from "./skills.js";
import {
  DEFAULT_SCRIPT_FIELDS,
  DESIGNED_STATUS_FIELDS,
  clearStatusLineConfig,
  glueSettingsPath,
  installStatusLine,
  parseStatuslineRequest,
  readStatusLineConfig,
  type StatusField,
  type StatusLineConfig,
} from "./statusline.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  summary: string;
  available: boolean;
  note?: string;
}

export interface CommandHost {
  workspace: string;
  config: AppConfig;
  model: string;
  permissionMode: PermissionMode;
  profile: string;
  themeName: string;
  editor: "normal" | "vim";
  outputStyle: "normal" | "concise";
  shellEnabled: boolean;
  usage: TokenUsage;
  contextWindow: number;
  sessionName: string;
  sessionId: string;
  rules: PermissionRules;
  tasks: Array<{ id: string; command: string; status: string }>;
  /** Persistent goal. Empty means none. */
  goal?: string;
  setGoal?(goal: string): void;
  /** manual asks; auto allows low-risk tools and still asks for high-risk ones. */
  approval?: ApprovalMode;
  setApproval?(mode: ApprovalMode): void;
  /** Custom status-line command from `~/.glue/settings.json`. */
  statusLine?: StatusLineConfig | null;
  /** Reload after `/statusline` writes `~/.glue/settings.json`. */
  onStatusLineChange?(): void;
  /** Home for `~/.glue`. Tests pass a temp directory. */
  home?: string;
  activeSkill?: ActiveSkill | null;
  setActiveSkill?(skill: ActiveSkill | null): void;
  push(text: string, kind?: "system" | "error"): void;
  setModel(model: string): void;
  /** Present in the TUI. `/model` with no id opens the picker instead of printing the id. */
  openModelPicker?(): void;
  /** Present in the TUI. `/effort` with no level opens the picker instead of printing it. */
  openEffortPicker?(): void;
  effort?: EffortLevel;
  setEffort?(level: EffortLevel): void;
  /** UltraCode: max thinking plus subagent dispatch. Independent of the named levels. */
  ultracode?: boolean;
  /** Toggle subagent dispatch. Does not change the effort level. */
  setUltracode?(on: boolean): void;
  setMode(mode: PermissionMode): void;
  setProfile(profile: string): void;
  setTheme(theme: "dark" | "light" | "ansi"): void;
  setAccent(name: string): void;
  setEditor(editor: "normal" | "vim"): void;
  setOutputStyle(style: "normal" | "concise"): void;
  setShell(enabled: boolean): void;
  setSessionName(name: string): void;
  addRule(kind: "allow" | "deny" | "ask", rule: string): void;
  clear(): void;
  exit(): void;
  runTurn(text: string, opts?: { readOnly?: boolean }): Promise<void>;
  compact(instructions: string): Promise<void>;
  btw(question: string): Promise<void>;
  recap(): Promise<void>;
  resume(id?: string): Promise<void>;
  rewind(index?: number): void;
  branch(name?: string): void;
  addDir(dir: string): void;
  cd(dir: string): void;
  killTask(id: string): void;
  copyLast(): void;
  exportSession(file?: string): void;
  showMemory(): void;
  showDiff(): void;
}

const CATALOG: SlashCommand[] = [
  { name: "help", summary: "Show commands", available: true },
  { name: "clear", aliases: ["reset", "new"], summary: "Start a fresh conversation", available: true },
  { name: "compact", summary: "Summarize the conversation to free context", available: true },
  { name: "config", aliases: ["settings"], summary: "Show or set model, mode, theme, editor", available: true },
  { name: "cost", aliases: ["usage", "stats"], summary: "Show token usage for this session", available: true },
  { name: "doctor", aliases: ["checkup"], summary: "Check the local setup", available: true },
  { name: "exit", aliases: ["quit"], summary: "Exit Glue", available: true },
  { name: "init", summary: "Write an AGENT.md for this project", available: true },
  { name: "memory", summary: "Show the project memory file", available: true },
  { name: "model", summary: "Open the model list, or /model <id> to set one", available: true },
  { name: "effort", summary: "Effort overlay. Alt+P switches model and effort", available: true },
  { name: "permissions", aliases: ["allowed-tools"], summary: "Show or add allow, ask, and deny rules", available: true },
  { name: "plan", summary: "Enter plan mode, optionally with a task", available: true },
  { name: "status", summary: "Session status", available: true },
  { name: "diff", summary: "Show the git working tree diff", available: true },
  { name: "review", aliases: ["code-review"], summary: "Read-only review of the current diff", available: true },
  { name: "resume", aliases: ["continue"], summary: "Open the session picker, or resume an id", available: true },
  { name: "export", summary: "Write the transcript to a markdown file", available: true },
  { name: "rename", summary: "Name the current session", available: true },
  { name: "context", summary: "Rough token use against the context window", available: true },
  { name: "add-dir", summary: "Add another directory to the workspace", available: true },
  { name: "tasks", summary: "List background shell tasks", available: true },
  { name: "profile", summary: "Show or switch the agent profile", available: true },
  { name: "theme", summary: "dark, light, or ansi", available: true },
  { name: "vim", summary: "Toggle a basic vim editing mode", available: true },
  { name: "color", summary: "Set the prompt accent color", available: true },
  { name: "bug", summary: "Save a local feedback note", available: true },
  { name: "recap", summary: "One-line summary of this session", available: true },
  { name: "copy", summary: "Save the last reply to .agent/last-response.md", available: true },
  { name: "cd", summary: "Move the session to another directory", available: true },
  { name: "branch", summary: "Branch the conversation into a new session", available: true },
  { name: "rewind", aliases: ["undo"], summary: "Restore files and drop later turns", available: true },
  { name: "btw", summary: "Ask a side question that is not stored", available: true },
  { name: "output-style", summary: "normal or concise", available: true },
  { name: "goal", summary: "Show or set a persistent goal for this session", available: true },
  { name: "auto", summary: "Auto-approve low-risk tools; high-risk still asks", available: true },
  { name: "statusline", summary: "Generate or clear the custom status line (global ~/.glue)", available: true },
  { name: "skill", aliases: ["skills"], summary: "List skills, or /skill <name> to load one", available: true },
  { name: "plugin", summary: "Load a local skill library or install one from GitHub", available: true },
  { name: "login", summary: "Account login", available: false, note: "Glue uses an API key. Set GLUE_API_KEY, AGENT_API_KEY, or OPENAI_API_KEY." },
  { name: "logout", summary: "Sign out", available: false, note: "There is no account session. Unset the API key in your environment to stop using it." },
  { name: "mcp", summary: "MCP servers", available: false, note: "MCP servers are not in this build. Glue's tools are the built-in file, search, and optional shell tools." },
  { name: "ide", summary: "IDE integration", available: false, note: "IDE integration is not in this build. Run glue in the project directory." },
  { name: "hooks", summary: "Hooks", available: false, note: "Hooks are not in this build." },
  { name: "voice", summary: "Voice input", available: false, note: "Voice input is not in this build." },
  { name: "upgrade", summary: "Upgrade", available: false, note: "Upgrade by pulling this repository and running npm install && npm run build." },
  { name: "desktop", summary: "Desktop app", available: false, note: "Glue Cli is a terminal agent. There is no desktop app in this build." },
  { name: "teleport", summary: "Cloud session", available: false, note: "Remote sessions are not in this build. Use /resume for local sessions." },
  { name: "remote-control", aliases: ["rc"], summary: "Remote control", available: false, note: "Remote control is not in this build." },
  { name: "chrome", summary: "Browser control", available: false, note: "Browser control is not in this build." },
  { name: "install-github-app", summary: "GitHub app", available: false, note: "GitHub app install is not in this build." },
];

const IMMEDIATE = new Set(["status", "cost", "usage", "stats", "help", "exit", "quit", "model", "effort", "permissions", "theme", "goal", "auto", "statusline", "plugin"]);

export function commandCatalog(): SlashCommand[] {
  return CATALOG;
}

export function isImmediateCommand(input: string): boolean {
  const name = commandName(input);
  return name ? IMMEDIATE.has(name) : false;
}

export function filterCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  return CATALOG.filter((command) => {
    const names = [command.name, ...(command.aliases ?? [])].map((name) => name.toLowerCase());
    if (!q) return command.available;
    return names.some((name) => name.startsWith(q));
  });
}

export function helpLines(): string[] {
  return helpText().split("\n");
}

export function isHelpDump(text: string): boolean {
  return text.startsWith("Glue Cli commands");
}

/** A help dump opens the bounded panel. Anything else is a single transcript line. */
export function presentCommandOutput(text: string): { helpPanel: boolean; line: string | null } {
  if (isHelpDump(text)) return { helpPanel: true, line: null };
  return { helpPanel: false, line: text };
}

export function unavailableLine(command: SlashCommand): string {
  const note = (command.note ?? `/${command.name} 当前版本没有这个功能。`).replace(/\s+/g, " ").trim();
  return `/${command.name} 不可用。${note}`;
}

/**
 * Run the command the user typed when it is an exact name.
 * A unique prefix may complete. A highlighted menu row is used only when the
 * text itself is an ambiguous prefix, so `/login` is never rewritten to `/help`.
 */
export function resolveSubmittedSlash(input: string, highlightIndex: number): string {
  const trimmed = input.trim();
  const parsed = splitCommand(trimmed);
  if (!parsed) return trimmed;
  if (parsed.args) return trimmed;
  const exact = findExact(parsed.name);
  if (exact) return `/${exact.name}`;
  const matches = filterCommands(parsed.name);
  if (matches.length === 1 && matches[0]) return `/${matches[0].name}`;
  if (matches.length > 1) {
    const picked = matches[Math.max(0, Math.min(highlightIndex, matches.length - 1))];
    if (picked) return `/${picked.name}`;
  }
  return trimmed;
}

export function helpText(): string {
  const lines = CATALOG.filter((command) => command.available).map((command) => `/${command.name.padEnd(16)} ${command.summary}`);
  return ["Glue Cli commands", "", ...lines, "", "Unavailable here: /login /mcp /ide /hooks /voice /desktop"].join("\n");
}

export async function runSlashCommand(input: string, host: CommandHost): Promise<void> {
  const parsed = splitCommand(input);
  if (!parsed) {
    host.push(helpText());
    return;
  }
  let command = findExact(parsed.name);
  if (!command && !parsed.args) {
    const matches = filterCommands(parsed.name).filter((item) => item.available && item.name.startsWith(parsed.name));
    if (matches.length === 1 && matches[0]) command = matches[0];
    else if (matches.length > 1) {
      host.push(`Did you mean ${matches.slice(0, 6).map((item) => `/${item.name}`).join(", ")}?`);
      return;
    }
  }
  if (!command) {
    const skills = discoverSkills({ workspace: host.workspace, home: host.home ?? homedir() });
    const skill = resolveSkill(skills, parsed.name);
    if (skill === "ambiguous") {
      host.push(`技能 ${parsed.name} 有多个来源。用 /skill <plugin>:<name>。`, "error");
      return;
    }
    if (skill) {
      await activateSkill(skill, parsed.args, host);
      return;
    }
    host.push(`Unknown command: /${parsed.name}`, "error");
    return;
  }
  if (!command.available) {
    host.push(unavailableLine(command));
    return;
  }
  await dispatch(command.name, parsed.args, host);
}

async function dispatch(name: string, args: string, host: CommandHost): Promise<void> {
  switch (name) {
    case "help":
      host.push(helpText());
      return;
    case "clear":
      host.clear();
      return;
    case "compact":
      await host.compact(args);
      return;
    case "config":
      applyConfig(args, host);
      return;
    case "cost":
      host.push(`Input tokens:  ${host.usage.input}\nOutput tokens: ${host.usage.output}\nTotal:         ${host.usage.input + host.usage.output}`);
      return;
    case "doctor":
      host.push(formatDoctor(diagnose(host.config)));
      return;
    case "exit":
      host.exit();
      return;
    case "init":
      await host.runTurn(args ? `${INIT_PROMPT}\n\nFocus: ${args}` : INIT_PROMPT);
      return;
    case "memory":
      host.showMemory();
      return;
    case "model":
      if (!args) {
        if (host.openModelPicker) host.openModelPicker();
        else host.push(`Model: ${host.model}`);
      } else {
        host.setModel(args);
        host.push(`Model set to ${args} for this session.`);
      }
      return;
    case "effort":
      applyEffort(args, host);
      return;
    case "permissions":
      applyPermissions(args, host);
      return;
    case "plan":
      host.setMode("plan");
      host.push("⏸ plan mode on — read-only until you approve a plan.");
      if (args) await host.runTurn(args);
      return;
    case "status":
      host.push(
        [
          `Glue Cli ${host.sessionId}`,
          `Name:       ${host.sessionName || "(unnamed)"}`,
          `Model:      ${host.model}`,
          `Effort:     ${effortStatusLabel(host.effort, host.ultracode)}`,
          `Mode:       ${host.permissionMode}`,
          `Approval:   ${host.approval ?? "manual"}`,
          `Goal:       ${host.goal?.trim() || "(none)"}`,
          `Profile:    ${host.profile}`,
          `Shell:      ${host.shellEnabled ? "enabled" : "disabled"}`,
          `Workspace:  ${host.workspace}`,
          `Tokens:     ${host.usage.input + host.usage.output}`,
        ].join("\n"),
      );
      return;
    case "diff":
      host.showDiff();
      return;
    case "review":
      await host.runTurn(
        args
          ? `Review this for correctness bugs. Do not edit files.\n\n${args}`
          : "Review the current git diff for correctness bugs. Read the changed files. Do not edit files. Report findings as file:line and a short failure scenario.",
        { readOnly: true },
      );
      return;
    case "resume":
      await host.resume(args || undefined);
      return;
    case "export":
      host.exportSession(args || undefined);
      return;
    case "rename":
      if (!args) host.push("Usage: /rename <name>");
      else {
        host.setSessionName(args.slice(0, 80));
        host.push(`Session renamed to ${args.slice(0, 80)}.`);
      }
      return;
    case "context": {
      const used = host.usage.input + host.usage.output;
      const pct = Math.min(100, Math.round((used / Math.max(1, host.contextWindow)) * 100));
      const filled = Math.round(pct / 5);
      host.push(`Context (session tokens reported by the API)\n${"█".repeat(filled)}${"░".repeat(20 - filled)}  ${used} / ${host.contextWindow} (${pct}%)\n/compact summarizes the conversation.`);
      return;
    }
    case "add-dir":
      if (!args) host.push("Usage: /add-dir <path>");
      else host.addDir(args);
      return;
    case "tasks":
      if (!host.tasks.length) host.push("No background tasks.");
      else host.push(host.tasks.map((task) => `${task.id}  ${task.status}  ${task.command}`).join("\n"));
      if (args.startsWith("kill ")) host.killTask(args.slice(5).trim());
      return;
    case "profile":
      if (!args) host.push(`Profile: ${host.profile}\nAdd PROMPT.md under profiles/${host.profile}/ or .agent/profiles/${host.profile}/.`);
      else {
        host.setProfile(args);
        host.push(`Profile set to ${args}. The system prompt updates on the next turn.`);
      }
      return;
    case "theme":
      if (args === "dark" || args === "light" || args === "ansi") {
        host.setTheme(args);
        host.push(`Theme: ${args}`);
      } else host.push("Usage: /theme dark|light|ansi");
      return;
    case "vim": {
      const next = host.editor === "vim" ? "normal" : "vim";
      host.setEditor(next);
      host.push(next === "vim" ? "Vim mode on. Esc enters normal mode. Enter still sends." : "Vim mode off.");
      return;
    }
    case "color":
      host.setAccent(args || "default");
      return;
    case "bug":
      writeBug(host.workspace, args);
      host.push(`Saved a note under ${path.join(host.workspace, ".agent", "feedback")}.`);
      return;
    case "recap":
      await host.recap();
      return;
    case "copy":
      host.copyLast();
      return;
    case "cd":
      if (!args) host.push(`Workspace: ${host.workspace}`);
      else host.cd(args);
      return;
    case "branch":
      host.branch(args || undefined);
      return;
    case "rewind":
      host.rewind(args ? Number(args) : undefined);
      return;
    case "btw":
      if (!args) host.push("Usage: /btw <question>");
      else await host.btw(args);
      return;
    case "output-style":
      if (args === "concise" || args === "normal") {
        host.setOutputStyle(args);
        host.push(`Output style: ${args}`);
      } else host.push("Usage: /output-style normal|concise");
      return;
    case "goal":
      applyGoal(args, host);
      return;
    case "auto":
      applyAuto(args, host);
      return;
    case "statusline":
      applyStatusline(args, host);
      return;
    case "skill":
      await applySkill(args, host);
      return;
    case "plugin":
      applyPlugin(args, host);
      return;
    default:
      host.push(`/${name} is not wired in this build.`, "error");
  }
}

function applyConfig(args: string, host: CommandHost): void {
  if (!args) {
    host.push(
      [
        `model=${host.model}`,
        `effort=${host.effort ?? "auto"}`,
        `permission_mode=${host.permissionMode}`,
        `profile=${host.profile}`,
        `theme=${host.themeName}`,
        `editor=${host.editor}`,
        `output_style=${host.outputStyle}`,
        `shell=${host.shellEnabled}`,
        `approval=${host.approval ?? "manual"}`,
        `goal=${host.goal?.trim() || ""}`,
        `statusLine=${host.statusLine?.command ?? "(none)"}`,
        `protocol=${host.config.protocol}`,
        `base_url=${host.config.baseURL}`,
        `config=${host.config.configPath ?? "(defaults)"}`,
        "Set one with /config key=value. Keys: model, effort, permission_mode, profile, theme, editor, output_style, shell, approval, goal, statusline.",
      ].join("\n"),
    );
    return;
  }
  const eq = args.indexOf("=");
  if (eq === -1) {
    host.push("Usage: /config key=value", "error");
    return;
  }
  const key = args.slice(0, eq).trim();
  const value = args.slice(eq + 1).trim();
  if (key === "model") host.setModel(value);
  else if (key === "effort") {
    const parsed = parseEffortCommand(value);
    if (parsed.kind === "ultracode-off") {
      host.setUltracode?.(false);
      host.push(`UltraCode off. Effort stays ${host.effort ?? "auto"}.`);
    } else if (parsed.kind === "ultracode-on") {
      host.setUltracode?.(true);
      host.push(`${ULTRACODE_DESCRIPTION}. Effort stays ${host.effort ?? "auto"}.`);
    } else if (parsed.kind === "set" && host.setEffort) {
      host.setEffort(parsed.effort);
    } else {
      host.push(`Usage: /config effort=${[...EFFORT_CYCLE, "ultracode"].join("|")}`, "error");
    }
  } else if (key === "permission_mode" || key === "mode") host.setMode(normalizeMode(value));
  else if (key === "profile") host.setProfile(value);
  else if (key === "theme" && (value === "dark" || value === "light" || value === "ansi")) host.setTheme(value);
  else if (key === "editor" && (value === "vim" || value === "normal")) host.setEditor(value);
  else if (key === "output_style" && (value === "concise" || value === "normal")) host.setOutputStyle(value);
  else if (key === "shell") host.setShell(/^(1|true|yes|on)$/i.test(value));
  else if (key === "approval" || key === "auto") {
    const approval = normalizeApproval(value);
    if (!approval || !host.setApproval) {
      host.push("Usage: /config approval=manual|auto", "error");
      return;
    }
    host.setApproval(approval);
  } else if (key === "goal") {
    if (!host.setGoal) {
      host.push("这个会话不能保存目标。", "error");
      return;
    }
    host.setGoal(value);
  } else if (key === "statusline") {
    applyStatusline(value, host);
    return;
  } else {
    host.push(`Unknown config key ${key}`, "error");
    return;
  }
  host.push(`Set ${key}=${value} for this session.`);
}

function applyGoal(args: string, host: CommandHost): void {
  if (!args || args === "status" || args === "状态") {
    host.push(host.goal?.trim() ? `当前目标：${host.goal.trim()}` : "还没有目标。用 /goal <一句话> 设定，/goal clear 清除。");
    return;
  }
  if (["clear", "none", "off", "reset", "清除"].includes(args.toLowerCase())) {
    if (!host.setGoal) {
      host.push("这个会话不能保存目标。", "error");
      return;
    }
    host.setGoal("");
    host.push("已清除目标。");
    return;
  }
  if (!host.setGoal) {
    host.push("这个会话不能保存目标。", "error");
    return;
  }
  host.setGoal(args);
  host.push(`目标已设为：${args}`);
}

function applyAuto(args: string, host: CommandHost): void {
  const active = autoEngaged(host.permissionMode, host.approval ?? "manual");
  const trimmed = args.trim();
  if (!trimmed || trimmed === "status" || trimmed === "状态") {
    host.push(
      active
        ? "自动确认已开。低风险的读、改和本地命令会直接执行，rm -rf、越出目录、联网安装和提权仍会询问。"
        : "手动确认已开。改文件和执行命令前会询问。/auto on 打开自动确认。",
    );
    return;
  }
  const next = trimmed === "toggle" || trimmed === "切换" ? (active ? "manual" : "auto") : normalizeApproval(trimmed);
  if (!next || !host.setApproval) {
    host.push("用法：/auto on | off | toggle。高风险操作始终询问。", "error");
    return;
  }
  host.setApproval(next);
  if (next === "auto") host.setMode("auto");
  else if (host.permissionMode === "auto") host.setMode("default");
  host.push(next === "auto" ? "已开启自动确认：低风险操作直接执行，高风险仍会询问。" : "已关闭自动确认，回到手动模式。");
}

function applyStatusline(args: string, host: CommandHost): void {
  const home = host.home ?? homedir();
  const parsed = parseStatuslineRequest(args);
  if (parsed.kind === "show") {
    const current = readStatusLineConfig(home);
    host.push(current ? formatStatusLineStatus(current, home) : noStatusLineHelp());
    return;
  }
  if (parsed.kind === "clear") {
    clearStatusLineConfig(home);
    host.statusLine = null;
    host.onStatusLineChange?.();
    host.push(`Removed the custom status line from ${glueSettingsPath(home)}.`);
    return;
  }
  const fields: StatusField[] =
    parsed.kind === "designed" ? [...DESIGNED_STATUS_FIELDS] : parsed.kind === "set" ? parsed.fields : [...DEFAULT_SCRIPT_FIELDS];
  const progressBar = parsed.kind === "set" || parsed.kind === "designed" || parsed.kind === "default" ? parsed.progressBar : true;
  const installed = installStatusLine(home, { fields, progressBar });
  host.statusLine = installed.config;
  host.onStatusLineChange?.();
  host.push(
    [
      `Status line saved to ${installed.settingsPath}`,
      `Script: ${installed.scriptPath}`,
      `Fields: ${installed.fields.join(", ")}`,
      "Glue feeds the script JSON on stdin and shows stdout above the footer.",
      "Clear with /statusline clear (also delete / remove).",
    ].join("\n"),
  );
}

function formatStatusLineStatus(config: StatusLineConfig, home: string): string {
  const interval = config.refreshInterval == null ? "off" : `${config.refreshInterval}s`;
  return [
    `Status line command: ${config.command}`,
    `Settings: ${glueSettingsPath(home)}`,
    `padding=${config.padding}  refreshInterval=${interval}`,
    "Describe a new bar with /statusline <text>, or /statusline with no args for model + context %.",
    "/statusline clear removes it.",
  ].join("\n");
}

function noStatusLineHelp(): string {
  return [
    "No custom status line. /statusline with no args writes ~/.glue/statusline.sh and ~/.glue/settings.json (model + context %).",
    "Example: /statusline show model name and context percentage with a progress bar",
    "/statusline clear  /  delete  /  remove",
  ].join("\n");
}

async function applySkill(args: string, host: CommandHost): Promise<void> {
  const skills = discoverSkills({ workspace: host.workspace, home: host.home ?? homedir() });
  const trimmed = args.trim();
  if (!trimmed || trimmed === "list" || trimmed === "列表") {
    host.push(formatSkillList(skills));
    return;
  }
  if (["clear", "none", "off", "reset", "清除"].includes(trimmed.toLowerCase())) {
    host.setActiveSkill?.(null);
    host.push("已取消当前技能。");
    return;
  }
  const space = trimmed.search(/\s/);
  const name = space === -1 ? trimmed : trimmed.slice(0, space);
  const request = space === -1 ? "" : trimmed.slice(space + 1).trim();
  const skill = resolveSkill(skills, name);
  if (skill === "ambiguous") {
    host.push(`技能 ${name} 有多个来源。用 /skill <plugin>:<name>。`, "error");
    return;
  }
  if (!skill) {
    host.push(`没有技能 ${name}。/skill 查看列表，/plugin load <目录> 或 /plugin install <owner/repo> 安装。`, "error");
    return;
  }
  await activateSkill(skill, request, host);
}

async function activateSkill(skill: Skill, request: string, host: CommandHost): Promise<void> {
  const active = toActiveSkill(skill);
  host.setActiveSkill?.(active);
  host.push(`已加载技能 ${skill.id}${skill.description ? `：${skill.description}` : ""}`);
  if (host.setActiveSkill) {
    await host.runTurn(request || `Follow the active skill "${skill.id}".`);
    return;
  }
  const prompt = [`Follow this skill (${skill.id}).`, skill.body, request].filter(Boolean).join("\n\n");
  await host.runTurn(prompt);
}

function applyPlugin(args: string, host: CommandHost): void {
  const home = host.home ?? homedir();
  const workspace = host.workspace;
  const trimmed = args.trim();
  if (!trimmed || trimmed === "list" || trimmed === "列表") {
    host.push(formatPluginList(listPlugins({ home, workspace })));
    return;
  }
  const space = trimmed.search(/\s/);
  const sub = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const target = space === -1 ? "" : trimmed.slice(space + 1).trim();
  try {
    if (sub === "install" || sub === "add") {
      if (!target) {
        host.push("用法：/plugin install <owner/repo|目录>", "error");
        return;
      }
      const record = installPlugin(target, { home, workspace });
      host.push(`已安装插件 ${record.name}（${record.scope}）。/skill 查看技能。`);
      return;
    }
    if (sub === "load") {
      if (!target) {
        host.push("用法：/plugin load <目录>", "error");
        return;
      }
      const record = loadPlugin(target, { workspace });
      host.push(`已加载插件 ${record.name}：${record.path}`);
      return;
    }
    if (sub === "remove" || sub === "uninstall" || sub === "rm") {
      if (!target) {
        host.push("用法：/plugin remove <name>", "error");
        return;
      }
      const removed = removePlugin(target, { home, workspace });
      host.push(`已移除插件 ${removed}。`);
      return;
    }
    const record = installPlugin(trimmed, { home, workspace });
    host.push(`已安装插件 ${record.name}。/skill 查看技能。`);
  } catch (error) {
    host.push(error instanceof Error ? error.message : String(error), "error");
  }
}

function applyEffort(args: string, host: CommandHost): void {
  const parsed = parseEffortCommand(args);
  if (parsed.kind === "picker") {
    if (host.openEffortPicker) {
      host.openEffortPicker();
      return;
    }
    host.push(`Effort: ${effortStatusLabel(host.effort, host.ultracode)}`);
    return;
  }
  if (parsed.kind === "status") {
    host.push(`Effort: ${effortStatusLabel(host.effort, host.ultracode)}`);
    return;
  }
  if (parsed.kind === "ultracode-on") {
    host.setUltracode?.(true);
    host.push(`${ULTRACODE_DESCRIPTION}. Effort stays ${host.effort ?? "auto"}.`);
    return;
  }
  if (parsed.kind === "ultracode-off") {
    host.setUltracode?.(false);
    host.push(`UltraCode off. Effort stays ${host.effort ?? "auto"}.`);
    return;
  }
  if (parsed.kind === "set") {
    if (!host.setEffort) {
      host.push(`Usage: /effort ${[...EFFORT_CYCLE, "ultracode"].join("|")}`, "error");
      return;
    }
    host.setEffort(parsed.effort);
    host.push(effortSetMessage({ effort: parsed.effort, ultracode: false }));
    return;
  }
  host.push(`Usage: /effort ${[...EFFORT_CYCLE, "ultracode"].join("|")}`, "error");
}

function applyPermissions(args: string, host: CommandHost): void {
  if (!args || args === "list") {
    host.push(
      [
        `mode: ${host.permissionMode}`,
        `allow: ${host.rules.allow.join(", ") || "(none)"}`,
        `ask:   ${host.rules.ask.join(", ") || "(none)"}`,
        `deny:  ${host.rules.deny.join(", ") || "(none)"}`,
        "Add a rule with /permissions allow Bash(npm test *)",
        "Or /permissions deny Read(**/.env)",
        "Or /permissions mode plan",
        "shift+tab cycles plan → manual → accept edits → auto → YOLO.",
      ].join("\n"),
    );
    return;
  }
  if (args.startsWith("mode ")) {
    const mode = normalizeMode(args.slice(5).trim());
    host.setMode(mode);
    host.push(`Permission mode: ${mode}`);
    return;
  }
  const kind = args.startsWith("allow ") ? "allow" : args.startsWith("deny ") ? "deny" : args.startsWith("ask ") ? "ask" : undefined;
  if (!kind) {
    host.push("Usage: /permissions allow|deny|ask <rule>  or  /permissions mode <mode>", "error");
    return;
  }
  const rule = args.slice(kind.length).trim();
  host.addRule(kind, rule);
  host.push(`Added ${kind} rule ${rule}`);
}

function writeBug(workspace: string, note: string): void {
  const dir = path.join(workspace, ".agent", "feedback");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}.md`);
  writeFileSync(file, `# Glue feedback\n\n${note || "(no description)"}\n`);
}

export function gitText(workspace: string, args: string[]): string {
  if (!existsSync(path.join(workspace, ".git"))) return "Not a git repository.";
  const result = spawnSync("git", args, { cwd: workspace, encoding: "utf8" });
  if (result.error) return result.error.message;
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return text || "(no output)";
}

export function readMemoryPreview(workspace: string): string {
  const file = memoryPath(workspace);
  const text = loadMemory(workspace);
  if (!text) return `No memory file yet. /init asks Glue to write ${path.join(workspace, "AGENT.md")}.`;
  const lines = text.split("\n").slice(0, 40).join("\n");
  return `${file}\n\n${lines}`;
}

function findExact(name: string): SlashCommand | undefined {
  const q = name.toLowerCase();
  return CATALOG.find((command) => command.name === q || command.aliases?.includes(q));
}

function commandName(input: string): string | undefined {
  return splitCommand(input)?.name;
}

function splitCommand(input: string): { name: string; args: string } | null {
  const body = input.trim().replace(/^\//, "").trim();
  if (!body) return null;
  const space = body.search(/\s/);
  if (space === -1) return { name: body.toLowerCase(), args: "" };
  return { name: body.slice(0, space).toLowerCase(), args: body.slice(space + 1).trim() };
}
