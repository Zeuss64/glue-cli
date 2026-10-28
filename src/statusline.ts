import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { TokenUsage } from "./types.js";
import { VERSION } from "./version.js";
import { displayWidth } from "./tui/text.js";

export const STATUS_FIELDS = [
  "hint",
  "model",
  "effort",
  "tokens",
  "context",
  "contextSize",
  "cache",
  "cwd",
  "branch",
  "goal",
  "shell",
  "session",
] as const;

export type StatusField = (typeof STATUS_FIELDS)[number];

/** Built-in footer when no custom `statusLine` command is configured. */
export const DEFAULT_STATUS_FIELDS: readonly StatusField[] = ["hint", "effort", "tokens"];

/** `/statusline` with no args: model + context percent. */
export const DEFAULT_SCRIPT_FIELDS: readonly StatusField[] = ["model", "context"];

/** `/statusline designed` — a fuller Glue row. */
export const DESIGNED_STATUS_FIELDS: readonly StatusField[] = ["model", "effort", "tokens", "context", "goal"];

const CANONICAL: readonly StatusField[] = STATUS_FIELDS;

const ALIASES: Array<{ field: StatusField; words: string[] }> = [
  { field: "hint", words: ["hint", "shortcuts", "shortcut", "快捷键", "提示"] },
  { field: "model", words: ["model", "模型", "使用模型"] },
  { field: "effort", words: ["effort", "档位", "力度"] },
  { field: "tokens", words: ["tokens", "token", "tok", "用量", "使用量", "token使用量"] },
  { field: "cwd", words: ["cwd", "directory", "dir", "目录", "路径", "workspace"] },
  { field: "branch", words: ["branch", "分支"] },
  { field: "goal", words: ["goal", "目标"] },
  { field: "shell", words: ["shell", "终端"] },
  { field: "session", words: ["session", "会话"] },
];

const EXACT: Record<string, StatusField> = {
  hint: "hint",
  model: "model",
  effort: "effort",
  tokens: "tokens",
  context: "context",
  contextsize: "contextSize",
  context_size: "contextSize",
  "context-size": "contextSize",
  cache: "cache",
  cwd: "cwd",
  branch: "branch",
  goal: "goal",
  shell: "shell",
  session: "session",
};

export type StatuslineParse =
  | { kind: "show" }
  | { kind: "default"; progressBar: boolean }
  | { kind: "clear" }
  | { kind: "designed"; progressBar: boolean }
  | { kind: "set"; fields: StatusField[]; progressBar: boolean };

export interface StatusLineConfig {
  type: "command";
  command: string;
  padding: number;
  refreshInterval: number | null;
}

export interface GlueSettingsFile {
  statusLine?: StatusLineConfig;
  [key: string]: unknown;
}

export interface StatusContext {
  hint?: string;
  effort?: string;
  usage?: TokenUsage;
  model?: string;
  cwd?: string;
  branch?: string;
  goal?: string;
  shell?: boolean;
  session?: string;
  /** Provider context window, in tokens. */
  contextWindow?: number;
}

export interface StatusLinePayloadInput {
  cwd: string;
  sessionId: string;
  sessionName?: string;
  model: string;
  modelDisplayName?: string;
  effort?: string;
  usage?: TokenUsage;
  contextWindow: number;
  version?: string;
  workspaceProjectDir?: string;
}

/** Claude-like stdin JSON. Extra Glue fields live under `glue`. */
export interface StatusLinePayload {
  cwd: string;
  session_id: string;
  session_name?: string;
  version: string;
  model: { id: string; display_name: string };
  workspace: { current_dir: string; project_dir: string };
  context_window: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number;
    used_percentage: number | null;
    remaining_percentage: number | null;
    current_usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    } | null;
  };
  effort?: { level: string };
  prompt_cache?: { hit_ratio: number | null; cache_read_tokens?: number; cache_write_tokens?: number };
  glue?: { goal?: string; shell?: boolean; session?: string; hint?: string; branch?: string };
}

export const STATUSLINE_DEBOUNCE_MS = 300;
export const STATUSLINE_COMMAND_TIMEOUT_MS = 1500;
export const STATUSLINE_MAX_LINES = 4;
export const STATUSLINE_SCRIPT_NAME = "statusline.sh";

export function glueDir(home = homedir(), join: (...parts: string[]) => string = path.join): string {
  return join(home, ".glue");
}

