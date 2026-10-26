import assert from "node:assert/strict";
import test from "node:test";
import type { KeyIn } from "../src/tui/editor.js";
import { emptyDecodeState, pushConsoleChunk } from "../src/tui/keys.js";
import {
  bareModelQuery,
  formatModelStatus,
  modelChoices,
  modelHint,
  modelWindow,
  reduceModelPicker,
  type ModelPickerState,
} from "../src/tui/model-picker.js";

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

test("/model lists the current model and moves with the arrow keys", () => {
  assert.equal(bareModelQuery("/model"), true);
  assert.equal(bareModelQuery("/model "), true);
  assert.equal(bareModelQuery("/model gpt-4o"), false);
  const choices = modelChoices("deepseek-chat", "openai", ["deepseek-reasoner"]);
  assert.equal(choices[0]?.id, "deepseek-chat");
  assert.equal(choices[0]?.detail, "current");
  assert.ok(choices.some((choice) => choice.id === "deepseek-reasoner" && choice.detail === "configured"));
  assert.ok(choices.some((choice) => choice.id === "gpt-4o"));
  const opened = { choices, selected: 0 };
  const down = reduceModelPicker(opened, key({ down: true }));
  assert.equal(down.effect, undefined);
  assert.equal(down.state.selected, 1);
  assert.match(modelHint(down.state), /^model 2\//);
  assert.notEqual(down.state.choices[down.state.selected]?.id, choices[0]?.id);
  const up = reduceModelPicker(down.state, key({ up: true }));
  assert.equal(up.state.selected, 0);
  const chosen = reduceModelPicker(down.state, key({ return: true }));
  assert.equal(chosen.effect, "select");
  assert.equal(chosen.state.choices[chosen.state.selected]?.id, choices[1]?.id);
  assert.equal(reduceModelPicker(opened, key({ escape: true })).effect, "close");
  const status = formatModelStatus("deepseek-chat", "openai", ["deepseek-reasoner"]);
  assert.match(status, /Model: deepseek-chat/);
  assert.match(status, /\/model <name>/);
  assert.match(status, /Up and down move/);
});

test("decoded windows arrows, number keys, and esc move the model list", () => {
  const choices = modelChoices("gpt-4o-mini", "openai");
  let state: ModelPickerState = { choices, selected: 0 };
  const down = pushConsoleChunk(emptyDecodeState(), "\x1b[B").keys[0];
  assert.ok(down);
  let step = reduceModelPicker(state, down);
  assert.equal(step.effect, undefined);
  assert.equal(step.state.selected, 1);
  assert.match(modelHint(step.state), /^model 2\/.+gpt-4o$/);
  const up = pushConsoleChunk(emptyDecodeState(), "\x1bOA").keys[0];
  assert.ok(up);
  step = reduceModelPicker(step.state, up);
  assert.equal(step.state.selected, 0);
  const wrapped = reduceModelPicker(step.state, key({ up: true }));
  assert.equal(wrapped.state.selected, choices.length - 1);
  const numbered = reduceModelPicker(wrapped.state, key({ input: "2" }));
  assert.equal(numbered.effect, "select");
  assert.equal(numbered.state.selected, 1);
  assert.equal(numbered.state.choices[1]?.id, "gpt-4o");
  assert.equal(reduceModelPicker(state, key({ ctrl: true, input: "c" })).effect, "close");
  const enter = pushConsoleChunk(emptyDecodeState(), "\r").keys[0];
  assert.ok(enter);
  assert.equal(reduceModelPicker(state, enter).effect, "select");
});

test("anthropic suggestions stay on claude ids and the current model is listed once", () => {
  const rows = modelChoices("claude-sonnet-4-5", "anthropic", ["claude-sonnet-4-5", " custom "]);
  assert.equal(rows.filter((row) => row.id === "claude-sonnet-4-5").length, 1);
  assert.equal(rows[0]?.detail, "current");
  assert.ok(rows.some((row) => row.id === "custom" && row.detail === "configured"));
  assert.equal(rows.some((row) => row.id.startsWith("gpt-")), false);
  assert.equal(bareModelQuery("/mod"), false);
  const windowed = modelWindow(rows.map((row) => row.id), rows.length - 1, 3);
  assert.equal(windowed.rows.length, 3);
  assert.equal(windowed.rows[windowed.selected], rows[rows.length - 1]?.id);
  assert.equal(modelHint({ choices: [], selected: 0 }), "no models");
});
