import { nextGrapheme, prevGrapheme, snapGrapheme, graphemes } from "./text.js";

export interface EditorState {
  text: string;
  cursor: number;
  /** Other end of the selection. Null, or equal to `cursor`, means no selection. */
  anchor: number | null;
  vim: boolean;
  vimMode: "insert" | "normal";
  pending: string;
  kill: string;
  undo: { text: string; cursor: number } | null;
}

export interface KeyIn {
  input: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  return: boolean;
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  pageUp: boolean;
  pageDown: boolean;
  home?: boolean;
  end?: boolean;
}

export type EditorEffect =
  | "submit"
  | "history-prev"
  | "history-next"
  | "cycle-mode"
  | "help"
  | "escape"
  | "ctrl-c"
  | "exit-hint"
  | "stash"
  | "scroll-up"
  | "scroll-down"
  | "toggle-expand"
  | "toggle-todos"
  | "redraw"
  | "reverse-search"
  | "complete"
  | "background";

export function emptyEditor(vim = false): EditorState {
  return { text: "", cursor: 0, anchor: null, vim, vimMode: "insert", pending: "", kill: "", undo: null };
}

export function reduceEditor(state: EditorState, key: KeyIn): { state: EditorState; effect?: EditorEffect } {
  const input = key.input.replace(/\x1b\[200~/g, "").replace(/\x1b\[201~/g, "");
  if ((key.tab && key.shift) || (key.meta && input === "m")) return { state, effect: "cycle-mode" };
  if (key.ctrl && input === "c") return { state, effect: "ctrl-c" };
  if (key.escape) {
    if (state.vim && state.vimMode === "insert") return { state: { ...state, vimMode: "normal", pending: "", anchor: null } };
    return { state, effect: "escape" };
  }
  if (key.pageUp) return { state, effect: "scroll-up" };
  if (key.pageDown) return { state, effect: "scroll-down" };
  if (key.ctrl && input === "o") return { state, effect: "toggle-expand" };
  if (key.ctrl && input === "t") return { state, effect: "toggle-todos" };
  if (key.ctrl && input === "l") return { state, effect: "redraw" };
  if (key.ctrl && input === "r") return { state, effect: "reverse-search" };
  if (key.ctrl && input === "s") return { state, effect: "stash" };
  if (key.ctrl && input === "b") return { state, effect: "background" };
  if (key.return || input === "\r") {
    if (key.shift || (key.ctrl && input === "j")) return { state: insert(state, "\n") };
    if (state.text[state.cursor - 1] === "\\" && state.text[state.cursor - 2] !== "\\") {
      const removed = backspace(state);
      return { state: insert(removed, "\n") };
    }
    return { state, effect: "submit" };
  }
  if (key.ctrl && input === "j") return { state: insert(state, "\n") };
  if (key.tab) return { state, effect: "complete" };
  if (key.up) return vertical(state, -1, key.shift);
  if (key.down) return vertical(state, 1, key.shift);
  if (key.home || (key.ctrl && input === "a")) return { state: nudge(state, lineStart(state.text, state.cursor), key.shift) };
  if (key.end || (key.ctrl && input === "e")) return { state: nudge(state, lineEnd(state.text, state.cursor), key.shift) };
  if (key.left) {
    const cursor = key.ctrl || key.meta ? wordBack(state.text, state.cursor) : prevGrapheme(state.text, state.cursor);
    return { state: nudge(state, cursor, key.shift) };
  }
  if (key.right || (key.ctrl && input === "f" && !key.meta)) {
    const cursor = key.meta || (key.ctrl && key.right) ? wordForward(state.text, state.cursor) : nextGrapheme(state.text, state.cursor);
    return { state: nudge(state, cursor, key.shift) };
  }
  if (key.ctrl && input === "u") return { state: killRange(state, lineStart(state.text, state.cursor), state.cursor) };
  if (key.ctrl && input === "k") return { state: killToEnd(state) };
  if (key.ctrl && input === "w") return { state: killBack(state, whitespaceBack(state.text, state.cursor)) };
  if (key.ctrl && input === "y") return { state: insert(state, state.kill) };
  if (key.meta && (input === "b" || key.left)) return { state: nudge(state, wordBack(state.text, state.cursor), false) };
  if (key.meta && (input === "f" || key.right)) return { state: nudge(state, wordForward(state.text, state.cursor), false) };
  if (key.ctrl && input === "d") {
    if (!state.text) return { state, effect: "exit-hint" };
    if (state.cursor < state.text.length || hasSelection(state)) return { state: delForward(state) };
    return { state };
  }
  if (state.vim && state.vimMode === "normal" && !key.ctrl && !key.meta) {
    return vimNormal(state, input, key);
  }
  if (isBackspace(key, input)) {
    if (state.text === "!" && !hasSelection(state)) return { state: { ...state, text: "", cursor: 0, anchor: null } };
    if (key.meta && !hasSelection(state)) return { state: killBack(state, wordBack(state.text, state.cursor)) };
    return { state: backspace(state) };
  }
  if (key.delete) return { state: delForward(state) };
  if (!input || key.ctrl || key.meta) return { state };
  if (input === "?" && state.text === "") return { state, effect: "help" };
  return { state: insert(state, input) };
}

function isBackspace(key: KeyIn, input: string): boolean {
  return key.backspace || input === "\x7f" || input === "\b" || (key.ctrl && input === "h");
}

function vimNormal(state: EditorState, input: string, key: KeyIn): { state: EditorState; effect?: EditorEffect } {
  if (key.backspace) return { state: move(state, -1) };
  if (state.pending === "d") {
    const cleared = { ...state, pending: "" };
    if (input === "d") return { state: deleteLine(cleared) };
    if (input === "w") return { state: killRange(cleared, cleared.cursor, wordForward(cleared.text, cleared.cursor)) };
    if (input === "$") return { state: killToEnd(cleared) };
    return { state: cleared };
  }
  switch (input) {
    case "h":
      return { state: move(state, -1) };
    case "l":
      return { state: move(state, 1) };
    case "j":
      return vertical(state, 1, false);
    case "k":
      return vertical(state, -1, false);
    case "0":
      return { state: nudge(state, lineStart(state.text, state.cursor), false) };
    case "$":
      return { state: nudge(state, lineEnd(state.text, state.cursor), false) };
    case "w":
      return { state: nudge(state, wordForward(state.text, state.cursor), false) };
    case "b":
      return { state: nudge(state, wordBack(state.text, state.cursor), false) };
    case "x":
      return { state: delForward(state) };
    case "i":
      return { state: { ...state, vimMode: "insert", anchor: null } };
    case "a":
      return { state: { ...move(state, 1), vimMode: "insert" } };
    case "I":
      return { state: { ...state, vimMode: "insert", cursor: lineStart(state.text, state.cursor), anchor: null } };
    case "A":
      return { state: { ...state, vimMode: "insert", cursor: lineEnd(state.text, state.cursor), anchor: null } };
    case "o":
      return { state: openLine(state, false) };
    case "O":
      return { state: openLine(state, true) };
    case "p":
      return { state: { ...insert({ ...state, cursor: Math.min(state.text.length, state.cursor + 1) }, state.kill), vimMode: "normal" } };
    case "u":
      return state.undo ? { state: { ...state, text: state.undo.text, cursor: state.undo.cursor, undo: null, anchor: null } } : { state };
    case "d":
      return { state: { ...state, pending: "d" } };
    default:
      return { state };
  }
}

function vertical(state: EditorState, dir: -1 | 1, shift: boolean): { state: EditorState; effect?: EditorEffect } {
  const start = lineStart(state.text, state.cursor);
  if (dir < 0 && start === 0) return { state, effect: "history-prev" };
  const end = lineEnd(state.text, state.cursor);
  if (dir > 0 && end === state.text.length) return { state, effect: "history-next" };
  const column = state.cursor - start;
  if (dir < 0) {
    const prevEnd = start - 1;
    const prevStart = lineStart(state.text, prevEnd);
    return { state: nudge(state, Math.min(prevEnd, prevStart + column), shift) };
  }
  const nextStart = end + 1;
  const nextEnd = lineEnd(state.text, nextStart);
  return { state: nudge(state, Math.min(nextEnd, nextStart + column), shift) };
}

function nudge(state: EditorState, cursor: number, shift: boolean): EditorState {
  const next = Math.max(0, Math.min(state.text.length, cursor));
  if (!shift) return { ...state, cursor: next, anchor: null };
  return { ...state, cursor: next, anchor: state.anchor ?? state.cursor };
}

function insert(state: EditorState, value: string): EditorState {
  const clean = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const base = hasSelection(state) ? withoutSelection(state) : { ...state, anchor: null };
  if (!clean) return base;
  const cursor = snapGrapheme(base.text, base.cursor);
  const undo = clean.length > 1 ? { text: state.text, cursor: state.cursor } : base.undo;
  const text = base.text.slice(0, cursor) + clean + base.text.slice(cursor);
  return { ...base, text, cursor: cursor + clean.length, anchor: null, undo: undo ?? null };
}

function backspace(state: EditorState): EditorState {
  if (hasSelection(state)) return withoutSelection(state);
  if (state.cursor === 0) return { ...state, anchor: null };
  const start = prevGrapheme(state.text, state.cursor);
  const removeTo = Math.max(state.cursor, nextGrapheme(state.text, start));
  return {
    ...state,
    text: state.text.slice(0, start) + state.text.slice(removeTo),
    cursor: start,
    anchor: null,
  };
}

function delForward(state: EditorState): EditorState {
  if (hasSelection(state)) return withoutSelection(state);
  if (state.cursor >= state.text.length) return state;
  const start = snapGrapheme(state.text, state.cursor);
  const end = nextGrapheme(state.text, start);
  if (end <= start) return state;
  return { ...state, text: state.text.slice(0, start) + state.text.slice(end), cursor: start, anchor: null };
}

function hasSelection(state: EditorState): boolean {
  return state.anchor != null && state.anchor !== state.cursor;
}

function withoutSelection(state: EditorState): EditorState {
  if (!hasSelection(state) || state.anchor == null) return { ...state, anchor: null };
  const start = Math.min(state.anchor, state.cursor);
  const end = Math.max(state.anchor, state.cursor);
  return {
    ...state,
    text: state.text.slice(0, start) + state.text.slice(end),
    cursor: start,
    anchor: null,
    undo: { text: state.text, cursor: state.cursor },
  };
}

function move(state: EditorState, delta: number): EditorState {
  const cursor = delta < 0 ? prevGrapheme(state.text, state.cursor) : nextGrapheme(state.text, state.cursor);
  return { ...state, cursor, anchor: null };
}

function killRange(state: EditorState, from: number, to: number): EditorState {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const killed = state.text.slice(start, end);
  return {
    ...state,
    text: state.text.slice(0, start) + state.text.slice(end),
    cursor: start,
    anchor: null,
    kill: killed || state.kill,
    undo: { text: state.text, cursor: state.cursor },
  };
}

function killToEnd(state: EditorState): EditorState {
  const end = lineEnd(state.text, state.cursor);
  if (state.cursor === end && state.text[end] === "\n") return killRange(state, state.cursor, end + 1);
  return killRange(state, state.cursor, end);
}

function killBack(state: EditorState, from: number): EditorState {
  return killRange(state, from, state.cursor);
}

function deleteLine(state: EditorState): EditorState {
  const start = lineStart(state.text, state.cursor);
  let end = lineEnd(state.text, state.cursor);
  if (state.text[end] === "\n") end += 1;
  return killRange(state, start, end);
}

function openLine(state: EditorState, above: boolean): EditorState {
  const at = above ? lineStart(state.text, state.cursor) : lineEnd(state.text, state.cursor);
  const text = state.text.slice(0, at) + "\n" + state.text.slice(at);
  const cursor = above ? at : at + 1;
  return { ...state, text, cursor, anchor: null, vimMode: "insert", undo: { text: state.text, cursor: state.cursor } };
}

function lineStart(text: string, cursor: number): number {
  return text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
}

function lineEnd(text: string, cursor: number): number {
  const at = text.indexOf("\n", cursor);
  return at === -1 ? text.length : at;
}

function whitespaceBack(text: string, cursor: number): number {
  const parts = graphemes(text);
  let at = indexBefore(parts, cursor);
  while (at >= 0 && cls(parts[at]?.segment ?? "") === "space") at -= 1;
  while (at >= 0 && cls(parts[at]?.segment ?? "") !== "space") at -= 1;
  if (at < 0) return 0;
  return parts[at + 1]?.start ?? 0;
}

function wordBack(text: string, cursor: number): number {
  const parts = graphemes(text);
  let at = indexBefore(parts, cursor);
  while (at >= 0 && cls(parts[at]?.segment ?? "") === "space") at -= 1;
  if (at < 0) return 0;
  const kind = cls(parts[at]?.segment ?? "");
  while (at >= 0 && cls(parts[at]?.segment ?? "") === kind) at -= 1;
  return at < 0 ? 0 : (parts[at + 1]?.start ?? 0);
}

function wordForward(text: string, cursor: number): number {
  const parts = graphemes(text);
  let at = parts.findIndex((part) => part.start >= cursor);
  if (at < 0) return text.length;
  while (at < parts.length && cls(parts[at]?.segment ?? "") === "space") at += 1;
  if (at >= parts.length) return text.length;
  const kind = cls(parts[at]?.segment ?? "");
  while (at < parts.length && cls(parts[at]?.segment ?? "") === kind) at += 1;
  return parts[at]?.start ?? text.length;
}

function indexBefore(parts: Array<{ start: number; end: number }>, cursor: number): number {
  let at = -1;
  for (let i = 0; i < parts.length; i += 1) {
    if ((parts[i]?.start ?? 0) >= cursor) break;
    at = i;
  }
  return at;
}

function cls(segment: string): "space" | "word" | "punct" {
  if (/^\s+$/u.test(segment)) return "space";
  if (/^[\p{L}\p{N}_]+$/u.test(segment)) return "word";
  return "punct";
}
