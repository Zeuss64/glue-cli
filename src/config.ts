import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { resolveProtocol, type ApiProtocol } from "./llm/protocol.js";
import { emptyRules, normalizeMode } from "./permissions.js";
import type { PermissionMode, PermissionRules } from "./types.js";

export interface AppConfig {
  model: string;
  baseURL: string;
  protocol: ApiProtocol;
  apiKey?: string;
  apiKeySource?: string;
  permissionMode: PermissionMode;
  profile: string;
  shellEnabled: boolean;
  maxSteps: number;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  contextWindow: number;
  headers: Record<string, string>;
  permissions: PermissionRules;
  theme: "dark" | "light" | "ansi";
  editor: "normal" | "vim";
  outputStyle: "normal" | "concise";
  configPath?: string;
  workspace: string;
}

export interface ConfigInput {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  baseURL?: string;
  protocol?: string;
  permissionMode?: string;
  profile?: string;
  configPath?: string;
  allowedTools?: string[];
  shellEnabled?: boolean;
  /** Home used for `~/.glue/config.toml`. Defaults to `os.homedir()`. */
  home?: string;
}

const DEFAULTS = {
  model: "gpt-4o-mini",
  baseURL: "https://api.openai.com/v1",
  permissionMode: "default" as PermissionMode,
  profile: "default",
  maxSteps: 24,
  temperature: 0.2,
  maxTokens: 8192,
  contextWindow: 128_000,
};

export function loadConfig(input: ConfigInput = {}): AppConfig {
  const env = input.env ?? process.env;
  const workspace = path.resolve(input.cwd ?? process.cwd());
  const file = readProjectConfig(workspace, input.configPath);
  const user = readOptional(globalConfigPath(input.home ?? homedir()));
  const merged = { ...user.values, ...file.values };

  const model =
    input.model || env.GLUE_MODEL || env.AGENT_MODEL || env.OPENAI_MODEL || str(merged, "model") || DEFAULTS.model;
  const baseURL = stripSlash(
    input.baseURL ||
      env.GLUE_BASE_URL ||
      env.AGENT_BASE_URL ||
      env.OPENAI_BASE_URL ||
      str(merged, "base_url", "baseURL") ||
      DEFAULTS.baseURL,
  );
  const protocol = resolveProtocol(
    input.protocol || env.GLUE_PROTOCOL || env.AGENT_PROTOCOL || str(merged, "protocol", "api_protocol"),
    baseURL,
  );
  const key = resolveKey(env, merged);
  const modeRaw =
    input.permissionMode ||
    env.GLUE_PERMISSION_MODE ||
    env.AGENT_PERMISSION_MODE ||
    str(merged, "permission_mode", "permissionMode") ||
    DEFAULTS.permissionMode;
  const permissions = readRules(merged);
  for (const rule of input.allowedTools ?? []) permissions.allow.push(rule);
  for (const entry of asStrings(pick(merged, "shell_allow", "shellAllow"))) {
    permissions.allow.push(entry.includes("(") ? entry : `Bash(${entry} *)`);
  }
  const shellBlock = asRecord(merged.shell);
  if (shellBlock) {
    for (const entry of asStrings(shellBlock.allow)) {
      permissions.allow.push(entry.includes("(") ? entry : `Bash(${entry} *)`);
    }
  }

  const shellEnabled = coerceBool(
    input.shellEnabled ??
      env.GLUE_SHELL ??
      env.AGENT_SHELL ??
      firstDefined(shellBlock?.enabled, pick(merged, "shell_enabled", "shellEnabled")),
    false,
  );

  return {
    model,
    baseURL,
    protocol,
    apiKey: key?.value,
    apiKeySource: key?.source,
    permissionMode: normalizeMode(modeRaw),
    profile: input.profile || env.GLUE_PROFILE || env.AGENT_PROFILE || str(merged, "profile") || DEFAULTS.profile,
    shellEnabled,
    maxSteps: num(merged, "max_steps", "maxSteps", DEFAULTS.maxSteps),
    temperature: num(merged, "temperature", "temperature", DEFAULTS.temperature),
    maxTokens: num(merged, "max_tokens", "maxTokens", DEFAULTS.maxTokens),
    stream: coerceBool(pick(merged, "stream"), true),
    contextWindow: num(merged, "context_window", "contextWindow", DEFAULTS.contextWindow),
    headers: readHeaders(merged),
    permissions,
    theme: themeOf(str(merged, "theme")),
    editor: str(merged, "editor") === "vim" ? "vim" : "normal",
    outputStyle: str(merged, "output_style", "outputStyle") === "concise" ? "concise" : "normal",
    configPath: file.path,
    workspace,
  };
}

