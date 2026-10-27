import type { TokenUsage } from "./types.js";

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

/** What the footer already showed: shortcuts, effort, tokens. Mode stays on the right. */
export const DEFAULT_STATUS_FIELDS: readonly StatusField[] = ["hint", "effort", "tokens"];

/** A fuller row for `/statusline 设计` or `/statusline designed`. */
export const DESIGNED_STATUS_FIELDS: readonly StatusField[] = ["hint", "model", "effort", "tokens", "goal"];

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

  const fields = collectFields(raw);
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
  /** Provider context window, in tokens. */
  contextWindow?: number;
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
      const used = (ctx.usage?.input ?? 0) + (ctx.usage?.output ?? 0);
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
