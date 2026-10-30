import { displayName } from "./render/format.js";
import type { SessionSnapshot } from "./session.js";
import { fitWidth } from "./tui/text.js";

/** Columns for a picker title. Leaves room for the border, padding, and caret on an 80-column terminal. */
export const RESUME_LABEL_COLUMNS = 72;

/** One row in the in-session resume picker. */
export interface ResumeListItem {
  id: string;
  name: string;
  preview: string;
  title: string;
  updatedAt: string;
  resumable: boolean;
  tail: string[];
}

export interface ResumePickerState {
  all: ResumeListItem[];
  query: string;
  selected: number;
}

export type ResumeDecision =
  | { action: "picker"; items: ResumeListItem[]; query: string }
  | { action: "load"; id: string }
  | { action: "message"; text: string; level: "system" | "error" };

export interface ResumeKey {
  input: string;
  ctrl: boolean;
  meta: boolean;
  return: boolean;
  escape: boolean;
  backspace: boolean;
  delete: boolean;
  up: boolean;
  down: boolean;
  pageUp: boolean;
  pageDown: boolean;
}

export type ResumePickerEffect = { type: "close" } | { type: "select"; id: string };

export interface ResumePickerRow {
  id: string;
  /** `/rename` name when set, otherwise the first user message. Not the session id. */
  title: string;
  /** Relative time. The secondary line leads with this. */
  age: string;
  /** Session id, plus the first-message preview when a custom name is the title. */
  detail: string;
}

export interface ResumePickerView {
  rows: ResumePickerRow[];
  selected: number;
  query: string;
  matchCount: number;
  preview: string[];
  hiddenAbove: number;
  hiddenBelow: number;
}

/**
 * Name stored by `/rename`. Empty when `/resume` should label the row from the first user message.
 * Whitespace does not count as a custom name.
 */
export function customSessionName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/**
 * The session's first user message, as one line of the words the user typed.
 * Transcript text wins over the model payload so attached file dumps stay out of the label.
 */
export function firstUserMessageText(session: Pick<SessionSnapshot, "messages" | "items">): string {
  for (const item of session.items) {
    if (item.type !== "user") continue;
    const text = plainUserText(item.text);
    if (text) return text;
  }
  for (const message of session.messages) {
    if (message.role !== "user") continue;
    const text = plainUserText(message.content);
    if (text) return text;
  }
  return "";
}

/** Custom name when set, otherwise the first user message, otherwise `(no messages)`. */
export function sessionResumeTitle(session: Pick<SessionSnapshot, "meta" | "messages" | "items">): string {
  const name = customSessionName(session.meta.name);
  if (name) return oneLine(name, RESUME_LABEL_COLUMNS);
  const first = firstUserMessageText(session);
  if (first) return oneLine(first, RESUME_LABEL_COLUMNS);
  return "(no messages)";
}

export function sessionListItem(session: SessionSnapshot): ResumeListItem {
  const name = customSessionName(session.meta.name);
  const preview = firstUserMessageText(session);
  return {
    id: session.meta.id,
    name,
    preview,
    title: sessionResumeTitle(session),
    updatedAt: session.meta.updatedAt || session.meta.createdAt,
    resumable: Boolean(name || preview),
    tail: tailLines(session, oneLine(preview, 80)),
  };
}

/**
 * `/resume` with no id opens the picker. A unique id, name, or prefix loads
 * immediately. An ambiguous id opens the picker filtered to the matches.
 */
export function decideResume(id: string | undefined, sessions: SessionSnapshot[], currentId?: string): ResumeDecision {
  const items = sessions.map(sessionListItem);
  const typed = id?.trim().replace(/\.jsonl$/i, "");
  if (!typed) {
    const rows = items.filter((item) => item.resumable && item.id !== currentId);
    if (!rows.length) return { action: "message", text: "No earlier sessions to resume.", level: "system" };
    return { action: "picker", items: rows, query: "" };
  }
  const resolved = resolveResumeId(items, typed);
  if (resolved.kind === "one") return { action: "load", id: resolved.item.id };
  if (resolved.kind === "many") return { action: "picker", items: resolved.items, query: typed };
  const hits = filterResumeItems(items, typed);
  if (hits.length) return { action: "picker", items: hits, query: typed };
  return { action: "message", text: `No session matches ${typed}.`, level: "error" };
}

export function openResumePicker(items: ResumeListItem[], query = ""): ResumePickerState {
  return { all: items, query, selected: 0 };
}

export function filterResumeItems(items: ResumeListItem[], query: string): ResumeListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) =>
    [item.id, item.name, item.preview, item.title].some((field) => field.toLowerCase().includes(q)),
  );
}

export function visibleResumeItems(state: ResumePickerState): ResumeListItem[] {
  return filterResumeItems(state.all, state.query);
}

