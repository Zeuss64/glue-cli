import type { TranscriptItem } from "../types.js";
import { sliceVisual, tailText, visualLines } from "./text.js";

/**
 * Ink calls `clearTerminal` (erase screen + erase scrollback, CSI 3J) whenever
 * the frame is at least `stdout.rows` tall, and it does that on every token.
 * Classic Windows cmd freezes under that repaint, and the prompt is what
 * scrolls off the bottom. Stay one row short so Ink keeps using line erase.
 * The alternate screen is left off: conhost's alt buffer plus CSI 3J is the
 * same failure, and a shorter frame already keeps the prompt on screen.
 */
export interface ReportedSize {
  rows?: number;
  columns?: number;
}

export function smallestRows(...values: Array<number | undefined>): number | undefined {
  return smallestAboveOne(values);
}

export function smallestCols(...values: Array<number | undefined>): number | undefined {
  return smallestAboveOne(values);
}

/**
 * Visible frame for both a dragged window and a fullscreen console.
 * Reports of 0 or 1 are ignored (they show up mid-toggle). When reports
 * disagree, the smaller one is the window that is actually on screen, so a
 * leftover fullscreen size cannot paint past the resized window.
 */
export function frameSize(reports: ReportedSize[]): { rows: number; columns: number } {
  const rows = smallestRows(...reports.map((report) => report.rows));
  const columns = smallestCols(...reports.map((report) => report.columns));
  return { rows: frameRows(rows), columns: columns ?? 80 };
}

function smallestAboveOne(values: Array<number | undefined>): number | undefined {
  const usable = values.filter((value): value is number => typeof value === "number" && value > 1);
  if (!usable.length) return undefined;
  return Math.min(...usable);
}

export function frameRows(reported: number | undefined): number {
  const rows = reported && reported > 1 ? reported : 24;
  return rows - 1;
}

export function transcriptBudget(frame: number, extraLines: number): number {
  return Math.max(1, frame - 6 - Math.max(0, extraLines));
}

/** Lines moved by one mouse-wheel notch. Page Up and Page Down move a screen. */
export const WHEEL_LINES = 3;

export function pageLines(budget: number): number {
  return Math.max(1, budget - 1);
}

/**
 * `scroll` counts visual lines hidden below the window. 0 stays pinned to the
 * latest line. Positive values move toward older lines.
 */
export function moveScroll(scroll: number, delta: number, total: number, budget: number): number {
  const room = Math.max(1, budget);
  const max = Math.max(0, total - room);
  const next = (Number.isFinite(scroll) ? scroll : 0) + delta;
  return Math.max(0, Math.min(max, next));
}

export function scrollHint(above: number, below: number): string {
  if (above > 0 && below > 0) return "… wheel or pgup for earlier · pgdn for latest";
  if (above > 0) return "… wheel or pgup for earlier";
  if (below > 0) return "… pgdn for latest";
  return "";
}

export interface TranscriptWindow {
  items: TranscriptItem[];
  /** Visual lines above the window. */
  above: number;
  /** Visual lines hidden below the window. 0 means the latest line is on screen. */
  below: number;
  total: number;
}

export function transcriptLineCount(items: TranscriptItem[], columns: number, expanded = false): number {
  const width = Math.max(1, columns);
  let total = 0;
  for (const item of items) total += itemLines(item, width, expanded);
  return total;
}

/**
 * The painted transcript window. `scroll` is visual lines above the bottom,
 * so 0 follows the tail and a larger value reaches older lines, including the
 * start of a long reply. Only this window is returned; the full history stays
 * out of the Ink tree.
 */
export function transcriptWindow(
  items: TranscriptItem[],
  scroll: number,
  columns: number,
  budget: number,
  expanded = false,
): TranscriptWindow {
  const width = Math.max(1, columns);
  const room = Math.max(1, budget);
  const spans = items.map((item) => ({ item, lines: itemLines(item, width, expanded) }));
  const total = spans.reduce((sum, span) => sum + span.lines, 0);
  const below = moveScroll(scroll, 0, total, room);
  const end = total - below;
  const start = Math.max(0, end - room);
  const visible: TranscriptItem[] = [];
  let cursor = 0;
  for (const span of spans) {
    const spanStart = cursor;
    const spanEnd = cursor + span.lines;
    cursor = spanEnd;
    const from = Math.max(spanStart, start);
    const to = Math.min(spanEnd, end);
    if (from >= to) continue;
    const rel = from - spanStart;
    const count = to - from;
    visible.push(rel === 0 && count >= span.lines ? span.item : projectItem(span.item, width, expanded, rel, count));
  }
  return { items: visible, above: start, below, total };
}

export function visibleTranscript(items: TranscriptItem[], scroll: number, columns: number, budget: number, expanded = false): TranscriptItem[] {
  return transcriptWindow(items, scroll, columns, budget, expanded).items;
}

