import assert from "node:assert/strict";
import test from "node:test";
import { caretVisible, promptSegments } from "../src/tui/caret.js";
import { emptyEditor, reduceEditor, type EditorState, type KeyIn } from "../src/tui/editor.js";
import { emptyDecodeState, pushConsoleChunk } from "../src/tui/keys.js";
import { displayWidth } from "../src/tui/text.js";

function key(partial: Partial<KeyIn>): KeyIn {
  return {
    input: "",
    ctrl: false,
    meta: false,
    shift: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    up: false,
    down: false,
    left: false,
    right: false,
    pageUp: false,
    pageDown: false,
    ...partial,
  };
}

function apply(state: EditorState, chunk: string): EditorState {
  let decode = emptyDecodeState();
  const parsed = pushConsoleChunk(decode, chunk);
  let next = state;
  for (const pressed of parsed.keys) {
    const step = reduceEditor(next, pressed);
    if (step.effect === "submit") return next;
    next = step.state;
  }
  return next;
}

test("windows backspace is DEL or BS, including when it shares a chunk with text", () => {
  assert.equal(apply(emptyEditor(), "ab\x7f").text, "a");
  assert.equal(apply(emptyEditor(), "ab\b").text, "a");
  assert.equal(apply(emptyEditor(), "你\x7f").text, "");
  const emoji = "👍";
  assert.equal(emoji.length, 2);
  assert.equal(apply({ ...emptyEditor(), text: `a${emoji}`, cursor: 1 + emoji.length, anchor: null }, "\x7f").text, "a");
});

test("the delete key removes the next grapheme and ctrl+a still jumps home", () => {
  const mid = apply({ ...emptyEditor(), text: "你好", cursor: 0, anchor: null }, "\x1b[3~");
  assert.equal(mid.text, "好");
  const home = reduceEditor({ ...emptyEditor(), text: "abcd", cursor: 4, anchor: null }, key({ ctrl: true, input: "a" }));
  assert.equal(home.state.cursor, 0);
  const deleted = reduceEditor(home.state, key({ delete: true }));
  assert.equal(deleted.state.text, "bcd");
});

test("shift+arrows select, and backspace deletes the selection", () => {
  let state: EditorState = { ...emptyEditor(), text: "abcd", cursor: 4 };
  state = reduceEditor(state, key({ left: true, shift: true })).state;
  state = reduceEditor(state, key({ left: true, shift: true })).state;
  assert.equal(state.anchor, 4);
  assert.equal(state.cursor, 2);
  state = reduceEditor(state, key({ backspace: true })).state;
  assert.equal(state.text, "ab");
  assert.equal(state.anchor, null);
  state = reduceEditor({ ...emptyEditor(), text: "abcd", cursor: 1, anchor: 3 }, key({ input: "X" })).state;
  assert.equal(state.text, "aXd");
});

test("arrow keys arrive as CSI or SS3, and a split sequence is completed on the next chunk", () => {
  assert.equal(pushConsoleChunk(emptyDecodeState(), "\x1b[A").keys[0]?.up, true);
  assert.equal(pushConsoleChunk(emptyDecodeState(), "\x1bOB").keys[0]?.down, true);
  const shifted = pushConsoleChunk(emptyDecodeState(), "\x1b[1;2D").keys[0];
  assert.equal(shifted?.left, true);
  assert.equal(shifted?.shift, true);
  const partial = pushConsoleChunk(emptyDecodeState(), "\x1b[");
  assert.equal(partial.keys.length, 0);
  const rest = pushConsoleChunk(partial.state, "B");
  assert.equal(rest.keys[0]?.down, true);
});

test("bracketed paste inserts newlines instead of submitting", () => {
  const parsed = pushConsoleChunk(emptyDecodeState(), "\x1b[200~a\nb\x1b[201~");
  assert.equal(parsed.keys.length, 1);
  assert.equal(parsed.keys[0]?.input, "a\nb");
  assert.equal(parsed.keys[0]?.return, false);
  assert.equal(apply(emptyEditor(), "\x1b[200~a\nb\x1b[201~").text, "a\nb");
});

test("the caret is visible on even ticks and covers one grapheme", () => {
  assert.equal(caretVisible(0), true);
  assert.equal(caretVisible(1), false);
  const shown = promptSegments("你a", 0, null, 0);
  assert.equal(shown.some((part) => part.inverse && part.text === "你"), true);
  const hidden = promptSegments("ab", 2, null, 1);
  assert.equal(hidden.some((part) => part.text === " " && part.inverse), false);
  const selected = promptSegments("abcd", 3, 1, 1);
  assert.equal(selected.find((part) => part.inverse)?.text, "bc");
  assert.equal(displayWidth("你"), 2);
  assert.equal(displayWidth("a"), 1);
});