export function glueSettingsPath(home = homedir(), join: (...parts: string[]) => string = path.join): string {
  return join(home, ".glue", "settings.json");
}

export function glueStatuslineScriptPath(home = homedir(), join: (...parts: string[]) => string = path.join): string {
  return join(home, ".glue", STATUSLINE_SCRIPT_NAME);
}

export function parseStatuslineRequest(input: string): StatuslineParse {
  const raw = input.trim();
  if (!raw) return { kind: "default", progressBar: true };
  const folded = raw.toLowerCase();
  if (folded === "status" || folded === "show" || folded === "状态") return { kind: "show" };
  if (isClearRequest(raw)) return { kind: "clear" };
  const progressBar = mentionsProgressBar(raw);
  if (["designed", "design", "smart", "推荐", "设计"].includes(folded)) return { kind: "designed", progressBar };
  if (["reset", "default", "defaults", "默认", "重置"].includes(folded)) return { kind: "default", progressBar: progressBar || true };
  const fields = collectFields(raw);
  if (!fields.length) return { kind: "default", progressBar: progressBar || true };
  return { kind: "set", fields, progressBar: progressBar || fields.includes("context") };
}

export function parseStatuslineSpec(spec: string | undefined): StatusField[] {
  if (!spec?.trim()) return [...DEFAULT_STATUS_FIELDS];
  const parsed = parseStatuslineRequest(spec);
  if (parsed.kind === "set") return parsed.fields;
  if (parsed.kind === "designed") return [...DESIGNED_STATUS_FIELDS];
  if (parsed.kind === "default" || parsed.kind === "show" || parsed.kind === "clear") return [...DEFAULT_STATUS_FIELDS];
  const fields: StatusField[] = [];
  for (const part of spec.split(/[,+|/]+/)) {
    const parsedPart = parseStatuslineRequest(part.trim());
    if (parsedPart.kind === "set") {
      for (const field of parsedPart.fields) {
        if (!fields.includes(field)) fields.push(field);
      }
    }
  }
  return fields.length ? fields : [...DEFAULT_STATUS_FIELDS];
}

export function statuslineSpec(fields: readonly StatusField[]): string {
  return fields.join(",");
}

export function formatStatusLeft(fields: readonly StatusField[], ctx: StatusContext): string {
  const parts: string[] = [];
  for (const field of fields) {
    const text = fieldText(field, ctx);
    if (text) parts.push(text);
  }
  return parts.join(" · ");
}

/** Session totals. Cache counters stay absent until a response reports them. */
export function addTokenUsage(current: TokenUsage, delta: TokenUsage): TokenUsage {
  const next: TokenUsage = {
    input: current.input + (delta.input || 0),
    output: current.output + (delta.output || 0),
  };
  if (current.cacheRead !== undefined || delta.cacheRead !== undefined) {
    next.cacheRead = (current.cacheRead ?? 0) + (delta.cacheRead ?? 0);
  }
  if (current.cacheWrite !== undefined || delta.cacheWrite !== undefined) {
    next.cacheWrite = (current.cacheWrite ?? 0) + (delta.cacheWrite ?? 0);
  }
  return next;
}

/**
 * Cache hit percent when the API reported cache reads.
 * OpenAI counts cached tokens inside `input`. Anthropic reports them in addition.
 */
export function cacheHitPercent(usage?: TokenUsage): number | undefined {
  if (!usage || usage.cacheRead === undefined) return undefined;
  const hit = usage.cacheRead;
  if (usage.input >= hit) {
    if (usage.input <= 0) return 0;
    return clampPercent((hit / usage.input) * 100);
  }
  const base = usage.input + hit;
  if (base <= 0) return 0;
  return clampPercent((hit / base) * 100);
}

export function readGlueSettings(home = homedir()): GlueSettingsFile {
  const file = glueSettingsPath(home);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as GlueSettingsFile;
  } catch {
    return {};
  }
}

export function readStatusLineConfig(home = homedir()): StatusLineConfig | null {
  return normalizeStatusLine(readGlueSettings(home).statusLine);
}

export function writeGlueSettings(home: string, patch: { statusLine?: StatusLineConfig | null }): GlueSettingsFile {
  const current = readGlueSettings(home);
  const next: GlueSettingsFile = { ...current };
  if (patch.statusLine === null) delete next.statusLine;
  else if (patch.statusLine) next.statusLine = patch.statusLine;
  const file = glueSettingsPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return readGlueSettings(home);
}

