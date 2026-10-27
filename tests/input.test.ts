import assert from "node:assert/strict";
import test from "node:test";
import { caretVisible, promptCaretMode, promptSegments, showPromptPlaceholder } from "../src/tui/caret.js";
import { emptyEditor, reduceEditor, type EditorState, type KeyIn } from "../src/tui/editor.js";
import { emptyDecodeState, isEffortPickerShortcut, pickerSurface, pushConsoleChunk } from "../src/tui/keys.js";
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

test("placeholder stays off the caret while IME preedit is showing", () => {
  assert.equal(showPromptPlaceholder("", "", "Ask Glue to change this project"), true);
  assert.equal(showPromptPlaceholder("", "xiao", "Ask Glue to change this project"), false);
  assert.equal(showPromptPlaceholder("hi", "", "Ask Glue to change this project"), false);
  assert.equal(promptCaretMode("", "xiao"), "compose");
  assert.equal(promptCaretMode("", ""), "steady");
  assert.equal(promptCaretMode("hi", ""), "blink");
});

test("the caret is visible on even ticks and covers one grapheme", () => {
  assert.equal(caretVisible(0), true);
  assert.equal(caretVisible(1), false);
  const shown = promptSegments("你a", 0, null, 0);
  assert.equal(shown.some((part) => part.inverse && part.text === "你"), true);
  const hidden = promptSegments("你a", 0, null, 1);
  assert.equal(hidden.some((part) => part.text === "你" && part.inverse), false);
  assert.equal(hidden.some((part) => part.text === "你" && !part.inverse), true);
  const end = promptSegments("ab", 2, null, 1);
  assert.equal(end.some((part) => part.text === " " && part.inverse), false);
  const selected = promptSegments("abcd", 3, 1, 1);
  assert.equal(selected.find((part) => part.inverse)?.text, "bc");
  assert.equal(displayWidth("你"), 2);
  assert.equal(displayWidth("a"), 1);
});

test("backspace deletes at the end of the line and forward delete does not", () => {
  const typed = apply(emptyEditor(), "hi");
  assert.equal(typed.text, "hi");
  assert.equal(typed.cursor, 2);
  assert.equal(apply(typed, "\x1b[3~").text, "hi");
  assert.equal(apply(typed, "\x7f").text, "h");
  assert.equal(apply(typed, "\x08").text, "h");
  const ctrlH = reduceEditor(typed, key({ ctrl: true, input: "h" }));
  assert.equal(ctrlH.state.text, "h");
  assert.equal(ctrlH.state.cursor, 1);
});

test("one backspace removes a supplementary-plane character and alt+backspace removes a word", () => {
  const ideograph = "\u{20000}";
  assert.equal(ideograph.length, 2);
  const cleared = apply({ ...emptyEditor(), text: `a${ideograph}`, cursor: 1 + ideograph.length }, "\x7f");
  assert.equal(cleared.text, "a");
  const word = apply({ ...emptyEditor(), text: "one two", cursor: 7 }, "\x1b\x7f");
  assert.equal(word.text, "one ");
  assert.equal(word.cursor, 4);
});

test("ctrl+a then delete, and a shift-arrow selection, both delete through decoded bytes", () => {
  let state = apply(emptyEditor(), "abcd");
  state = apply(state, "\x01");
  assert.equal(state.cursor, 0);
  state = apply(state, "\x1b[3~");
  assert.equal(state.text, "bcd");

  state = apply({ ...emptyEditor(), text: "abcd", cursor: 4 }, "\x1b[1;2D\x1b[1;2D");
  assert.equal(state.anchor, 4);
  assert.equal(state.cursor, 2);
  state = apply(state, "\x7f");
  assert.equal(state.text, "ab");
  state = reduceEditor({ ...emptyEditor(), text: "abcd", cursor: 4, anchor: 2 }, key({ delete: true })).state;
  assert.equal(state.text, "ab");
  assert.equal(state.anchor, null);
});

test("Windows Terminal sequences and legacy conhost scan codes drive the same editor", () => {
  let state = apply(emptyEditor(), "你a");
  assert.equal(state.text, "你a");
  state = apply(state, "\x7f");
  assert.equal(state.text, "你");
  state = apply(state, "\x08");
  assert.equal(state.text, "");

  state = apply(emptyEditor(), "ab");
  state = apply(state, "\x00K");
  assert.equal(state.cursor, 1);
  state = apply(state, "\xe0S");
  assert.equal(state.text, "a");
  assert.equal(state.cursor, 1);

  const vt = pushConsoleChunk(emptyDecodeState(), "\x1b[A\x1b[B\x1b[C\x1b[D\r\n\x03\x01\x1b[Z");
  assert.equal(vt.keys[0]?.up, true);
  assert.equal(vt.keys[1]?.down, true);
  assert.equal(vt.keys[2]?.right, true);
  assert.equal(vt.keys[3]?.left, true);
  assert.equal(vt.keys[4]?.return, true);
  assert.equal(vt.keys[5]?.ctrl, true);
  assert.equal(vt.keys[5]?.input, "c");
  assert.equal(vt.keys[6]?.ctrl, true);
  assert.equal(vt.keys[6]?.input, "a");
  assert.equal(vt.keys[7]?.tab, true);
  assert.equal(vt.keys[7]?.shift, true);
  assert.equal(vt.keys.length, 8);
  const esc = pushConsoleChunk(emptyDecodeState(), "\x1b");
  assert.equal(esc.keys[0]?.escape, true);

  const legacy = pushConsoleChunk(emptyDecodeState(), "\xe0H\xe0P\xe0M\x00\x0f");
  assert.equal(legacy.keys[0]?.up, true);
  assert.equal(legacy.keys[1]?.down, true);
  assert.equal(legacy.keys[2]?.right, true);
  assert.equal(legacy.keys[3]?.tab, true);
  assert.equal(legacy.keys[3]?.shift, true);

  const split = pushConsoleChunk(emptyDecodeState(), "\xe0");
  assert.equal(split.keys.length, 0);
  const rest = pushConsoleChunk(split.state, "H");
  assert.equal(rest.keys[0]?.up, true);

  const submitted = reduceEditor(apply(emptyEditor(), "hi"), key({ return: true }));
  assert.equal(submitted.effect, "submit");
  const home = reduceEditor(apply(emptyEditor(), "abcd"), key({ ctrl: true, input: "a" }));
  assert.equal(home.state.cursor, 0);
  assert.equal(reduceEditor(emptyEditor(), key({ ctrl: true, input: "c" })).effect, "ctrl-c");
  assert.equal(reduceEditor(emptyEditor(), key({ escape: true })).effect, "escape");
  assert.equal(reduceEditor(emptyEditor(), key({ tab: true, shift: true })).effect, "cycle-mode");
});

