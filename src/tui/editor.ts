export interface EditorState {
  text: string;
  cursor: number;
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
  return { text: "", cursor: 0, vim, vimMode: "insert", pending: "", kill: "", undo: null };
}

export function reduceEditor(state: EditorState, key: KeyIn): { state: EditorState; effect?: EditorEffect } {
  const input = key.input.replace(/\x1b\[200~/g, "").replace(/\x1b\[201~/g, "");
  if ((key.tab && key.shift) || (key.meta && input === "m")) return { state, effect: "cycle-mode" };
  if (key.ctrl && input === "c") return { state, effect: "ctrl-c" };
  if (key.escape) {
    if (state.vim && state.vimMode === "insert") return { state: { ...state, vimMode: "normal", pending: "" } };
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
      const removed = { ...state, text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor), cursor: state.cursor - 1 };
      return { state: insert(removed, "\n") };
    }
    return { state, effect: "submit" };
  }
  if (key.ctrl && input === "j") return { state: insert(state, "\n") };
  if (key.tab) return { state, effect: "complete" };
  if (key.up) return vertical(state, -1);
  if (key.down) return vertical(state, 1);
  if (key.left || (key.ctrl && input === "b" && !key.meta)) return { state: move(state, -1) };
  if (key.right || (key.ctrl && input === "f" && !key.meta)) return { state: move(state, 1) };
  if (key.ctrl && input === "a") return { state: { ...state, cursor: lineStart(state.text, state.cursor) } };
  if (key.ctrl && input === "e") return { state: { ...state, cursor: lineEnd(state.text, state.cursor) } };
  if (key.ctrl && input === "u") return { state: killRange(state, lineStart(state.text, state.cursor), state.cursor) };
  if (key.ctrl && input === "k") return { state: killToEnd(state) };
  if (key.ctrl && input === "w") return { state: killBack(state, whitespaceBack(state.text, state.cursor)) };
  if (key.ctrl && input === "y") return { state: insert(state, state.kill) };
  if (key.meta && (input === "b" || key.left)) return { state: { ...state, cursor: wordBack(state.text, state.cursor) } };
  if (key.meta && (input === "f" || key.right)) return { state: { ...state, cursor: wordForward(state.text, state.cursor) } };
  if (key.ctrl && input === "d") {
    if (!state.text) return { state, effect: "exit-hint" };
    if (state.cursor < state.text.length) return { state: delForward(state) };
    return { state };
  }
  if (state.vim && state.vimMode === "normal" && !key.ctrl && !key.meta) {
    return vimNormal(state, input, key);
  }
  if (key.backspace || input === "\x7f") {
    if (state.text === "!") return { state: { ...state, text: "", cursor: 0 } };
    return { state: backspace(state) };
  }
  if (key.delete) return { state: delForward(state) };
  if (!input || key.ctrl || key.meta) return { state };
  if (input === "?" && state.text === "") return { state, effect: "help" };
  return { state: insert(state, input) };
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
      return vertical(state, 1);
    case "k":
      return vertical(state, -1);
    case "0":
      return { state: { ...state, cursor: lineStart(state.text, state.cursor) } };
    case "$":
      return { state: { ...state, cursor: lineEnd(state.text, state.cursor) } };
    case "w":
      return { state: { ...state, cursor: wordForward(state.text, state.cursor) } };
    case "b":
      return { state: { ...state, cursor: wordBack(state.text, state.cursor) } };
    case "x":
      return { state: delForward(state) };
    case "i":
      return { state: { ...state, vimMode: "insert" } };
    case "a":
      return { state: { ...move(state, 1), vimMode: "insert" } };
    case "I":
      return { state: { ...state, vimMode: "insert", cursor: lineStart(state.text, state.cursor) } };
    case "A":
      return { state: { ...state, vimMode: "insert", cursor: lineEnd(state.text, state.cursor) } };
    case "o":
      return { state: openLine(state, false) };
    case "O":
      return { state: openLine(state, true) };
    case "p":
      return { state: { ...insert({ ...state, cursor: Math.min(state.text.length, state.cursor + 1) }, state.kill), vimMode: "normal" } };
    case "u":
      return state.undo ? { state: { ...state, text: state.undo.text, cursor: state.undo.cursor, undo: null } } : { state };
    case "d":
      return { state: { ...state, pending: "d" } };
    default:
      return { state };
  }
}

function vertical(state: EditorState, dir: -1 | 1): { state: EditorState; effect?: EditorEffect } {
  const start = lineStart(state.text, state.cursor);
  if (dir < 0 && start === 0) return { state, effect: "history-prev" };
  const end = lineEnd(state.text, state.cursor);
  if (dir > 0 && end === state.text.length) return { state, effect: "history-next" };
  const column = state.cursor - start;
  if (dir < 0) {
    const prevEnd = start - 1;
    const prevStart = lineStart(state.text, prevEnd);
    return { state: { ...state, cursor: Math.min(prevEnd, prevStart + column) } };
  }
  const nextStart = end + 1;
  const nextEnd = lineEnd(state.text, nextStart);
  return { state: { ...state, cursor: Math.min(nextEnd, nextStart + column) } };
}

function insert(state: EditorState, value: string): EditorState {
  if (!value) return state;
  const undo = value.length > 1 ? { text: state.text, cursor: state.cursor } : state.undo;
  const text = state.text.slice(0, state.cursor) + value + state.text.slice(state.cursor);
  return { ...state, text, cursor: state.cursor + value.length, undo: undo ?? null };
}

function backspace(state: EditorState): EditorState {
  if (state.cursor === 0) return state;
  return {
    ...state,
    text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor),
    cursor: state.cursor - 1,
  };
}

function delForward(state: EditorState): EditorState {
  if (state.cursor >= state.text.length) return state;
  return { ...state, text: state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1) };
}

function move(state: EditorState, delta: number): EditorState {
  return { ...state, cursor: Math.max(0, Math.min(state.text.length, state.cursor + delta)) };
}

function killRange(state: EditorState, from: number, to: number): EditorState {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const killed = state.text.slice(start, end);
  return {
    ...state,
    text: state.text.slice(0, start) + state.text.slice(end),
    cursor: start,
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
  const text = state.text.slice(0, at) + (above ? "\n" : "\n") + state.text.slice(at);
  const cursor = above ? at : at + 1;
  return { ...state, text, cursor, vimMode: "insert", undo: { text: state.text, cursor: state.cursor } };
}

function lineStart(text: string, cursor: number): number {
  return text.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
}

function lineEnd(text: string, cursor: number): number {
  const at = text.indexOf("\n", cursor);
  return at === -1 ? text.length : at;
}

function whitespaceBack(text: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && /\s/.test(text[i - 1] ?? "")) i--;
  while (i > 0 && !/\s/.test(text[i - 1] ?? "")) i--;
  return i;
}

function wordBack(text: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && /\s/.test(text[i - 1] ?? "")) i--;
  if (i === 0) return 0;
  const kind = cls(text[i - 1] ?? "");
  while (i > 0 && cls(text[i - 1] ?? "") === kind) i--;
  return i;
}

function wordForward(text: string, cursor: number): number {
  let i = cursor;
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  if (i >= text.length) return i;
  const kind = cls(text[i] ?? "");
  while (i < text.length && cls(text[i] ?? "") === kind) i++;
  return i;
}

function cls(ch: string): "space" | "word" | "punct" {
  if (/\s/.test(ch)) return "space";
  if (/[A-Za-z0-9]/.test(ch)) return "word";
  return "punct";
}
