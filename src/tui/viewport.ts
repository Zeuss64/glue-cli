import { compactDiff } from "../diff.js";
import { displayName } from "../render/format.js";
import type { TranscriptItem } from "../types.js";
import { graphemeWidth, graphemes, tailText, visualLines } from "./text.js";

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

/** One column short of the frame so a full line cannot wrap again in the console. */
export function contentColumns(frameColumns: number): number {
  return Math.max(1, frameColumns - 1);
}

/** Lines the mouse wheel moves. Page Up and Page Down move by a page. */
export const WHEEL_LINES = 3;

export const HINT_EARLIER = "… pgup · wheel for earlier";
export const HINT_LATEST = "… pgdn for latest";
export const HINT_BOTH = "… pgup earlier · pgdn latest";

export type TranscriptTone = "accent" | "text" | "muted" | "bad" | "add" | "del";

export interface TranscriptPart {
  text: string;
  tone: TranscriptTone;
  bold?: boolean;
}

/** One painted transcript line. The TUI renders these and nothing above the window. */
export interface TranscriptRow {
  key: string;
  parts: TranscriptPart[];
}

export interface TranscriptLayout {
  rows: TranscriptRow[];
  /** Lines hidden below this window. 0 follows the latest line. */
  scroll: number;
  total: number;
  room: number;
  page: number;
  above: boolean;
  below: boolean;
}

export function rowText(row: TranscriptRow): string {
  return row.parts.map((part) => part.text).join("");
}

/**
 * Content lines that fit in `budget` once a scroll hint is reserved.
 * The hint is omitted when the whole transcript already fits.
 */
export function contentRoom(total: number, budget: number): number {
  const room = Math.max(1, budget);
  if (room >= 2 && total > room) return room - 1;
  return room;
}

export function clampScroll(scroll: number, total: number, room: number): number {
  const window = Math.max(1, room);
  const max = Math.max(0, total - window);
  const value = Number.isFinite(scroll) ? Math.trunc(scroll) : 0;
  return Math.min(max, Math.max(0, value));
}

/**
 * Keep the same lines on screen when the transcript grows while the user is
 * scrolled up. `prevTotal <= 0` only clamps, so the first paint stays put.
 */
export function retainScroll(scroll: number, prevTotal: number, total: number, room: number): number {
  if (scroll <= 0) return 0;
  if (prevTotal <= 0 || prevTotal === total) return clampScroll(scroll, total, room);
  return clampScroll(scroll + (total - prevTotal), total, room);
}

/**
 * Line window over the whole transcript. `scroll` is lines above the bottom.
 * The returned rows are at most `budget` high, so the paint cannot shove the
 * prompt off the window or erase the console scrollback.
 */
export function layoutTranscript(
  items: TranscriptItem[],
  columns: number,
  budget: number,
  scroll: number,
  expanded = false,
  prevTotal = 0,
): TranscriptLayout {
  const frame = Math.max(1, budget);
  const width = Math.max(1, columns);
  const all = buildTranscriptRows(items, width, expanded);
  const total = all.length;
  const room = contentRoom(total, frame);
  const adjusted = retainScroll(scroll, prevTotal, total, room);
  const end = total - adjusted;
  const start = Math.max(0, end - room);
  const above = start > 0;
  const below = end < total;
  const rows = all.slice(start, end);
  if (frame >= 2 && total > frame) {
    const text = above && below ? HINT_BOTH : below ? HINT_LATEST : HINT_EARLIER;
    rows.unshift({ key: "scroll-hint", parts: [{ text, tone: "muted" }] });
  }
  const page = Math.max(1, room > 1 ? room - 1 : room);
  return { rows, scroll: adjusted, total, room, page, above, below };
}

function buildTranscriptRows(items: TranscriptItem[], columns: number, expanded: boolean): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const item of items) appendItemRows(rows, item, columns, expanded);
  return rows;
}