export function fitTranscript(items: TranscriptItem[], columns: number, budget: number, expanded = false): TranscriptItem[] {
  const kept: TranscriptItem[] = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) continue;
    const cost = itemLines(item, columns, expanded);
    if (kept.length > 0 && used + cost > budget) break;
    if (kept.length === 0 && cost > budget) {
      kept.push(clipItem(item, budget, columns));
      break;
    }
    kept.push(item);
    used += cost;
  }
  return kept.reverse();
}

function itemLines(item: TranscriptItem, columns: number, expanded: boolean): number {
  if (item.type === "tool") return toolPlan(item, columns, expanded).total;
  const textCols = Math.max(1, columns - (item.type === "user" ? 2 : 0));
  let lines = visualLines(item.text, textCols);
  if (item.type === "user") {
    lines += 1;
    if (item.attached?.length) lines += 1;
  }
  return lines;
}

function toolPlan(item: Extract<TranscriptItem, { type: "tool" }>, columns: number, expanded: boolean): {
  summaryLines: number;
  diffCount: number;
  detailCount: number;
  total: number;
} {
  const summaryLines = item.summary ? visualLines(item.summary, columns) : 0;
  const diffCount = Math.min(12, item.diff?.length ?? 0);
  const detailCount = expanded && item.detail ? Math.min(40, item.detail.split("\n").length) : 0;
  return { summaryLines, diffCount, detailCount, total: 1 + summaryLines + diffCount + detailCount };
}

function projectItem(item: TranscriptItem, columns: number, expanded: boolean, rel: number, count: number): TranscriptItem {
  if (item.type === "tool") return projectTool(item, columns, expanded, rel, count);
  return projectText(item, columns, rel, count);
}

function projectText(item: Exclude<TranscriptItem, { type: "tool" }>, columns: number, rel: number, count: number): TranscriptItem {
  const textCols = Math.max(1, columns - (item.type === "user" ? 2 : 0));
  const margin = item.type === "user" ? 1 : 0;
  const textLines = visualLines(item.text, textCols);
  const textStart = margin;
  const textEnd = margin + textLines;
  const from = Math.max(rel, textStart);
  const to = Math.min(rel + count, textEnd);
  const text = to > from ? sliceVisual(item.text, textCols, from - textStart, to - from) : "";
  if (item.type !== "user") return { ...item, text };
  const attachedAt = textEnd;
  const showAttached = Boolean(item.attached?.length) && rel <= attachedAt && rel + count > attachedAt;
  return { ...item, text, attached: showAttached ? item.attached : undefined, gap: rel === 0 };
}

function projectTool(
  item: Extract<TranscriptItem, { type: "tool" }>,
  columns: number,
  expanded: boolean,
  rel: number,
  count: number,
): TranscriptItem {
  const plan = toolPlan(item, columns, expanded);
  const slots: number[] = [];
  for (let index = rel; index < rel + count && index < plan.total; index += 1) slots.push(index);
  const summaryFrom = 1;
  const summaryTo = summaryFrom + plan.summaryLines;
  const diffFrom = summaryTo;
  const diffTo = diffFrom + plan.diffCount;
  const detailFrom = diffTo;
  const summaryIdx = slots.filter((slot) => slot >= summaryFrom && slot < summaryTo).map((slot) => slot - summaryFrom);
  const diffIdx = slots.filter((slot) => slot >= diffFrom && slot < diffTo).map((slot) => slot - diffFrom);
  const detailIdx = slots.filter((slot) => slot >= detailFrom).map((slot) => slot - detailFrom);
  const summary =
    item.summary && summaryIdx.length
      ? sliceVisual(item.summary, columns, summaryIdx[0] ?? 0, (summaryIdx[summaryIdx.length - 1] ?? 0) + 1 - (summaryIdx[0] ?? 0))
      : undefined;
  const diff = item.diff && diffIdx.length ? item.diff.slice(diffIdx[0] ?? 0, (diffIdx[diffIdx.length - 1] ?? 0) + 1) : undefined;
  const detail =
    item.detail && detailIdx.length
      ? item.detail
          .split("\n")
          .slice(0, 40)
          .slice(detailIdx[0] ?? 0, (detailIdx[detailIdx.length - 1] ?? 0) + 1)
          .join("\n")
      : undefined;
  return { ...item, summary, diff, detail, showHeader: slots.includes(0) };
}

function clipItem(item: TranscriptItem, budget: number, columns: number): TranscriptItem {
  if (item.type === "tool") {
    const summary = item.summary ? tailText(item.summary, Math.max(1, budget - 1), columns) : item.summary;
    return { ...item, summary, diff: undefined, detail: undefined };
  }
  return { ...item, text: tailText(item.text, budget, columns) };
}