test("tab is recognized from a raw byte, kitty, and modifyOtherKeys", () => {
  const plain = pushConsoleChunk(emptyDecodeState(), "\t");
  assert.equal(plain.keys[0]?.tab, true);
  assert.equal(plain.keys[0]?.shift, false);
  const kitty = pushConsoleChunk(emptyDecodeState(), "\x1b[9u");
  assert.equal(kitty.keys[0]?.tab, true);
  const shifted = pushConsoleChunk(emptyDecodeState(), "\x1b[9;2u");
  assert.equal(shifted.keys[0]?.tab, true);
  assert.equal(shifted.keys[0]?.shift, true);
  const other = pushConsoleChunk(emptyDecodeState(), "\x1b[27;1;9~");
  assert.equal(other.keys[0]?.tab, true);
  assert.equal(reduceEditor(emptyEditor(), key({ tab: true })).effect, "complete");
  assert.equal(reduceEditor({ ...emptyEditor(), text: "/he", cursor: 3 }, key({ tab: true })).effect, "complete");
});

test("alt+p opens the model and effort surface and does not insert p", () => {
  assert.equal(pickerSurface("alt-p"), "model-effort");
  assert.equal(pickerSurface("model"), "model-effort");
  assert.equal(pickerSurface("effort"), "effort");
  const plain = pushConsoleChunk(emptyDecodeState(), "\x1bp").keys[0];
  assert.equal(isEffortPickerShortcut(plain ?? {}), true);
  assert.equal(plain?.meta, true);
  assert.equal(plain?.input, "p");
  const kitty = pushConsoleChunk(emptyDecodeState(), "\x1b[112;3u").keys[0];
  assert.equal(isEffortPickerShortcut(kitty ?? {}), true);
  const other = pushConsoleChunk(emptyDecodeState(), "\x1b[27;3;112~").keys[0];
  assert.equal(other?.meta, true);
  assert.equal(isEffortPickerShortcut(other ?? {}), true);
  const typed = reduceEditor({ ...emptyEditor(), text: "draft", cursor: 5 }, plain ?? key({ meta: true, input: "p" }));
  assert.equal(typed.state.text, "draft");
  assert.equal(typed.effect, undefined);
  assert.equal(isEffortPickerShortcut(key({ ctrl: true, input: "p" })), false);
  assert.equal(isEffortPickerShortcut(key({ input: "p" })), false);
});

test("the mouse wheel scrolls and does not insert text", () => {
  const up = pushConsoleChunk(emptyDecodeState(), "\x1b[<64;1;1M").keys[0];
  assert.equal(up?.wheel, 1);
  assert.equal(up?.input, "");
  const down = pushConsoleChunk(emptyDecodeState(), "\x1b[<65;8;2M").keys[0];
  assert.equal(down?.wheel, -1);
  const shift = pushConsoleChunk(emptyDecodeState(), "\x1b[<68;1;1M").keys[0];
  assert.equal(shift?.wheel, 1);
  assert.equal(pushConsoleChunk(emptyDecodeState(), "\x1b[<64;1;1m").keys.length, 0);
  assert.equal(pushConsoleChunk(emptyDecodeState(), "\x1b[<0;1;1M").keys.length, 0);
  assert.equal(pushConsoleChunk(emptyDecodeState(), "\x1b[M`!!").keys[0]?.wheel, 1);
  assert.equal(pushConsoleChunk(emptyDecodeState(), "\x1b[Ma!!").keys[0]?.wheel, -1);
  const partial = pushConsoleChunk(emptyDecodeState(), "\x1b[<64;");
  assert.equal(partial.keys.length, 0);
  assert.equal(pushConsoleChunk(partial.state, "3;4M").keys[0]?.wheel, 1);
  const mixed = pushConsoleChunk(emptyDecodeState(), "a\x1b[<65;1;1M");
  assert.equal(mixed.keys[0]?.input, "a");
  assert.equal(mixed.keys[1]?.wheel, -1);
  assert.equal(apply(emptyEditor(), "hi\x1b[<64;1;1M").text, "hi");
  const page = reduceEditor(emptyEditor(), key({ wheel: 1 }));
  assert.equal(page.effect, "scroll-up");
  assert.equal(page.state.text, "");
  assert.equal(reduceEditor(emptyEditor(), key({ wheel: -1 })).effect, "scroll-down");
  assert.equal(pushConsoleChunk(emptyDecodeState(), "\x1b[5~").keys[0]?.pageUp, true);
  assert.equal(pushConsoleChunk(emptyDecodeState(), "\x00I").keys[0]?.pageUp, true);
});