export function clearStatusLineConfig(home: string): void {
  writeGlueSettings(home, { statusLine: null });
}

export interface InstallStatusLineResult {
  settingsPath: string;
  scriptPath: string;
  config: StatusLineConfig;
  fields: StatusField[];
}

/** Write `~/.glue/statusline.sh` and `~/.glue/settings.json`. Never writes the project directory. */
export function installStatusLine(
  home: string,
  request: { fields?: readonly StatusField[]; progressBar?: boolean; padding?: number; refreshInterval?: number | null } = {},
): InstallStatusLineResult {
  const fields = request.fields?.length ? [...request.fields] : [...DEFAULT_SCRIPT_FIELDS];
  const scriptPath = glueStatuslineScriptPath(home);
  const settingsPath = glueSettingsPath(home);
  mkdirSync(path.dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, generateStatusLineScript(fields, { progressBar: request.progressBar === true }), "utf8");
  try {
    chmodSync(scriptPath, 0o755);
  } catch {
    /* win32 and some filesystems reject chmod */
  }
  const config: StatusLineConfig = {
    type: "command",
    command: `~/.glue/${STATUSLINE_SCRIPT_NAME}`,
    padding: Number.isFinite(request.padding) ? Math.max(0, Math.floor(request.padding ?? 0)) : 0,
    refreshInterval: normalizeRefreshInterval(request.refreshInterval ?? null),
  };
  writeGlueSettings(home, { statusLine: config });
  return { settingsPath, scriptPath, config, fields };
}

export function generateStatusLineScript(fields: readonly StatusField[], opts: { progressBar?: boolean } = {}): string {
  const wanted = fields.length ? [...fields] : [...DEFAULT_SCRIPT_FIELDS];
  const progressBar = opts.progressBar === true || wanted.includes("context");
  const showModel = wanted.includes("model");
  const showEffort = wanted.includes("effort");
  const showTokens = wanted.includes("tokens");
  const showContext = wanted.includes("context");
  const showWindow = wanted.includes("contextSize");
  const showCache = wanted.includes("cache");
  const showCwd = wanted.includes("cwd");
  const showBranch = wanted.includes("branch");
  const showGoal = wanted.includes("goal");
  const showShell = wanted.includes("shell");
  const showSession = wanted.includes("session");
  const showHint = wanted.includes("hint");
  const withBar = showContext && progressBar;
  return `#!/usr/bin/env node
// Generated by Glue /statusline. Reads session JSON on stdin.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", () => {
  let data = {};
  try { data = JSON.parse(raw || "{}"); } catch { data = {}; }
  const model = (data.model && (data.model.display_name || data.model.id)) || "";
  const effort = data.effort && data.effort.level ? String(data.effort.level) : "";
  const ctx = data.context_window || {};
  const inputTok = Number(ctx.total_input_tokens || 0);
  const outputTok = Number(ctx.total_output_tokens || 0);
  const pctRaw = ctx.used_percentage;
  const pct = pctRaw == null || pctRaw === "" ? 0 : Math.max(0, Math.min(100, Math.round(Number(pctRaw))));
  const windowSize = Number(ctx.context_window_size || 0);
  const cache = data.prompt_cache || {};
  const hit = cache.hit_ratio == null ? null : Math.round(Number(cache.hit_ratio) * 100);
  const cwd = (data.workspace && data.workspace.current_dir) || data.cwd || "";
  const base = cwd.replace(/[\\\\/]+$/, "").split(/[\\\\/]/).pop() || cwd;
  const glue = data.glue || {};
  const parts = [];
  ${showModel ? `if (model) parts.push(model);` : ""}
  ${showEffort ? `if (effort) parts.push("effort " + effort);` : ""}
  ${showTokens ? `const tok = inputTok + outputTok; if (tok > 0) parts.push(formatTok(tok) + " tok");` : ""}
  ${
    showContext
      ? withBar
        ? `parts.push(bar(pct) + " " + pct + "%");`
        : `parts.push(pct + "%");`
      : ""
  }
  ${showWindow ? `if (windowSize > 0) parts.push("window " + formatTok(windowSize));` : ""}
  ${showCache ? `if (hit != null && !Number.isNaN(hit)) parts.push("cache " + hit + "%");` : ""}
  ${showCwd ? `if (base) parts.push(base);` : ""}
  ${showBranch ? `if (glue.branch) parts.push(glue.branch);` : ""}
  ${showGoal ? `if (glue.goal) parts.push(String(glue.goal).slice(0, 24));` : ""}
  ${showShell ? `if (glue.shell === true) parts.push("shell on"); else if (glue.shell === false) parts.push("shell off");` : ""}
  ${showSession ? `if (glue.session) parts.push(glue.session); else if (data.session_name) parts.push(data.session_name);` : ""}
  ${showHint ? `if (glue.hint) parts.push(glue.hint);` : ""}
  process.stdout.write(parts.filter(Boolean).join(" ") + "\\n");
});
function bar(pct) {
  const n = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return "▓".repeat(n) + "░".repeat(10 - n);
}
function formatTok(n) {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1) + "k";
}
`;
}

