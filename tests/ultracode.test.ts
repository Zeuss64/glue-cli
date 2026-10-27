import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSpawnedSubagent, spawnSubagentTool, toolsForSession } from "../src/agent/subagent.js";
import type { AgentHooks } from "../src/agent/loop.js";
import {
  applyEffortChoice,
  anthropicOutputConfig,
  EFFORT_CYCLE,
  effortBlurb,
  effortColor,
  effortStatusLabel,
  parseEffortCommand,
} from "../src/effort.js";
import type { LlmClient } from "../src/llm/client.js";
import { buildSystemPrompt, ultracodeWorkflow } from "../src/prompt.js";
import { Sandbox } from "../src/sandbox.js";
import { executeTool, type ToolContext } from "../src/tools/execute.js";
import { effortKnobAligned, EFFORT_PICKER_LEVELS } from "../src/tui/effort-picker.js";
import { pickerSurface } from "../src/tui/keys.js";
import type { ToolDef } from "../src/types.js";

test("ultracode maps onto max and does not replace the named levels", () => {
  assert.deepEqual(applyEffortChoice("ultracode"), { effort: "max", ultracode: true });
  assert.deepEqual(applyEffortChoice("max"), { effort: "max", ultracode: false });
  assert.deepEqual(applyEffortChoice("high"), { effort: "high", ultracode: false });
  assert.deepEqual(applyEffortChoice("auto"), { effort: "auto", ultracode: false });
  assert.deepEqual(anthropicOutputConfig(applyEffortChoice("ultracode").effort), { effort: "max" });
  assert.equal(anthropicOutputConfig("auto"), undefined);
  assert.deepEqual(anthropicOutputConfig("low"), { effort: "low" });
  assert.deepEqual([...EFFORT_CYCLE], ["auto", "low", "medium", "high", "xhigh", "max"]);
  assert.equal(effortStatusLabel("high", false), "high");
  assert.equal(effortStatusLabel("high", true), "high · ultracode");
  assert.match(effortBlurb("ultracode"), /dynamic workflows on every task/);
  assert.equal(parseEffortCommand("").kind, "picker");
  assert.deepEqual(parseEffortCommand("ultracode"), { kind: "ultracode-on" });
  assert.equal(pickerSurface("alt-p"), "model-effort");
  assert.deepEqual(parseEffortCommand("ULTRACODE off"), { kind: "ultracode-off" });
  assert.deepEqual(parseEffortCommand("high"), { kind: "set", effort: "high", ultracode: false });
  assert.equal(parseEffortCommand("nope").kind, "invalid");
  const prompt = buildSystemPrompt({
    workspace: "/tmp/glue",
    profile: "default",
    permissionMode: "default",
    shellEnabled: false,
    outputStyle: "normal",
    ultracode: true,
  });
  assert.equal(prompt.includes(ultracodeWorkflow()), true);
  assert.match(prompt, /Ultracode: dynamic workflows on every task/);
  assert.match(prompt, /On every task, run a multi-step workflow/);
  assert.match(prompt, /prefer spawn_subagent/);
  const off = buildSystemPrompt({
    workspace: "/tmp/glue",
    profile: "default",
    permissionMode: "default",
    shellEnabled: false,
    outputStyle: "normal",
    ultracode: false,
  });
  assert.equal(off.includes("Ultracode: dynamic workflows on every task"), false);
  assert.equal(off.includes("spawn_subagent"), false);
  const tool = spawnSubagentTool();
  assert.match(tool.description, /Ultracode: dynamic workflows on every task/);
  assert.match(tool.description, /independent step/);
});

test("max effort color shimmers and the knob stays on the highlighted stop", () => {
  assert.notEqual(effortColor("max", 0), effortColor("max", 1));
  assert.equal(effortColor("low", 0), effortColor("low", 4));
  assert.notEqual(effortColor("low", 0), effortColor("medium", 0));
  assert.notEqual(effortColor("medium", 0), effortColor("high", 0));
  assert.notEqual(effortColor("high", 0), effortColor("xhigh", 0));
  assert.notEqual(effortColor("xhigh", 0), effortColor("max", 0));
  for (let index = 0; index < EFFORT_PICKER_LEVELS.length; index += 1) {
    assert.equal(effortKnobAligned([...EFFORT_PICKER_LEVELS], index), true);
  }
});

test("spawn_subagent is offered only while ultracode is on and cannot nest", async () => {
  const off = toolsForSession(false, false).map((tool) => tool.name);
  const on = toolsForSession(true, true).map((tool) => tool.name);
  assert.equal(off.includes("spawn_subagent"), false);
  assert.equal(on.includes("spawn_subagent"), true);
  assert.equal(on.includes("run_shell"), true);

  const workspace = mkdtempSync(path.join(tmpdir(), "glue-ultra-"));
  const ctx: ToolContext = {
    sandbox: new Sandbox([workspace]),
    shellEnabled: false,
    shellCwd: workspace,
    readFiles: new Set(),
    todos: [],
    tasks: new Map(),
  };
  const blocked = await executeTool("spawn_subagent", { prompt: "look around" }, ctx);
  assert.equal(blocked.ok, false);
  assert.match(blocked.output, /UltraCode/);

  ctx.spawnSubagent = async (prompt) => `done: ${prompt}`;
  const ran = await executeTool("spawn_subagent", { prompt: "map the auth checks" }, ctx);
  assert.equal(ran.ok, true);
  assert.match(ran.output, /map the auth checks/);

  let childTools: ToolDef[] = [];
  const client: LlmClient = {
    async stream(_messages, tools, _signal, onDelta) {
      childTools = tools;
      onDelta({ text: "auth looks fine" });
      return { text: "auth looks fine", toolCalls: [], usage: { input: 1, output: 2 }, finishReason: "stop" };
    },
  };
  const hooks: AgentHooks = {
    askPermission: async () => ({ decision: "allow" }),
    askUser: async () => "ok",
    askPlan: async () => ({ approved: true }),
    getMode: () => "default",
    setMode: () => {},
    getRules: () => ({ allow: [], deny: [], ask: [] }),
    addRule: () => {},
  };
  const report = await runSpawnedSubagent({
    client,
    task: "check auth",
    ctx,
    shellEnabled: true,
    hooks,
    maxSteps: 4,
    workspace,
  });
  assert.equal(report, "auth looks fine");
  assert.equal(childTools.some((tool) => tool.name === "spawn_subagent"), false);
  assert.equal(childTools.some((tool) => tool.name === "read_file"), true);
});
