import assert from "node:assert/strict";
import test from "node:test";
import { effortPickerMark, openEffortPicker, reduceEffortPicker, EFFORT_PICKER_LEVELS } from "../src/tui/effort-picker.js";

test("bare /effort opens on the current level and left/right stop at the ends", () => {
  assert.deepEqual(EFFORT_PICKER_LEVELS, ["low", "medium", "high", "xhigh", "max", "ultracode", "auto"]);
  let state = openEffortPicker("high");
  assert.equal(effortPickerMark(state), "low  medium  [high]  xhigh  max  ultracode  auto");
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
  assert.deepEqual(reduceEffortPicker(state, { return: true }).effect, { type: "select", choice: "xhigh" });
  assert.equal(reduceEffortPicker(state, { escape: true }).effect?.type, "cancel");
  assert.equal(reduceEffortPicker(state, { ctrlC: true }).effect?.type, "cancel");
  assert.equal(reduceEffortPicker(openEffortPicker("auto"), { return: true }).effect?.type, "select");
  const picked = reduceEffortPicker(openEffortPicker("low"), { return: true }).effect;
  assert.deepEqual(picked, { type: "select", choice: "low" });
});

test("tab jumps to ultracode and enter accepts max plus subagents", () => {
  let state = openEffortPicker("high");
  state = reduceEffortPicker(state, { tab: true }).state;
  assert.equal(state.levels[state.selected], "ultracode");
  state = reduceEffortPicker(state, { tab: true }).state;
  assert.equal(state.levels[state.selected], "max");
  const fromMax = reduceEffortPicker(openEffortPicker("max"), { right: true }).state;
  assert.equal(fromMax.levels[fromMax.selected], "ultracode");
  assert.deepEqual(reduceEffortPicker(fromMax, { return: true }).effect, { type: "select", choice: "ultracode" });
  assert.equal(openEffortPicker("max", true).levels[openEffortPicker("max", true).selected], "ultracode");
  const parked = openEffortPicker("low");
  assert.equal(reduceEffortPicker(parked, { left: true }).state.selected, 0);
});
