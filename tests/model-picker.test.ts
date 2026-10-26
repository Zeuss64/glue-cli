import assert from "node:assert/strict";
import test from "node:test";
import { bareModelQuery, formatModelStatus, modelChoices, modelHint, reduceModelPicker } from "../src/tui/model-picker.js";
import type { KeyIn } from "../src/tui/editor.js";

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
