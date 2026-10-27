import assert from "node:assert/strict";
import test from "node:test";
import { cycleEffort } from "../src/effort.js";
import {
  bareModelQuery,
  isModelDraft,
  modelChoices,
  modelPosition,
  modelListLines,
  modelWindow,
  openModelPicker,
  reduceModelPicker,
  SUGGESTED_MODELS,
  type ModelPickerState,
} from "../src/tui/model-picker.js";

test("one model still opens a list that can move, select, and cancel", () => {
  const state = openModelPicker("solo", [], "auto");
  assert.deepEqual(state.items, ["solo"]);
  assert.equal(modelPosition(state), "1/1 · solo");
  assert.equal(reduceModelPicker(state, { down: true }).state.selected, 0);
  assert.equal(reduceModelPicker(state, { up: true }).state.selected, 0);
  assert.deepEqual(reduceModelPicker(state, { return: true }).effect, { type: "select", model: "solo" });
  assert.equal(reduceModelPicker(state, { escape: true }).effect?.type, "cancel");
  assert.equal(reduceModelPicker(state, { ctrlC: true }).effect?.type, "cancel");
});

test("the list is the configured models, or only the current id when models is empty", () => {
  assert.deepEqual(modelChoices("sensenova-6.8-flash-lite", []), ["sensenova-6.8-flash-lite"]);
  const items = modelChoices("sensenova-6.8-flash-lite", ["sensenova-6.8-flash", "sensenova-6.8-flash-lite", "  "]);
  assert.deepEqual(items, ["sensenova-6.8-flash-lite", "sensenova-6.8-flash"]);
  for (const id of SUGGESTED_MODELS) assert.equal(items.includes(id), false);
  const withCurrent = modelChoices("gpt-4o", ["gpt-4o-mini", "gpt-4o"]);
  assert.deepEqual(withCurrent, ["gpt-4o", "gpt-4o-mini"]);
  assert.equal(new Set(withCurrent).size, withCurrent.length);
  const opted = modelChoices("solo", [], ["extra"]);
  assert.deepEqual(opted, ["solo", "extra"]);
});

test("arrows move the highlight, left and right cycle effort, and the hint is N/M", () => {
  const items = ["current", "config-a", "config-b", "s1", "s2", "s3"];
  let state: ModelPickerState = { items, selected: 0, effort: "auto" };
  state = reduceModelPicker(state, { down: true }).state;
  assert.equal(modelPosition(state), "2/6 · config-a");
  state = reduceModelPicker(state, { up: true }).state;
  assert.equal(state.selected, 0);
  state = reduceModelPicker(state, { up: true }).state;
  assert.equal(state.selected, items.length - 1);
  const right = reduceModelPicker(state, { right: true });
  assert.equal(right.effect?.type, "effort");
  assert.equal(right.state.effort, "low");
  assert.equal(right.state.selected, state.selected);
  const left = reduceModelPicker({ ...state, effort: "auto" }, { left: true });
  assert.equal(left.state.effort, "max");
  assert.equal(cycleEffort("high", 1), "xhigh");
  const window = modelWindow(items, 4, 3);
  assert.deepEqual(window.rows, items.slice(3, 6));
  assert.equal(window.selected, 1);
  assert.equal(window.start, 3);
});

test("model rows number the list, keep the check on the current id, and align descriptions", () => {
  const lines = modelListLines([
    { id: "solo", number: 1, current: true, focused: false, description: "Current session model" },
    { id: "other", number: 2, current: false, focused: true, description: "Configured id" },
  ]);
  assert.match(lines[0] ?? "", /1\. solo ✓/);
  assert.match(lines[1] ?? "", /^> 2\. other/);
  assert.equal((lines[0] ?? "").indexOf("Current session model"), (lines[1] ?? "").indexOf("Configured id"));
  assert.equal((lines[0] ?? "").startsWith(">"), false);
});

test("/model opens the picker and /model <id> does not", () => {
  assert.equal(isModelDraft("/model"), true);
  assert.equal(isModelDraft("/model "), false);
  assert.equal(isModelDraft("/model gpt-4o"), false);
  assert.equal(bareModelQuery("/model"), "picker");
  assert.equal(bareModelQuery("  /model  "), "picker");
  assert.deepEqual(bareModelQuery("/model gpt-4o"), { model: "gpt-4o" });
  assert.equal(bareModelQuery("/effort high"), null);
});