/** Path of the user-level config, `~/.glue/config.toml`. */
export function globalConfigPath(home = homedir()): string {
  return path.join(home, ".glue", "config.toml");
}

/** Stock user config. Defaults only — no API key, no environment overrides. */
export function defaultGlobalConfigToml(): string {
  return `# Glue user defaults. Project files and environment variables override this file.
# API keys are never stored here. Set GLUE_API_KEY, AGENT_API_KEY, or OPENAI_API_KEY.

model = "${DEFAULTS.model}"
base_url = "${DEFAULTS.baseURL}"
permission_mode = "${DEFAULTS.permissionMode}"
profile = "${DEFAULTS.profile}"

[shell]
enabled = false
`;
}

/**
 * Create the user config when it is missing.
 * An existing file is left untouched, including an empty one.
 */
export function ensureGlobalConfig(home = homedir()): { path: string; created: boolean } {
  const file = globalConfigPath(home);
  const text = defaultGlobalConfigToml();
  if (/^\s*(api_key|apiKey)\s*=/im.test(text)) {
    throw new Error("refusing to write an API key into the user config");
  }
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    writeFileSync(file, text, { encoding: "utf8", flag: "wx" });
    return { path: file, created: true };
  } catch (error) {
    if (isErrno(error, "EEXIST")) return { path: file, created: false };
    throw error;
  }
}

/** Create the user config at session start. A failure must not stop the session. */
export function ensureGlobalConfigForSession(home = homedir()): void {
  try {
    ensureGlobalConfig(home);
  } catch {
    /* a missing user config must not stop the session */
  }
}

export function redactKey(key: string | undefined): string {
  if (!key) return "missing";
  if (key.length <= 8) return "set";
  return `set (…${key.slice(-4)})`;
}

function readProjectConfig(workspace: string, explicit?: string): { path?: string; values: Record<string, unknown> } {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Config file not found: ${explicit}`);
    return { path: explicit, values: parseConfigFile(explicit) };
  }
  const candidates = [
    path.join(workspace, ".agent", "config.toml"),
    path.join(workspace, ".agent", "config.json"),
    path.join(workspace, "agent.config.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, values: parseConfigFile(candidate) };
  }
  return { values: {} };
}

function readOptional(file: string): { values: Record<string, unknown> } {
  if (!existsSync(file)) return { values: {} };
  return { values: parseConfigFile(file) };
}

function parseConfigFile(file: string): Record<string, unknown> {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".toml")) return asRecord(parseToml(text)) ?? {};
  return asRecord(JSON.parse(text)) ?? {};
}

function resolveKey(env: NodeJS.ProcessEnv, merged: Record<string, unknown>): { value: string; source: string } | undefined {
  if (env.GLUE_API_KEY) return { value: env.GLUE_API_KEY, source: "GLUE_API_KEY" };
  if (env.AGENT_API_KEY) return { value: env.AGENT_API_KEY, source: "AGENT_API_KEY" };
  if (env.OPENAI_API_KEY) return { value: env.OPENAI_API_KEY, source: "OPENAI_API_KEY" };
  const fromFile = str(merged, "api_key", "apiKey");
  if (fromFile) return { value: fromFile, source: "config file" };
  return undefined;
}

function readRules(merged: Record<string, unknown>): PermissionRules {
  const block = asRecord(merged.permissions) ?? {};
  return {
    allow: asStrings(block.allow),
    deny: asStrings(block.deny),
    ask: asStrings(block.ask),
  };
}

function readHeaders(merged: Record<string, unknown>): Record<string, string> {
  const block = asRecord(merged.headers) ?? {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(block)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function str(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  const value = pick(obj, ...keys);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(obj: Record<string, unknown>, a: string, b: string, fallback: number): number {
  const value = pick(obj, a, b);
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) if (value !== undefined) return value;
  return undefined;
}

function coerceBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(1|true|yes|on)$/i.test(value)) return true;
    if (/^(0|false|no|off)$/i.test(value)) return false;
  }
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function themeOf(value: string | undefined): AppConfig["theme"] {
  if (value === "light" || value === "ansi" || value === "dark") return value;
  return "dark";
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}

export { emptyRules };