export function buildStatusLinePayload(input: StatusLinePayloadInput, extra: StatusContext = {}): StatusLinePayload {
  const usage = input.usage;
  const windowSize = Math.max(0, input.contextWindow || 0);
  const inputTok = usage?.input ?? 0;
  const outputTok = usage?.output ?? 0;
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  const hasUsage = Boolean(usage && (inputTok || outputTok || usage.cacheRead !== undefined || usage.cacheWrite !== undefined));
  const usedPct = windowSize > 0 ? clampPercent((inputTok / windowSize) * 100) : null;
  const remainingPct = usedPct == null ? null : clampPercent(100 - usedPct);
  const hit = cacheHitPercent(usage);
  const payload: StatusLinePayload = {
    cwd: input.cwd,
    session_id: input.sessionId,
    version: input.version ?? VERSION,
    model: {
      id: input.model,
      display_name: input.modelDisplayName?.trim() || input.model,
    },
    workspace: {
      current_dir: input.cwd,
      project_dir: input.workspaceProjectDir || input.cwd,
    },
    context_window: {
      total_input_tokens: inputTok,
      total_output_tokens: outputTok,
      context_window_size: windowSize,
      used_percentage: hasUsage || windowSize > 0 ? usedPct : null,
      remaining_percentage: hasUsage || windowSize > 0 ? remainingPct : null,
      current_usage: hasUsage
        ? {
            input_tokens: inputTok,
            output_tokens: outputTok,
            cache_creation_input_tokens: cacheWrite,
            cache_read_input_tokens: cacheRead,
          }
        : null,
    },
  };
  if (input.sessionName?.trim()) payload.session_name = input.sessionName.trim();
  if (input.effort && input.effort !== "auto") payload.effort = { level: input.effort };
  if (usage?.cacheRead !== undefined || usage?.cacheWrite !== undefined) {
    payload.prompt_cache = {
      hit_ratio: hit == null ? null : hit / 100,
      cache_read_tokens: usage.cacheRead,
      cache_write_tokens: usage.cacheWrite,
    };
  }
  const glue: NonNullable<StatusLinePayload["glue"]> = {};
  if (extra.goal?.trim()) glue.goal = extra.goal.trim();
  if (extra.shell !== undefined) glue.shell = extra.shell;
  if (extra.session?.trim()) glue.session = extra.session.trim();
  if (extra.hint?.trim()) glue.hint = extra.hint.trim();
  if (extra.branch?.trim()) glue.branch = extra.branch.trim();
  if (Object.keys(glue).length) payload.glue = glue;
  return payload;
}

