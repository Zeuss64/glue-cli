import assert from "node:assert/strict";
import test from "node:test";
import { effortPickerMark, openEffortPicker, reduceEffortPicker, EFFORT_PICKER_LEVELS } from "../src/tui/effort-picker.js";

test("bare /effort opens on the current level and left/right stop at the ends", () => {
  assert.deepEqual(EFFORT_PICKER_LEVELS, ["low", "medium", "high", "xhigh", "max", "auto"]);
  let state = openEffortPicker("high");
  assert.equal(effortPickerMark(state), "low  medium  [high]  xhigh  max  auto");
  state = reduceEffortPicker(state, { left: true }).state;
  assert.equal(state.levels[state.selected], "medium");
  state = reduceEffortPicker(state, { right: true }).state;
  state = reduceEffortPicker(state, { right: true }).state;
  assert.equal(state.levels[state.selected], "xhigh");
  let edge = openEffortPicker("low");
  edge = reduceEffortPicker(edge, { left: true }).state;
  assert.equal(edge.selected, 0);
  edge = openEffortPicker("auto");
  edge = reduceEffortPicker(edge, { right: true }).state;
  assert.equal(edge.levels[edge.selected], "auto");
});

test("enter sets the highlighted level and esc cancels", () => {
  const state = reduceEffortPicker(openEffortPicker("max"), { left: true }).state;
  assert.deepEqual(reduceEffortPicker(state, { return: true }).effect, { type: "select", effort: "xhigh" });
  assert.equal(reduceEffortPicker(state, { escape: true }).effect?.type, "cancel");
  assert.equal(reduceEffortPicker(state, { ctrlC: true }).effect?.type, "cancel");
  assert.equal(reduceEffortPicker(openEffortPicker("auto"), { return: true }).effect?.type, "select");
  const picked = reduceEffortPicker(openEffortPicker("low"), { return: true }).effect;
  assert.deepEqual(picked, { type: "select", effort: "low" });
});
