import type { PermissionMode, PermissionRules } from "./types.js";
import { globMatch } from "./glob.js";

export type PermissionDecision = "allow" | "deny" | "ask";

/** `manual` asks before mutations. `auto` allows low-risk work and still asks when the risk is high. */
export type ApprovalMode = "manual" | "auto";

export interface PermissionQuery {
  tool: string;
  mode: PermissionMode;
  rules: PermissionRules;
  /** Workspace-relative path, when the tool touches one file or directory. */
  relPath?: string;
  command?: string;
  outside?: boolean;
  protectedPath?: boolean;
  shellEnabled?: boolean;
  /** Review turns and plan mode both refuse mutations. */
  readOnly?: boolean;
  /** Omitted means manual, the historical default. */
  approval?: ApprovalMode;
}

const TOOL_ALIASES: Record<string, string[]> = {
  read_file: ["read_file", "read"],
  write_file: ["write_file", "write"],
  edit_file: ["edit_file", "edit"],
  list_dir: ["list_dir", "ls", "listdir"],
  glob: ["glob"],
  grep: ["grep"],
  run_shell: ["run_shell", "bash", "shell"],
  todo_write: ["todo_write", "todowrite", "todo"],
  ask_user: ["ask_user", "askuserquestion", "ask"],
  enter_plan_mode: ["enter_plan_mode", "enterplanmode"],
  exit_plan_mode: ["exit_plan_mode", "exitplanmode"],
};

const READ_ONLY_BASH = [
  "ls",
  "pwd",
  "whoami",
  "git status",
  "git diff",
  "git log",
  "git show",
  "git blame",
  "wc",
  "head",
  "tail",
  "cat",
  "nl",
  "stat",
  "file",
  "tree",
  "rg",
  "grep",
];

const ACCEPT_FS = ["mkdir", "touch", "cp", "mv"];

export function emptyRules(): PermissionRules {
  return { allow: [], deny: [], ask: [] };
}

const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "yolo",
  "dontAsk",
  "bypassPermissions",
];

export function isPermissionMode(value: string | undefined): value is PermissionMode {
  return value !== undefined && (PERMISSION_MODES as readonly string[]).includes(value);
}

export function normalizeMode(value: string | undefined, fallback: PermissionMode = "default"): PermissionMode {
  if (!value) return fallback;
  const table: Record<string, PermissionMode> = {
    default: "default",
    manual: "default",
    accept: "acceptEdits",
    acceptedits: "acceptEdits",
    "accept-edits": "acceptEdits",
    plan: "plan",
    auto: "auto",
    yolo: "yolo",
    dontask: "dontAsk",
    "dont-ask": "dontAsk",
    bypass: "bypassPermissions",
    bypasspermissions: "bypassPermissions",
    "bypass-permissions": "bypassPermissions",
  };
  const found = table[value.trim().toLowerCase()];
  if (!found) {
    throw new Error(
      `Unknown permission mode "${value}". Use default, acceptEdits, plan, auto, yolo, dontAsk, or bypassPermissions.`,
    );
  }
  return found;
}

export function modeLabel(mode: PermissionMode): string {
  switch (mode) {
    case "default":
      return "⏸ manual mode on";
    case "acceptEdits":
      return "⏵⏵ accept edits on";
    case "plan":
      return "⏸ plan mode on";
    case "auto":
      return "⏵⏵ auto mode on";
    case "yolo":
      return "⏵⏵ YOLO mode on";
    case "dontAsk":
      return "⏵⏵ don't ask on";
    case "bypassPermissions":
      return "⏵⏵ bypass permissions on";
  }
}

export function normalizeApproval(value: string | undefined | null): ApprovalMode | undefined {
  if (!value?.trim()) return undefined;
  const name = value.trim().toLowerCase();
  if (["auto", "on", "1", "true", "yes", "自动"].includes(name)) return "auto";
  if (["manual", "off", "0", "false", "no", "default", "手动"].includes(name)) return "manual";
  return undefined;
}

/** True when low-risk work is auto-approved. Mode `auto`, or manual mode with the /auto overlay. */
export function autoEngaged(mode: PermissionMode, approval: ApprovalMode = "manual"): boolean {
  return mode === "auto" || (mode === "default" && approval === "auto");
}