export function expandStatusCommand(command: string, home: string): string {
  let next = command.replace(/%USERPROFILE%/gi, home);
  next = next.replace(/\$HOME/g, home);
  next = next.replace(/(^|[ \t"'=])~(?=$|[\\/])/g, `$1${home}`);
  return next;
}

export function runStatusLineCommand(
  command: string,
  payload: unknown,
  opts: {
    home: string;
    cwd?: string;
    columns?: number;
    lines?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  const expanded = expandStatusCommand(command.trim(), opts.home);
  if (!expanded) return Promise.resolve("");
  const timeoutMs = opts.timeoutMs ?? STATUSLINE_COMMAND_TIMEOUT_MS;
  const json = JSON.stringify(payload);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: opts.home,
    COLUMNS: String(Math.max(1, opts.columns ?? 80)),
    LINES: String(Math.max(1, opts.lines ?? 24)),
  };
  const launch = launchStatusCommand(expanded);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(launch.command, launch.args, {
        cwd: opts.cwd || opts.home,
        env,
        shell: launch.shell,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      finish("");
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish("");
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      finish("");
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.resume();
    child.on("error", () => {
      clearTimeout(timer);
      finish("");
    });
    child.on("close", () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      finish(stdout.replace(/\s+$/, ""));
    });
    try {
      child.stdin?.end(json, "utf8");
    } catch {
      /* stdin may already be closed */
    }
  });
}

/**
 * Statusline refresh to store. `undefined` means the visible rows did not
 * change, and the caller must not setState: a no-op repaint moves the cursor
 * and flickers IME preedit.
 */
export function statusLineFrame(previous: string, next: string, columns: number, padding = 0): string | undefined {
  const prevLines = formatStatusLineOutput(previous, columns, padding).join("\n");
  const nextLines = formatStatusLineOutput(next, columns, padding).join("\n");
  if (prevLines === nextLines) return undefined;
  return next;
}

export function formatStatusLineOutput(raw: string, columns: number, padding = 0): string[] {
  const width = Math.max(1, columns);
  const pad = Math.max(0, Math.min(width - 1, Math.floor(padding)));
  const prefix = " ".repeat(pad);
  const inner = Math.max(1, width - pad);
  const lines: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    if (lines.length >= STATUSLINE_MAX_LINES) break;
    const plain = stripAnsi(line).replace(/\t/g, " ");
    // Whitespace and color-only lines are not a status row. An empty command
    // (or a script that only emits SGR) must not reserve a strip under the input.
    if (!plain.trim()) continue;
    lines.push(prefix + clipWidth(plain, inner));
  }
  return lines.slice(0, STATUSLINE_MAX_LINES);
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}

export function normalizeStatusLine(value: unknown): StatusLineConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const command = typeof rec.command === "string" ? rec.command.trim() : "";
  if (!command) return null;
  const type = rec.type === "command" || rec.type === undefined ? "command" : null;
  if (!type) return null;
  const padding = typeof rec.padding === "number" && Number.isFinite(rec.padding) ? Math.max(0, Math.floor(rec.padding)) : 0;
  return {
    type: "command",
    command,
    padding,
    refreshInterval: normalizeRefreshInterval(rec.refreshInterval),
  };
}

