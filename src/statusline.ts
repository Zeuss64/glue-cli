import type { TokenUsage } from "./types.js";

export const STATUS_FIELDS = ["hint", "model", "effort", "tokens", "cwd", "branch", "goal", "shell", "session"] as const;

export type StatusField = (typeof STATUS_FIELDS)[number];

/** What the footer already showed: shortcuts, effort, tokens. Mode stays on the right. */
export const DEFAULT_STATUS_FIELDS: readonly StatusField[] = ["hint", "effort", "tokens"];

/** A fuller row for `/statusline 设计` or `/statusline designed`. */
export const DESIGNED_STATUS_FIELDS: readonly StatusField[] = ["hint", "model", "effort", "tokens", "goal"];

const ALIASES: Array<{ field: StatusField; words: string[] }> = [
  { field: "hint", words: ["hint", "shortcuts", "shortcut", "快捷键", "提示"] },
  { field: "model", words: ["model", "模型"] },
  { field: "effort", words: ["effort", "档位", "力度"] },
  { field: "tokens", words: ["tokens", "token", "tok", "用量"] },
  { field: "cwd", words: ["cwd", "directory", "dir", "目录", "路径", "workspace"] },
  { field: "branch", words: ["branch", "分支"] },
  { field: "goal", words: ["goal", "目标"] },
  { field: "shell", words: ["shell", "终端"] },
  { field: "session", words: ["session", "会话"] },
];

export type StatuslineParse =
  | { kind: "show" }
  | { kind: "reset" }
  | { kind: "designed" }
  | { kind: "set"; fields: StatusField[] }
  | { kind: "invalid" };

export function parseStatuslineRequest(input: string): StatuslineParse {
  const raw = input.trim();
  if (!raw || raw === "status" || raw === "状态" || raw === "show") return { kind: "show" };
  const folded = raw.toLowerCase();
  if (["reset", "default", "defaults", "clear", "默认", "重置"].includes(folded)) return { kind: "reset" };
  if (["designed", "design", "smart", "推荐", "设计"].includes(folded)) return { kind: "designed" };

  const fields: StatusField[] = [];
  const seen = new Set<StatusField>();
  for (const { field, words } of ALIASES) {
    if (words.some((word) => containsWord(raw, word))) {
      if (!seen.has(field)) {
        seen.add(field);
        fields.push(field);
      }
    }
  }
  if (!fields.length) return { kind: "invalid" };
  return { kind: "set", fields };
}

export function parseStatuslineSpec(spec: string | undefined): StatusField[] {
  if (!spec?.trim()) return [...DEFAULT_STATUS_FIELDS];
  const parsed = parseStatuslineRequest(spec);
  if (parsed.kind === "set") return parsed.fields;
  if (parsed.kind === "designed") return [...DESIGNED_STATUS_FIELDS];
  if (parsed.kind === "reset" || parsed.kind === "show") return [...DEFAULT_STATUS_FIELDS];
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
}

export function formatStatusLeft(fields: readonly StatusField[], ctx: StatusContext): string {
  const parts: string[] = [];
  for (const field of fields) {
    const text = fieldText(field, ctx);
    if (text) parts.push(text);
  }
  return parts.join(" · ");
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

function trim(value: string, max: number): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
