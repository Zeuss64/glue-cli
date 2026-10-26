import type { TranscriptItem } from "../types.js";
import { tailText, visualLines } from "./text.js";

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

function clipItem(item: TranscriptItem, budget: number, columns: number): TranscriptItem {
  if (item.type === "tool") {
    const summary = item.summary ? tailText(item.summary, Math.max(1, budget - 1), columns) : item.summary;
    return { ...item, summary, diff: undefined, detail: undefined };
  }
  return { ...item, text: tailText(item.text, budget, columns) };
}

