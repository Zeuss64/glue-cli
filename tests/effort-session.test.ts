import assert from "node:assert/strict";
import test from "node:test";
import { anthropicOutputConfig, cycleEffort, effortPromptLine, type EffortLevel } from "../src/effort.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { openEffortPicker, reduceEffortPicker } from "../src/tui/effort-picker.js";
import { openModelPicker, reduceModelPicker } from "../src/tui/model-picker.js";

function promptFor(effort: EffortLevel, ultracode = false): string {
  return buildSystemPrompt({
    workspace: "/tmp/glue",
    profile: "default",
    permissionMode: "default",
    shellEnabled: false,
    outputStyle: "normal",
    effort,
    ultracode,
  });
}

test("the system prompt names the live input-box effort, not a hardcoded max", () => {
  const auto = promptFor("auto");
  assert.match(auto, /Current session reasoning effort: auto/);
  assert.doesNotMatch(auto, /Absolute maximum/);
  assert.equal(auto.includes(effortPromptLine("auto")), true);
  assert.equal(anthropicOutputConfig("auto"), undefined);

  const low = promptFor("low");
  assert.match(low, /Current session reasoning effort: low/);
  assert.doesNotMatch(low, /Current session reasoning effort: auto/);
  assert.doesNotMatch(low, /Absolute maximum/);
  assert.deepEqual(anthropicOutputConfig("low"), { effort: "low" });

  const max = promptFor("max");
  assert.match(max, /Current session reasoning effort: max/);
  assert.doesNotMatch(max, /Absolute maximum/);
  assert.doesNotMatch(max, /no shortcuts permitted/i);
  assert.deepEqual(anthropicOutputConfig("max"), { effort: "max" });
});

test("an input-box effort change is what the prompt and Anthropic payload both use", () => {
  let effort: EffortLevel = "auto";
  const cycle = reduceModelPicker(openModelPicker("sensenova-6.8-flash-lite", [], effort), { right: true });
  assert.equal(cycle.effect?.type, "effort");
  if (cycle.effect?.type === "effort") effort = cycle.effect.effort;
  assert.equal(effort, "low");
  assert.equal(effort, cycleEffort("auto", 1));

  const after = promptFor(effort);
  assert.match(after, /Current session reasoning effort: low/);
  assert.doesNotMatch(after, /Current session reasoning effort: auto/);
  assert.doesNotMatch(after, /Absolute maximum/);
  assert.deepEqual(anthropicOutputConfig(effort), { effort: "low" });

  const opened = openEffortPicker("auto");
  assert.equal(opened.levels[opened.selected], "high");
  const moved = reduceEffortPicker(opened, { left: true });
  const overlay = reduceEffortPicker(moved.state, { return: true });
  assert.equal(overlay.effect?.type, "select");
  if (overlay.effect?.type !== "select") return;
  assert.equal(overlay.effect.effort, "medium");
  const selected = overlay.effect.effort;
  const fromOverlay = promptFor(selected, overlay.effect.ultracode);
  assert.equal(fromOverlay.includes(effortPromptLine(selected, overlay.effect.ultracode)), true);
  assert.match(fromOverlay, /Current session reasoning effort: medium/);
  assert.deepEqual(anthropicOutputConfig(selected), { effort: "medium" });
});

test("omitted effort is auto, and ultracode only adds the flag beside the live level", () => {
  const omitted = buildSystemPrompt({
    workspace: "/tmp/glue",
    profile: "default",
    permissionMode: "default",
    shellEnabled: false,
    outputStyle: "normal",
  });
  assert.match(omitted, /Current session reasoning effort: auto/);
  const ultra = promptFor("high", true);
  assert.match(ultra, /Current session reasoning effort: high · ultracode/);
  assert.deepEqual(anthropicOutputConfig("high"), { effort: "high" });
});