function appendItemRows(rows: TranscriptRow[], item: TranscriptItem, columns: number, expanded: boolean): void {
  if (item.type === "user") {
    rows.push({ key: `${item.id}:gap`, parts: [{ text: " ", tone: "muted" }] });
    const tone: TranscriptTone = item.queued ? "muted" : "text";
    pushWrapped(rows, item.id, [{ text: item.queued ? "… " : "> ", tone: "accent" }, { text: item.text, tone }], columns);
    if (item.attached?.length) {
      pushWrapped(rows, `${item.id}:att`, [{ text: `  attached ${item.attached.join(", ")}`, tone: "muted" }], columns);
    }
    return;
  }
  if (item.type === "tool") {
    const status = item.status === "running" ? " …" : "";
    const summaryTone: TranscriptTone = item.status === "error" || item.status === "denied" ? "bad" : "muted";
    pushWrapped(
      rows,
      item.id,
      [
        { text: "⏺ ", tone: "accent" },
        { text: displayName(item.name), tone: "text", bold: true },
        { text: `${item.target ? `(${trimOne(item.target, 90)})` : ""}${status}`, tone: "muted" },
      ],
      columns,
    );
    if (item.summary) pushWrapped(rows, `${item.id}:sum`, [{ text: `  ⎿  ${item.summary}`, tone: summaryTone }], columns);
    if (item.diff?.length) {
      const shown = compactDiff(item.diff, 2, 12);
      shown.forEach((line, index) => {
        const mark = line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  ";
        const tone: TranscriptTone = line.kind === "add" ? "add" : line.kind === "del" ? "del" : "muted";
        pushWrapped(rows, `${item.id}:diff:${index}`, [{ text: `    ${mark}${line.text}`, tone }], columns);
      });
    }
    if (expanded && item.detail) {
      const detail = item.detail.split("\n").slice(0, 40).join("\n");
      pushWrapped(rows, `${item.id}:detail`, [{ text: detail, tone: "muted" }], columns);
    }
    return;
  }
  const tone: TranscriptTone = item.type === "error" ? "bad" : item.type === "system" ? "muted" : "text";
  pushWrapped(rows, item.id, [{ text: item.text, tone }], columns);
}

function pushWrapped(rows: TranscriptRow[], keyBase: string, parts: TranscriptPart[], columns: number): void {
  const lines = wrapParts(parts, columns);
  lines.forEach((line, index) => {
    rows.push({ key: `${keyBase}:${index}`, parts: line });
  });
}

/** Wrap colored parts on grapheme boundaries. A newline starts a new row. */
export function wrapParts(parts: TranscriptPart[], columns: number): TranscriptPart[][] {
  const width = Math.max(1, columns);
  const rows: TranscriptPart[][] = [];
  let line: TranscriptPart[] = [];
  let used = 0;
  let broke = false;

  const breakLine = () => {
    rows.push(line.length ? line : [{ text: " ", tone: "muted" }]);
    line = [];
    used = 0;
    broke = true;
  };

  const addSegment = (segment: string, tone: TranscriptTone, bold?: boolean) => {
    const gw = graphemeWidth(segment);
    if (gw === 0) {
      append(segment, tone, bold);
      return;
    }
    if (used > 0 && used + gw > width) breakLine();
    append(segment, tone, bold);
    used += gw;
    broke = false;
  };

  const append = (segment: string, tone: TranscriptTone, bold?: boolean) => {
    const last = line[line.length - 1];
    if (last && last.tone === tone && Boolean(last.bold) === Boolean(bold)) last.text += segment;
    else line.push({ text: segment, tone, bold });
  };

  let saw = false;
  for (const part of parts) {
    const chunks = part.text.split("\n");
    for (let index = 0; index < chunks.length; index += 1) {
      saw = true;
      for (const grapheme of graphemes(chunks[index] ?? "")) addSegment(grapheme.segment, part.tone, part.bold);
      if (index < chunks.length - 1) breakLine();
    }
  }
  if (!saw) return [[{ text: " ", tone: "muted" }]];
  if (line.length) rows.push(line);
  else if (broke) rows.push([{ text: " ", tone: "muted" }]);
  else if (!rows.length) rows.push([{ text: " ", tone: "muted" }]);
  return rows;
}

function trimOne(value: string, max: number): string {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

