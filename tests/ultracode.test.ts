import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSpawnedSubagent, toolsForSession } from "../src/agent/subagent.js";
import type { AgentHooks } from "../src/agent/loop.js";
import {
  applyEffortChoice,
  anthropicOutputConfig,
  EFFORT_CYCLE,
  effortBlurb,
  effortStatusLabel,
  parseEffortCommand,
} from "../src/effort.js";
import type { LlmClient } from "../src/llm/client.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { Sandbox } from "../src/sandbox.js";
import { executeTool, type ToolContext } from "../src/tools/execute.js";
import { effortSliderTrack } from "../src/tui/effort-picker.js";
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
  assert.equal(effortStatusLabel("max", true), "ultracode · max + subagents");
  assert.match(effortBlurb("ultracode"), /max thinking \+ subagent dispatch/);
  assert.equal(parseEffortCommand("").kind, "picker");
  assert.deepEqual(parseEffortCommand("ultracode"), { kind: "set", effort: "max", ultracode: true });
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
  assert.match(prompt, /spawn_subagent/);
  assert.match(prompt, /UltraCode is on/);
});

test("the effort slider puts a knob on the highlighted stop", () => {
  assert.equal(effortSliderTrack(3, 1), "○────●────○");
  assert.equal(effortSliderTrack(1, 0), "●");
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