export function reduceResumePicker(
  state: ResumePickerState,
  key: ResumeKey,
): { state: ResumePickerState; effect?: ResumePickerEffect } {
  if (key.escape || (key.ctrl && key.input === "c")) return { state, effect: { type: "close" } };
  const visible = visibleResumeItems(state);
  if (key.up) {
    if (!visible.length) return { state };
    return { state: { ...state, selected: (state.selected + visible.length - 1) % visible.length } };
  }
  if (key.down) {
    if (!visible.length) return { state };
    return { state: { ...state, selected: (state.selected + 1) % visible.length } };
  }
  if (key.pageUp || key.pageDown) {
    if (!visible.length) return { state };
    const delta = key.pageDown ? 5 : -5;
    return { state: { ...state, selected: clamp(state.selected + delta, 0, visible.length - 1) } };
  }
  if (key.return) {
    const item = visible[Math.min(state.selected, Math.max(0, visible.length - 1))];
    if (!item) return { state };
    return { state, effect: { type: "select", id: item.id } };
  }
  if (key.ctrl && key.input === "u") return { state: { ...state, query: "", selected: 0 } };
  if (key.backspace || key.delete) return { state: { ...state, query: state.query.slice(0, -1), selected: 0 } };
  if (key.input && !key.ctrl && !key.meta && !key.up && !key.down && !key.pageUp && !key.pageDown) {
    return { state: { ...state, query: state.query + key.input, selected: 0 } };
  }
  return { state };
}

export function resumePickerView(state: ResumePickerState, now = new Date()): ResumePickerView {
  const matches = visibleResumeItems(state);
  const selected = matches.length ? Math.min(state.selected, matches.length - 1) : 0;
  const windowed = windowResumeItems(matches, selected, 8);
  const current = matches[selected];
  return {
    rows: windowed.rows.map((item) => ({ id: item.id, ...resumeRowLabel(item, now) })),
    selected: windowed.rows.length ? windowed.selected : 0,
    query: state.query,
    matchCount: matches.length,
    preview: current?.tail ?? [],
    hiddenAbove: windowed.start,
    hiddenBelow: Math.max(0, matches.length - windowed.start - windowed.rows.length),
  };
}

export function formatResumeAge(iso: string, now = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const ms = now.getTime() - then.getTime();
  if (ms < 45_000) return "just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${Math.max(1, hours)}h ago`;
  const days = Math.round(ms / 86_400_000);
  if (days < 7) return `${Math.max(1, days)}d ago`;
  return iso.slice(0, 10);
}

/**
 * Title and secondary line for one picker row.
 * Title is the custom name, or the first user message. Age is the relative
 * time and leads the secondary line. The session id is only in `detail`.
 */
export function resumeRowLabel(item: ResumeListItem, now = new Date()): Omit<ResumePickerRow, "id"> {
  const age = formatResumeAge(item.updatedAt, now);
  const preview = item.name && item.preview ? oneLine(item.preview, 48) : "";
  const detail = preview ? `${item.id} · ${preview}` : item.id;
  return { title: item.title, age, detail };
}

function resolveResumeId(
  items: ResumeListItem[],
  query: string,
): { kind: "none" } | { kind: "one"; item: ResumeListItem } | { kind: "many"; items: ResumeListItem[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { kind: "many", items };
  const exactId = items.filter((item) => item.id.toLowerCase() === q);
  if (exactId.length === 1 && exactId[0]) return { kind: "one", item: exactId[0] };
  const exactName = items.filter((item) => item.name && item.name.toLowerCase() === q);
  if (exactName.length === 1 && exactName[0]) return { kind: "one", item: exactName[0] };
  if (exactName.length > 1) return { kind: "many", items: exactName };
  const prefix = items.filter(
    (item) => item.id.toLowerCase().startsWith(q) || (item.name.length > 0 && item.name.toLowerCase().startsWith(q)),
  );
  if (prefix.length === 1 && prefix[0]) return { kind: "one", item: prefix[0] };
  if (prefix.length > 1) return { kind: "many", items: prefix };
  return { kind: "none" };
}

function windowResumeItems(
  items: ResumeListItem[],
  selected: number,
  size: number,
): { rows: ResumeListItem[]; selected: number; start: number } {
  if (!items.length) return { rows: [], selected: 0, start: 0 };
  const index = clamp(selected, 0, items.length - 1);
  const start = Math.max(0, Math.min(index - 1, Math.max(0, items.length - size)));
  return { rows: items.slice(start, start + size), selected: index - start, start };
}

function tailLines(session: SessionSnapshot, preview: string): string[] {
  const lines: string[] = [];
  for (const item of session.items) {
    if (item.type === "user") lines.push(`> ${oneLine(item.text, 100)}`);
    else if (item.type === "assistant" && item.text.trim()) lines.push(oneLine(item.text, 100));
    else if (item.type === "tool") {
      const name = displayName(item.name);
      lines.push(item.target ? `⏺ ${name}(${oneLine(item.target, 60)})` : `⏺ ${name}`);
    }
  }
  const tail = lines.slice(-6);
  if (!tail.length && preview) return [`> ${preview}`];
  return tail;
}

function plainUserText(raw: string): string {
  const cut = raw.split(/<attached\b/)[0] ?? raw;
  return cut.replace(/\s+/g, " ").trim();
}

function oneLine(text: string, max: number): string {
  return fitWidth(text.replace(/\s+/g, " ").trim(), max);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
