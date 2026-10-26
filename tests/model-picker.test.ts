import assert from "node:assert/strict";
import test from "node:test";
import { cycleEffort } from "../src/effort.js";
import {
  bareModelQuery,
  isModelDraft,
  modelChoices,
  modelPosition,
  modelWindow,
  openModelPicker,
  reduceModelPicker,
  SUGGESTED_MODELS,
  type ModelPickerState,
} from "../src/tui/model-picker.js";

test("one model still opens a list that can move, select, and cancel", () => {
  const state = openModelPicker("solo", [], "auto");
  const only = { ...state, items: ["solo"], selected: 0 };
  assert.deepEqual(modelChoices("solo", [], []), ["solo"]);
  assert.equal(modelPosition(only), "1/1 · solo");
  assert.equal(reduceModelPicker(only, { down: true }).state.selected, 0);
  assert.equal(reduceModelPicker(only, { up: true }).state.selected, 0);
  assert.deepEqual(reduceModelPicker(only, { return: true }).effect, { type: "select", model: "solo" });
  assert.equal(reduceModelPicker(only, { escape: true }).effect?.type, "cancel");
  assert.equal(reduceModelPicker(only, { ctrlC: true }).effect?.type, "cancel");
});

test("choices put the current model first, then config, then suggestions, once each", () => {
  const items = modelChoices("gpt-4o", ["gpt-4o-mini", "gpt-4o", "  "]);
  assert.equal(items[0], "gpt-4o");
  assert.equal(items[1], "gpt-4o-mini");
  assert.equal(new Set(items).size, items.length);
  assert.ok(items.includes("claude-sonnet-4-5"));
  assert.deepEqual(items.slice(0, 2), ["gpt-4o", "gpt-4o-mini"]);
  for (const id of SUGGESTED_MODELS) assert.ok(items.includes(id));
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
