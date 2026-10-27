import type { TranscriptItem } from "../types.js";
import { tailText, visualLines, wrapLines } from "./text.js";

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

export interface SizeMemory {
  /** Last raw terminal rows we painted for. 0 means unset. */
  rows: number;
  columns: number;
  inkRows?: number;
  inkColumns?: number;
  procRows?: number;
  procColumns?: number;
}

/**
 * Pick a terminal size from Ink's stdout and process.stdout.
 * A source that just changed wins, so growing into fullscreen is not pinned by
 * a stale smaller report, and shrinking is not pinned by a stale larger one.
 * When both sources change in the same read, the smaller one wins so a paint
 * cannot run past the window. Values of 0 or 1 are ignored.
 */
export function reconcileSize(
  memory: SizeMemory,
  ink: { rows?: number; columns?: number },
  proc: { rows?: number; columns?: number },
): { rows: number; columns: number; memory: SizeMemory; resized: boolean } {
  const row = pickAxis(memory.rows, memory.inkRows, memory.procRows, ink.rows, proc.rows);
  const col = pickAxis(memory.columns, memory.inkColumns, memory.procColumns, ink.columns, proc.columns);
  const rows = row.value > 1 ? row.value : memory.rows;
  const columns = col.value > 1 ? col.value : memory.columns > 1 ? memory.columns : 80;
  const next: SizeMemory = {
    rows: rows > 1 ? rows : memory.rows,
    columns,
    inkRows: row.ink,
    inkColumns: col.ink,
    procRows: row.proc,
    procColumns: col.proc,
  };
  const resized = memory.rows > 1 && (row.changed || col.changed) && (next.rows !== memory.rows || next.columns !== memory.columns);
  return { rows: next.rows, columns: next.columns, memory: next, resized };
}

function pickAxis(
  current: number,
  rememberedInk: number | undefined,
  rememberedProc: number | undefined,
  ink: number | undefined,
  proc: number | undefined,
): { value: number; ink?: number; proc?: number; changed: boolean } {
  const inkU = usableDim(ink);
  const procU = usableDim(proc);
  const inkChanged = inkU !== undefined && inkU !== rememberedInk;
  const procChanged = procU !== undefined && procU !== rememberedProc;
  let value = current;
  if (inkChanged && procChanged) value = Math.min(inkU as number, procU as number);
  else if (inkChanged) value = inkU as number;
  else if (procChanged) value = procU as number;
  else if (!(current > 1)) {
    if (inkU !== undefined && procU !== undefined) value = Math.min(inkU, procU);
    else value = inkU ?? procU ?? current;
  }
  const changed = value > 1 && value !== current;
  return { value, ink: inkU ?? rememberedInk, proc: procU ?? rememberedProc, changed };
}

function usableDim(value: number | undefined): number | undefined {
  return typeof value === "number" && value > 1 ? value : undefined;
}

export function transcriptBudget(frame: number, extraLines: number): number {
  return Math.max(1, frame - 6 - Math.max(0, extraLines));
}

export function visibleTranscript(items: TranscriptItem[], scroll: number, columns: number, budget: number, expanded = false): TranscriptItem[] {
  const end = Math.max(0, items.length - Math.max(0, scroll));
  return fitTranscript(items.slice(0, end), Math.max(1, columns), Math.max(1, budget), expanded);
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
  if (item.type === "tool") {
    let lines = 1;
    if (item.summary) lines += visualLines(item.summary, columns);
    if (item.diff?.length) lines += Math.min(12, item.diff.length);
    if (expanded && item.detail) lines += Math.min(40, item.detail.split("\n").length);
    return lines;
  }
  return visualLines(item.text, Math.max(1, columns - (item.type === "user" ? 2 : 0)));
}

export interface TranscriptWindow {
  items: TranscriptItem[];
  total: number;
  /** 1-based first visible line. 0 when the transcript is empty. */
  from: number;
  to: number;
  offset: number;
}

/**
 * Line window over the transcript. `lineOffset` is how many lines are hidden
 * below the viewport (0 pins the latest line). The host scrollbar does not
 * track this; the returned range is the in-app position.
 */
export function windowTranscript(
  items: TranscriptItem[],
  lineOffset: number,
  columns: number,
  budget: number,
  expanded = false,
): TranscriptWindow {
  const width = Math.max(1, columns);
  const room = Math.max(1, budget);
  const costs = items.map((item) => itemLines(item, width, expanded));
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  const maxOffset = Math.max(0, total - room);
  const offset = Math.max(0, Math.min(Math.floor(lineOffset) || 0, maxOffset));
  const end = total - offset;
  const start = Math.max(0, end - room);
  const out: TranscriptItem[] = [];
  let cursor = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const cost = costs[i] ?? 0;
    if (!item) continue;
    const itemStart = cursor;
    const itemEnd = cursor + cost;
    cursor = itemEnd;
    if (itemEnd <= start || itemStart >= end) continue;
    const localStart = Math.max(0, start - itemStart);
    const localCount = Math.min(cost, end - itemStart) - localStart;
    out.push(sliceItem(item, localStart, localCount, width, expanded));
  }
  return {
    items: out,
    total,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : end,
    offset,
  };
}

export function transcriptLineCount(items: TranscriptItem[], columns: number, expanded = false): number {
  return items.reduce((sum, item) => sum + itemLines(item, Math.max(1, columns), expanded), 0);
}

/** Empty when the whole transcript fits. Does not mention the host scrollbar. */
export function scrollLabel(total: number, from: number, to: number): string {
  if (total <= 0 || to <= 0 || to - from + 1 >= total) return "";
  return `▴ ${from}–${to}/${total}  ·  滚轮或 PgUp 看更早 · PgDn 到底`;
}

function sliceItem(item: TranscriptItem, localStart: number, count: number, columns: number, expanded: boolean): TranscriptItem {
  if (count <= 0) return item;
  if (item.type === "tool") {
    const full = itemLines(item, columns, expanded);
    if (localStart === 0 && count >= full) return item;
    return { ...item, diff: undefined, detail: undefined, summary: item.summary ? headLines(item.summary, Math.max(1, count - 1), columns) : item.summary };
  }
  const textWidth = Math.max(1, columns - (item.type === "user" ? 2 : 0));
  const lines = wrapLines(item.text, textWidth);
  return { ...item, text: lines.slice(localStart, localStart + count).join("\n") };
}

function headLines(text: string, maxLines: number, columns: number): string {
  const lines = wrapLines(text, columns);
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n");
}

function clipItem(item: TranscriptItem, budget: number, columns: number): TranscriptItem {
  if (item.type === "tool") {
    const summary = item.summary ? tailText(item.summary, Math.max(1, budget - 1), columns) : item.summary;
    return { ...item, summary, diff: undefined, detail: undefined };
  }
  return { ...item, text: tailText(item.text, budget, columns) };
}

