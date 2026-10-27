import assert from "node:assert/strict";
import test from "node:test";
import { effortKnobAligned, effortTrackLines, openEffortPicker, reduceEffortPicker, EFFORT_PICKER_LEVELS } from "../src/tui/effort-picker.js";

test("bare /effort opens on the current level and left/right stop at the ends", () => {
  assert.deepEqual(EFFORT_PICKER_LEVELS, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(EFFORT_PICKER_LEVELS.includes("ultracode" as never), false);
  let state = openEffortPicker("high");
  assert.equal(state.levels[state.selected], "high");
  assert.equal(state.ultracode, false);
  state = reduceEffortPicker(state, { left: true }).state;
  assert.equal(state.levels[state.selected], "medium");
  state = reduceEffortPicker(state, { right: true }).state;
  state = reduceEffortPicker(state, { right: true }).state;
  assert.equal(state.levels[state.selected], "xhigh");
  let edge = openEffortPicker("low");
  edge = reduceEffortPicker(edge, { left: true }).state;
  assert.equal(edge.selected, 0);
  edge = openEffortPicker("max");
  edge = reduceEffortPicker(edge, { right: true }).state;
  assert.equal(edge.levels[edge.selected], "max");
  assert.equal(openEffortPicker("auto").levels[openEffortPicker("auto").selected], "high");
});

test("enter confirms the highlighted level and esc cancels", () => {
  const state = reduceEffortPicker(openEffortPicker("max"), { left: true }).state;
  assert.deepEqual(reduceEffortPicker(state, { return: true }).effect, { type: "select", effort: "xhigh", ultracode: false });
  assert.equal(reduceEffortPicker(state, { escape: true }).effect?.type, "cancel");
  assert.equal(reduceEffortPicker(state, { ctrlC: true }).effect?.type, "cancel");
  const picked = reduceEffortPicker(openEffortPicker("low"), { return: true }).effect;
  assert.deepEqual(picked, { type: "select", effort: "low", ultracode: false });
});

test("tab toggles ultracode without moving the level, and the knob stays on that level", () => {
  let state = openEffortPicker("high", true);
  assert.equal(state.ultracode, true);
  assert.equal(state.levels[state.selected], "high");
  state = reduceEffortPicker(state, { tab: true }).state;
  assert.equal(state.ultracode, false);
  assert.equal(state.levels[state.selected], "high");
  state = reduceEffortPicker(state, { tab: true }).state;
  assert.equal(state.ultracode, true);
  state = reduceEffortPicker(state, { right: true }).state;
  assert.equal(state.levels[state.selected], "xhigh");
  assert.equal(state.ultracode, true);
  assert.deepEqual(reduceEffortPicker(state, { return: true }).effect, { type: "select", effort: "xhigh", ultracode: true });
  for (let index = 0; index < EFFORT_PICKER_LEVELS.length; index += 1) {
    assert.equal(effortKnobAligned([...EFFORT_PICKER_LEVELS], index), true, EFFORT_PICKER_LEVELS[index]);
  }
  const lines = effortTrackLines([...EFFORT_PICKER_LEVELS], 4);
  assert.match(lines.labels, /max/);
  assert.doesNotMatch(lines.labels, /ultracode/);
  assert.match(lines.track, /▲/);
});