export function normalizeRefreshInterval(value: unknown): number | null {
  if (value == null || value === false) return null;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function launchStatusCommand(command: string): { command: string; args: string[]; shell: boolean } {
  const trimmed = command.trim();
  const unquoted = stripOuterQuotes(trimmed);
  if (unquoted.startsWith("node ") || unquoted.startsWith(`"${process.execPath}"`) || unquoted.startsWith(process.execPath)) {
    return { command: trimmed, args: [], shell: true };
  }
  if (isScriptPath(unquoted) && existsSync(unquoted)) {
    const head = readFileSync(unquoted, "utf8").slice(0, 120);
    if (head.startsWith("#!/usr/bin/env node") || head.startsWith("#!") && head.includes("node") || unquoted.endsWith(".js")) {
      return { command: process.execPath, args: [unquoted], shell: false };
    }
  }
  return { command: trimmed, args: [], shell: true };
}

function isScriptPath(command: string): boolean {
  if (/\s/.test(command)) return false;
  return /(?:^|[\\/])[^\\/]+\.(?:sh|js|ps1|cmd)$/i.test(command) || command.includes(".glue");
}

function stripOuterQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function isClearRequest(raw: string): boolean {
  const folded = raw.toLowerCase().replace(/[!.]+$/g, "").trim();
  if (["clear", "delete", "remove", "off", "none", "unset", "清除", "删除", "移除", "关掉"].includes(folded)) return true;
  if (/^(clear|delete|remove|unset)\s+(it|the(\s+status([ -]?line)?)?)?$/.test(folded)) return true;
  if (/remove (the )?status([ -]?line)?/.test(folded)) return true;
  if (/delete (the )?status([ -]?line)?/.test(folded)) return true;
  if (/clear (the )?status([ -]?line)?/.test(folded)) return true;
  if (/关掉状态栏|删除状态栏|移除状态栏|清除状态栏|不要状态栏/.test(raw)) return true;
  return false;
}

function mentionsProgressBar(raw: string): boolean {
  return /progress\s*bar|进度条|进度|progress|bar\b|[▓░█]/.test(raw);
}

function fieldText(field: StatusField, ctx: StatusContext): string {
  switch (field) {
    case "hint":
      return ctx.hint?.trim() || "? for shortcuts";
    case "model":
      return ctx.model ? ctx.model : "";
    case "effort":
      return ctx.effort ? `effort ${ctx.effort}` : "";
    case "tokens": {
      const total = (ctx.usage?.input ?? 0) + (ctx.usage?.output ?? 0);
      return total > 0 ? `${formatTokens(total)} tok` : "";
    }
    case "context": {
      const window = ctx.contextWindow ?? 0;
      if (window <= 0) return "";
      const used = ctx.usage?.input ?? 0;
      const pct = clampPercent((used / window) * 100);
      return `ctx ${pct}%`;
    }
    case "contextSize": {
      const window = ctx.contextWindow ?? 0;
      return window > 0 ? `window ${formatTokens(window)}` : "";
    }
    case "cache": {
      const pct = cacheHitPercent(ctx.usage);
      return pct === undefined ? "" : `cache ${pct}%`;
    }
    case "cwd":
      return ctx.cwd ?? "";
    case "branch":
      return ctx.branch ? `⎇ ${ctx.branch}` : "";
    case "goal":
      return ctx.goal ? `目标 ${trim(ctx.goal, 24)}` : "";
    case "shell":
      return ctx.shell === undefined ? "" : ctx.shell ? "shell on" : "shell off";
    case "session":
      return ctx.session ? ctx.session : "";
    default:
      return "";
  }
}

function collectFields(raw: string): StatusField[] {
  const found = new Set<StatusField>();
  for (const { field, words } of ALIASES) {
    if (words.some((word) => containsWord(raw, word))) found.add(field);
  }
  if (mentionsContextPercent(raw)) found.add("context");
  if (mentionsContextSize(raw)) found.add("contextSize");
  if (mentionsCache(raw)) found.add("cache");
  for (const token of raw.split(/[,+/|]+/)) {
    const field = EXACT[token.trim().toLowerCase()];
    if (field) found.add(field);
  }
  return CANONICAL.filter((field) => found.has(field));
}

function mentionsContextPercent(raw: string): boolean {
  if (/上下文窗口占用百分比|上下文占用|占用百分比/.test(raw)) return true;
  if (/context(?:\s+window)?\s*(?:%|percent(?:age)?)|percent(?:age)?\s+of\s+(?:the\s+)?context|ctx\s*%/i.test(raw)) return true;
  if (hasExactToken(raw, "context")) return true;
  return /(?:^|[^a-z0-9_])context(?![a-z0-9_])(?!\s+(?:window\s+)?(?:size|length)\b)/i.test(raw);
}

function mentionsContextSize(raw: string): boolean {
  if (/上下文窗口有多少|窗口有多少|窗口大小|上下文长度/.test(raw)) return true;
  if (/context\s+window\s+size|context\s+size|context\s+length|window\s+size|how\s+(?:big|large)\s+(?:is\s+)?(?:the\s+)?context/i.test(raw)) {
    return true;
  }
  return hasExactToken(raw, "contextSize") || hasExactToken(raw, "context_size") || hasExactToken(raw, "context-size");
}

function mentionsCache(raw: string): boolean {
  if (/缓存命中率|缓存命中|命中率|缓存/.test(raw)) return true;
  return containsWord(raw, "cache") || containsWord(raw, "cache hit") || containsWord(raw, "cache hit rate");
}

function hasExactToken(raw: string, token: string): boolean {
  const want = token.toLowerCase();
  return raw.split(/[,+/|]+/).some((part) => part.trim().toLowerCase() === want);
}

function containsWord(haystack: string, word: string): boolean {
  if (!word) return false;
  const lowerHay = haystack.toLowerCase();
  const lowerWord = word.toLowerCase();
  let from = 0;
  while (from <= lowerHay.length) {
    const at = lowerHay.indexOf(lowerWord, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : lowerHay[at - 1] ?? "";
    const after = lowerHay[at + lowerWord.length] ?? "";
    if (!isNameChar(before) && !isNameChar(after)) return true;
    from = at + lowerWord.length;
  }
  return false;
}

function isNameChar(ch: string): boolean {
  return /[a-z0-9_]/i.test(ch);
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function trim(value: string, max: number): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function clipWidth(text: string, columns: number): string {
  if (displayWidth(text) <= columns) return text;
  if (columns <= 1) return "…";
  let out = "";
  let used = 0;
  for (const ch of [...text]) {
    const width = Math.max(1, displayWidth(ch));
    if (used + width > columns - 1) break;
    out += ch;
    used += width;
  }
  return `${out}…`;
}
