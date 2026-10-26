import type { PermissionMode, PermissionRules } from "./types.js";
import { globMatch } from "./glob.js";

export type PermissionDecision = "allow" | "deny" | "ask";

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

export function normalizeMode(value: string | undefined, fallback: PermissionMode = "default"): PermissionMode {
  if (!value) return fallback;
  const table: Record<string, PermissionMode> = {
    default: "default",
    manual: "default",
    acceptedits: "acceptEdits",
    "accept-edits": "acceptEdits",
    plan: "plan",
    dontask: "dontAsk",
    "dont-ask": "dontAsk",
    bypass: "bypassPermissions",
    bypasspermissions: "bypassPermissions",
    "bypass-permissions": "bypassPermissions",
  };
  const found = table[value.trim().toLowerCase()];
  if (!found) {
    throw new Error(
      `Unknown permission mode "${value}". Use default, acceptEdits, plan, dontAsk, or bypassPermissions.`,
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
    case "dontAsk":
      return "⏵⏵ don't ask on";
    case "bypassPermissions":
      return "⏵⏵ bypass permissions on";
  }
}

export function cycleModes(includeBypass: boolean): PermissionMode[] {
  const modes: PermissionMode[] = ["default", "acceptEdits", "plan"];
  if (includeBypass) modes.push("bypassPermissions");
  return modes;
}

export function nextMode(current: PermissionMode, includeBypass: boolean): PermissionMode {
  const modes = cycleModes(includeBypass);
  const idx = modes.indexOf(current);
  if (idx === -1) return modes[0] ?? "default";
  return modes[(idx + 1) % modes.length] ?? "default";
}

export function decidePermission(query: PermissionQuery): PermissionDecision {
  const mutating = isMutating(query.tool, query.command);
  if (query.tool === "run_shell" && query.shellEnabled === false) return "deny";
  if (query.protectedPath || query.outside) return "deny";
  if (ruleHit(query.rules.deny, query)) return "deny";
  if (query.readOnly && mutating) return "deny";
  if (query.mode === "plan" && mutating && !isReadOnlyBash(query.command)) return "deny";
  if (query.mode === "bypassPermissions") return "allow";
  if (ruleHit(query.rules.ask, query)) return "ask";
  if (ruleHit(query.rules.allow, query)) return "allow";
  if (query.tool === "run_shell" && isReadOnlyBash(query.command)) return "allow";
  if (query.mode === "acceptEdits" && query.tool === "run_shell" && isAcceptFs(query.command)) return "allow";
  if (!mutating) return "allow";
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