/** Footer badge. The /auto overlay still reads as auto while the stored mode is manual. */
export function footerModeLabel(mode: PermissionMode, approval: ApprovalMode = "manual"): string {
  if (autoEngaged(mode, approval)) return modeLabel("auto");
  return modeLabel(mode);
}

/**
 * High-risk work still asks in auto mode.
 * Outside the workspace and protected paths are also high risk; callers that
 * already deny those keep denying them.
 */
export function isHighRisk(query: {
  tool: string;
  command?: string;
  outside?: boolean;
  protectedPath?: boolean;
}): boolean {
  if (query.outside || query.protectedPath) return true;
  if (query.tool === "run_shell") return commandIsHighRisk(query.command ?? "");
  return false;
}

export function commandIsHighRisk(command: string): boolean {
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("../") || normalized.includes("..\\")) return true;
  const parts = normalized
    .split(/\s*(?:&&|\|\||[;&|])\s*|\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts.length ? parts : [normalized]).some(segmentIsHighRisk);
}

const HIGH_RISK: RegExp[] = [
  /(^|\s)rm\b/,
  /(^|\s)rmdir\b/,
  /(^|\s)del\b/,
  /(^|\s)erase\b/,
  /\bremove-item\b/,
  /^format\b/,
  /^diskpart\b/,
  /^mkfs\b/,
  /^dd\b/,
  /\b(shutdown|reboot|poweroff)\b/,
  /\b(sudo|doas|pkexec|runas|gsudo)\b/,
  /\b(chmod|chown|icacls|takeown)\b/,
  /\b(curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod|certutil|bitsadmin)\b/,
  /\b(ssh|scp|sftp|ftp|ncat|socat)\b/,
  /(^|\s)nc\b/,
  /\bnpx\b/,
  /\bpnpm\s+dlx\b/,
  /\bbunx\b/,
  /\bnpm\s+(install|i|add|ci|update|uninstall|un)\b/,
  /\bpnpm\s+(install|i|add|update|remove)\b/,
  /\byarn\s+(install|add|remove|upgrade)\b/,
  /\bbun\s+(install|add|remove|update)\b/,
  /\bpip3?\s+install\b/,
  /\bconda\s+install\b/,
  /\bcargo\s+install\b/,
  /\bgo\s+install\b/,
  /\bgem\s+install\b/,
  /\bapt(-get)?\s+install\b/,
  /\b(brew|choco|scoop|winget)\s+install\b/,
  /\b(pacman|yum|dnf)\b/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+clean\b/,
  /\b(kill|pkill|taskkill)\b/,
  /\breg\s+delete\b/,
  /\bcipher\b/,
  /:\(\)\s*\{/,
];

function segmentIsHighRisk(segment: string): boolean {
  return HIGH_RISK.some((pattern) => pattern.test(segment));
}

/**
 * Shift+Tab order. A new session starts at manual (`default`), not at plan.
 * `dontAsk` and `bypassPermissions` stay settable, and Shift+Tab from either enters at plan.
 */
export const SHIFT_TAB_MODES: readonly PermissionMode[] = ["plan", "default", "acceptEdits", "auto", "yolo"];

export interface PermissionCycleState {
  mode: PermissionMode;
  approval: ApprovalMode;
}

export function cycleModes(): readonly PermissionMode[] {
  return SHIFT_TAB_MODES;
}

/** Slot in the Shift+Tab cycle. Manual with the /auto overlay shares the auto slot. */
export function cycleSlot(mode: PermissionMode, approval: ApprovalMode = "manual"): PermissionMode | undefined {
  if (autoEngaged(mode, approval)) return "auto";
  if (mode === "plan" || mode === "default" || mode === "acceptEdits" || mode === "yolo") return mode;
  return undefined;
}

export function nextPermissionState(current: PermissionMode, approval: ApprovalMode = "manual"): PermissionCycleState {
  const slot = cycleSlot(current, approval);
  const idx = slot ? SHIFT_TAB_MODES.indexOf(slot) : -1;
  const mode = SHIFT_TAB_MODES[(idx + 1) % SHIFT_TAB_MODES.length] ?? "default";
  return { mode, approval: mode === "auto" ? "auto" : "manual" };
}

export function nextMode(current: PermissionMode, approval: ApprovalMode = "manual"): PermissionMode {
  return nextPermissionState(current, approval).mode;
}

export function decidePermission(query: PermissionQuery): PermissionDecision {
  const mutating = isMutating(query.tool, query.command);
  if (query.tool === "run_shell" && query.shellEnabled === false) return "deny";
  if (query.protectedPath || query.outside) return "deny";
  if (ruleHit(query.rules.deny, query)) return "deny";
  if (query.readOnly && mutating) return "deny";
  if (query.mode === "plan" && mutating && !isReadOnlyBash(query.command)) return "deny";
  if (query.mode === "bypassPermissions" || query.mode === "yolo") return "allow";
  if (ruleHit(query.rules.ask, query)) return "ask";
  if (ruleHit(query.rules.allow, query)) return "allow";
  if (query.tool === "run_shell" && isReadOnlyBash(query.command)) return "allow";
  if (query.mode === "acceptEdits" && query.tool === "run_shell" && isAcceptFs(query.command)) return "allow";
  if (!mutating) return "allow";
  if (autoEngaged(query.mode, query.approval ?? "manual")) {
    if (isHighRisk(query)) return "ask";
    return "allow";
  }
  if (query.mode === "acceptEdits" && (query.tool === "edit_file" || query.tool === "write_file")) return "allow";
  if (query.mode === "dontAsk" || query.mode === "plan") return "deny";
  return "ask";
}

export function isMutating(tool: string, command?: string): boolean {
  if (tool === "edit_file" || tool === "write_file") return true;
  if (tool === "run_shell") return !isReadOnlyBash(command);
  return false;
}

export function isReadOnlyBash(command: string | undefined): boolean {
  if (!command) return false;
  const cmd = command.trim().replace(/\s+/g, " ");
  return READ_ONLY_BASH.some((entry) => cmd === entry || cmd.startsWith(entry + " "));
}

function isAcceptFs(command: string | undefined): boolean {
  if (!command) return false;
  const cmd = command.trim().replace(/\s+/g, " ");
  return ACCEPT_FS.some((entry) => cmd === entry || cmd.startsWith(entry + " "));
}

export function parseRule(rule: string): { tool: string; spec?: string } | null {
  const trimmed = rule.trim();
  if (!trimmed) return null;
  const match = /^([A-Za-z0-9_]+)\s*(?:\((.*)\))?$/.exec(trimmed);
  if (!match?.[1]) return null;
  const spec = match[2];
  return spec === undefined ? { tool: match[1] } : { tool: match[1], spec };
}

export function ruleMatches(rule: string, tool: string, relPath?: string, command?: string): boolean {
  const parsed = parseRule(rule);
  if (!parsed) return false;
  if (!toolNamesMatch(parsed.tool, tool)) return false;
  if (parsed.spec === undefined || parsed.spec === "" || parsed.spec === "*") return true;
  if (tool === "run_shell") return matchCommand(parsed.spec, command ?? "");
  if (relPath) return matchPath(parsed.spec, relPath);
  return false;
}

export function matchCommand(pattern: string, command: string): boolean {
  const cmd = command.trim().replace(/\s+/g, " ");
  const pat = pattern.trim().replace(/\s+/g, " ");
  if (!pat) return false;
  if (pat.endsWith(" *")) {
    const prefix = pat.slice(0, -2);
    return cmd === prefix || cmd.startsWith(prefix + " ");
  }
  if (pat.includes("*")) {
    const re = new RegExp("^" + pat.split("*").map(escapeReg).join(".*") + "$");
    return re.test(cmd);
  }
  return cmd === pat;
}

export function matchPath(pattern: string, relPath: string): boolean {
  const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const pat = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (pat === rel) return true;
  return globMatch(pat, rel);
}

/** Session "don't ask again" rule. Two leading tokens, then any arguments. */
export function bashAllowRule(command: string): string {
  const parts = command.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length <= 1) return `Bash(${parts[0] ?? command.trim()})`;
  return `Bash(${parts.slice(0, 2).join(" ")} *)`;
}

function ruleHit(rules: string[], query: PermissionQuery): boolean {
  return rules.some((rule) => ruleMatches(rule, query.tool, query.relPath, query.command));
}

function toolNamesMatch(ruleTool: string, internal: string): boolean {
  const aliases = TOOL_ALIASES[internal] ?? [internal.toLowerCase()];
  return aliases.includes(ruleTool.toLowerCase());
}

function escapeReg(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
