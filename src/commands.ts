import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { diagnose, formatDoctor } from "./doctor.js";
import { INIT_PROMPT, loadMemory, memoryPath } from "./prompt.js";
import { normalizeMode } from "./permissions.js";
import type { PermissionMode, PermissionRules, TokenUsage } from "./types.js";
import type { AppConfig } from "./config.js";

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
  push(text: string, kind?: "system" | "error"): void;
  setModel(model: string): void;
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
  { name: "model", summary: "Show or switch the model", available: true },
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
  { name: "login", summary: "Account login", available: false, note: "Glue uses an API key. Set GLUE_API_KEY, AGENT_API_KEY, or OPENAI_API_KEY." },
  { name: "logout", summary: "Sign out", available: false, note: "There is no account session. Unset the API key in your environment to stop using it." },
  { name: "mcp", summary: "MCP servers", available: false, note: "MCP servers are not in this build. Glue's tools are the built-in file, search, and optional shell tools." },
  { name: "ide", summary: "IDE integration", available: false, note: "IDE integration is not in this build. Run glue in the project directory." },
  { name: "plugin", summary: "Plugins", available: false, note: "Plugins are not in this build. Add a profile at profiles/<name>/PROMPT.md instead." },
  { name: "hooks", summary: "Hooks", available: false, note: "Hooks are not in this build." },
  { name: "voice", summary: "Voice input", available: false, note: "Voice input is not in this build." },
  { name: "upgrade", summary: "Upgrade", available: false, note: "Upgrade by pulling this repository and running npm install && npm run build." },
  { name: "desktop", summary: "Desktop app", available: false, note: "Glue Cli is a terminal agent. There is no desktop app in this build." },
  { name: "teleport", summary: "Cloud session", available: false, note: "Remote sessions are not in this build. Use /resume for local sessions." },
  { name: "remote-control", aliases: ["rc"], summary: "Remote control", available: false, note: "Remote control is not in this build." },
  { name: "chrome", summary: "Browser control", available: false, note: "Browser control is not in this build." },
  { name: "install-github-app", summary: "GitHub app", available: false, note: "GitHub app install is not in this build." },
];

const IMMEDIATE = new Set(["status", "cost", "usage", "stats", "help", "exit", "quit", "model", "permissions", "theme"]);

export function commandCatalog(): SlashCommand[] {
  return CATALOG;
}

export function isImmediateCommand(input: string): boolean {
  const name = commandName(input);
  return name ? IMMEDIATE.has(name) : false;
}

export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return CATALOG.filter((command) => {
    const names = [command.name, ...(command.aliases ?? [])];
    const hit = !q || names.some((name) => name.toLowerCase().startsWith(q) || name.toLowerCase().includes(q));
    if (!hit) return false;
    if (!command.available) return names.some((name) => name.toLowerCase() === q);
    return true;
  });
}

export function helpText(): string {
  const lines = CATALOG.filter((command) => command.available).map((command) => `/${command.name.padEnd(16)} ${command.summary}`);
  return ["Glue Cli commands", "", ...lines, "", "Unavailable here: /login /mcp /ide /plugin /hooks /voice /desktop"].join("\n");
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
    host.push(`Unknown command: /${parsed.name}`, "error");
    return;
  }
  if (!command.available) {
    host.push(command.note ?? `/${command.name} is not available in Glue.`);
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
      if (!args) host.push(`Model: ${host.model}`);
      else {
        host.setModel(args);
        host.push(`Model set to ${args} for this session.`);
      }
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
          `Mode:       ${host.permissionMode}`,
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
    default:
      host.push(`/${name} is not wired in this build.`, "error");
  }
}

function applyConfig(args: string, host: CommandHost): void {
  if (!args) {
    host.push(
      [
        `model=${host.model}`,
        `permission_mode=${host.permissionMode}`,
        `profile=${host.profile}`,
        `theme=${host.themeName}`,
        `editor=${host.editor}`,
        `output_style=${host.outputStyle}`,
        `shell=${host.shellEnabled}`,
        `protocol=${host.config.protocol}`,
        `base_url=${host.config.baseURL}`,
        `config=${host.config.configPath ?? "(defaults)"}`,
        "Set one with /config key=value. Keys: model, permission_mode, profile, theme, editor, output_style, shell.",
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
  else if (key === "permission_mode" || key === "mode") host.setMode(normalizeMode(value));
  else if (key === "profile") host.setProfile(value);
  else if (key === "theme" && (value === "dark" || value === "light" || value === "ansi")) host.setTheme(value);
  else if (key === "editor" && (value === "vim" || value === "normal")) host.setEditor(value);
  else if (key === "output_style" && (value === "concise" || value === "normal")) host.setOutputStyle(value);
  else if (key === "shell") host.setShell(/^(1|true|yes|on)$/i.test(value));
  else {
    host.push(`Unknown config key ${key}`, "error");
    return;
  }
  host.push(`Set ${key}=${value} for this session.`);
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
        "shift+tab cycles default → accept edits → plan.",
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
