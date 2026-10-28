import { footerModeLabel, type ApprovalMode } from "../permissions.js";
import { cacheHitPercent } from "../statusline.js";
import type { PermissionMode, TokenUsage } from "../types.js";

export interface FooterInput {
  cwd?: string;
  model?: string;
  effort?: string;
  ultracode?: boolean;
  usage?: TokenUsage;
  contextWindow?: number;
  mode: PermissionMode;
  approval?: ApprovalMode;
}

export interface FooterFields {
  path: string;
  model: string;
  context: string;
  effort: string;
  tokens: string;
  ctx: string;
  cache: string;
  hint: string;
  mode: string;
}

/** Dense default footer, close to the public Claude Code status bar. */
export function footerFields(input: FooterInput): FooterFields {
  const model = input.model?.trim() || "model";
  const window = input.contextWindow ?? 0;
  const context = window > 0 ? `${formatContextSize(window)} context` : "context";
  const effort = input.effort?.trim() || "auto";
  const inputTokens = input.usage?.input ?? 0;
  const outputTokens = input.usage?.output ?? 0;
  const used = inputTokens;
  const pct = window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0;
  const ctx = window > 0 ? `${pct}% (${formatContextSize(used)}/${formatContextSize(window)})` : "-";
  const cachePct = cacheHitPercent(input.usage);
  const cache = cachePct === undefined ? "-" : `${cachePct}%`;
  const ultra = input.ultracode ? " · ultracode" : "";
  return {
    path: input.cwd?.trim() || "",
    model,
    context,
    effort,
    tokens: `${inputTokens}/${outputTokens}`,
    ctx,
    cache,
    hint: `◎ ${effort}${ultra} · /effort`,
    mode: footerModeLine(input.mode, input.approval ?? "manual"),
  };
}

export function footerModeLine(mode: PermissionMode, approval: ApprovalMode = "manual"): string {
  const label = footerModeLabel(mode, approval).replace(/^[^\p{L}\p{N}]+/u, "");
  return `▶ ${label} (shift+tab to cycle)`;
}

/** Auto stays on the yellow used by the manual/auto overlay. Other modes use their theme color. */
export function footerModeInk(mode: PermissionMode, approval: ApprovalMode, modeColor: string): string {
  if (mode === "auto" || (mode === "default" && approval === "auto")) return "yellow";
  return modeColor;
}

export interface StatusBarInput {
  mode: PermissionMode;
  approval?: ApprovalMode;
  hint?: string;
  shell?: boolean;
  session?: string;
  goal?: string;
}

export interface StatusBarPiece {
  text: string;
  tone: "mode" | "muted";
}

/** The built-in footer as one wrapping line. Segments keep their colors in the TUI. */
export function statusBarPieces(input: StatusBarInput): StatusBarPiece[] {
  const pieces: StatusBarPiece[] = [{ text: footerModeLine(input.mode, input.approval ?? "manual"), tone: "mode" }];
  if (input.hint) pieces.push({ text: ` · ${input.hint}`, tone: "muted" });
  if (input.shell) pieces.push({ text: " · shell on", tone: "muted" });
  if (input.session) pieces.push({ text: ` · ${input.session}`, tone: "muted" });
  if (input.goal) pieces.push({ text: ` · ${input.goal}`, tone: "muted" });
  return pieces;
}

export function statusBarLine(input: StatusBarInput): string {
  return statusBarPieces(input).map((piece) => piece.text).join("");
}

export function formatContextSize(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return Number.isInteger(thousands) ? `${thousands}K` : `${Math.round(thousands)}K`;
  }
  return String(Math.round(tokens));
}
