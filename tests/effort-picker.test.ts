import assert from "node:assert/strict";
import { createElement } from "react";
import { render } from "ink-testing-library";
import test from "node:test";
import { EFFORT_PICKER } from "../src/effort.js";
import { openEffortPicker, reduceEffortPicker } from "../src/tui/effort-picker.js";
import { EffortPicker, TranscriptView } from "../src/tui/components.js";
import { THEMES } from "../src/tui/theme.js";
import { layoutTranscript, rowText } from "../src/tui/viewport.js";

test("left and right move the effort picker and enter applies", () => {
  let state = openEffortPicker("high");
  assert.deepEqual(state.levels, [...EFFORT_PICKER]);
  assert.equal(state.levels[state.selected], "high");
  state = reduceEffortPicker(state, { left: true }).state;
  assert.equal(state.levels[state.selected], "medium");
  state = reduceEffortPicker(state, { left: true }).state;
  state = reduceEffortPicker(state, { left: true }).state;
  assert.equal(state.levels[state.selected], "low");
  state = reduceEffortPicker(state, { left: true }).state;
  assert.equal(state.levels[state.selected], "low");
  const end = reduceEffortPicker(openEffortPicker("auto"), { right: true });
  assert.equal(end.state.levels[end.state.selected], "auto");
  assert.equal(end.effect, undefined);
  const chosen = reduceEffortPicker(openEffortPicker("max"), { return: true });
  assert.deepEqual(chosen.effect, { type: "select", effort: "max" });
  assert.equal(reduceEffortPicker(state, { escape: true }).effect?.type, "cancel");
  assert.equal(reduceEffortPicker(state, { ctrlC: true }).effect?.type, "cancel");
});

test("the effort picker renders every level and the transcript stays inside its row budget", () => {
  const theme = THEMES.ansi;
  const view = render(
    createElement(EffortPicker, {
      theme,
      levels: [...EFFORT_PICKER],
      selected: EFFORT_PICKER.indexOf("high"),
    }),
  );
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /Effort/);
  for (const level of EFFORT_PICKER) assert.match(frame, new RegExp(level));
  assert.match(frame, /❯ high/);
  assert.match(frame, /enter apply/);
  assert.match(frame, /esc cancel/);
  view.unmount();

  const laid = layoutTranscript(
    [
      { id: "u", type: "user", text: "hi" },
      { id: "a", type: "assistant", text: Array.from({ length: 12 }, (_, index) => `row ${index}`).join("\n") },
    ],
    40,
    5,
    0,
  );
  assert.ok(laid.rows.length <= 5);
  const transcript = render(createElement(TranscriptView, { theme, rows: laid.rows }));
  const painted = (transcript.lastFrame() ?? "").replace(/\s+$/, "").split("\n");
  assert.equal(painted.length, laid.rows.length);
  assert.match(painted.join("\n"), /row 11/);
  assert.equal(painted.some((line) => line.includes(rowText(laid.rows[0] ?? { key: "", parts: [] }))), true);
  transcript.unmount();
});
