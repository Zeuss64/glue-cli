import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgentTurn, type AgentHooks, type PermissionChoice } from "../src/agent/loop.js";
import type { LlmClient } from "../src/llm/client.js";
import { emptyRules } from "../src/permissions.js";
import { Sandbox } from "../src/sandbox.js";
import type { ToolContext } from "../src/tools/execute.js";
import type { ChatMessage, LlmResult, PermissionMode, PermissionRules } from "../src/types.js";

function toolResult(name: string, args: Record<string, unknown>, id = "call_1"): LlmResult {
  return {
    text: "",
    toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
    usage: { input: 1, output: 1 },
    finishReason: "tool_calls",
  };
}

function textResult(text: string): LlmResult {
  return { text, toolCalls: [], usage: { input: 1, output: 1 }, finishReason: "stop" };
}

function scripted(results: LlmResult[]): LlmClient {
  let index = 0;
  return {
    async stream(_messages, _tools, _signal, onDelta) {
      const result = results[index++] ?? textResult("");
      if (result.text) onDelta({ text: result.text });
      return result;
    },
  };
}

function harness(mode: PermissionMode, choice: PermissionChoice = { decision: "deny" }) {
  const root = mkdtempSync(path.join(tmpdir(), "glue-loop-"));
  const sandbox = new Sandbox([root]);
  const ctx: ToolContext = {
    sandbox,
    shellEnabled: false,
    shellCwd: sandbox.primary,
    readFiles: new Set(),
    todos: [],
    tasks: new Map(),
  };
  const rules: PermissionRules = emptyRules();
  let current = mode;
  const summaries: string[] = [];
  const hooks: AgentHooks = {
    onToolEnd(event) {
      summaries.push(event.summary);
    },
    askPermission: async () => choice,
    askUser: async () => "Other",
    askPlan: async () => ({ approved: true }),
    getMode: () => current,
    setMode(next) {
      current = next;
    },
    getRules: () => rules,
    addRule(kind, rule) {
      rules[kind].push(rule);
    },
  };
  const messages: ChatMessage[] = [{ role: "user", content: "go" }];
  return { root, ctx, hooks, messages, summaries, mode: () => current, rules };
}

test("acceptEdits writes a new file and plan mode refuses the same write", async () => {
  const allowed = harness("acceptEdits");
  await runAgentTurn({
    client: scripted([
      toolResult("write_file", { path: "hello.txt", content: "hello from glue\n" }),
      textResult("Created hello.txt"),
    ]),
    messages: allowed.messages,
    tools: [],
    ctx: allowed.ctx,
    maxSteps: 4,
    hooks: allowed.hooks,
  });
  assert.equal(readFileSync(path.join(allowed.root, "hello.txt"), "utf8"), "hello from glue\n");
  assert.match(allowed.summaries[0] ?? "", /Wrote hello.txt/);

  const planned = harness("plan");
  await runAgentTurn({
    client: scripted([toolResult("write_file", { path: "nope.txt", content: "x\n" }), textResult("blocked")]),
    messages: planned.messages,
    tools: [],
    ctx: planned.ctx,
    maxSteps: 4,
    hooks: planned.hooks,
  });
  assert.equal(existsSync(path.join(planned.root, "nope.txt")), false);
  assert.equal(planned.summaries[0], "Denied");
});

test("edit_file requires a prior read, then applies a unique replacement", async () => {
  const box = harness("acceptEdits");
  writeFileSync(path.join(box.root, "note.txt"), "alpha\n");
  await runAgentTurn({
    client: scripted([
      toolResult("edit_file", { path: "note.txt", old_string: "alpha", new_string: "beta" }, "call_edit"),
      textResult("failed"),
    ]),
    messages: box.messages,
    tools: [],
    ctx: box.ctx,
    maxSteps: 3,
    hooks: box.hooks,
  });
  assert.match(box.summaries[0] ?? "", /Read note.txt/);
  assert.equal(readFileSync(path.join(box.root, "note.txt"), "utf8"), "alpha\n");

  const again = harness("default", { decision: "allow" });
  writeFileSync(path.join(again.root, "note.txt"), "alpha\n");
  await runAgentTurn({
    client: scripted([
      toolResult("read_file", { path: "note.txt" }, "call_read"),
      toolResult("edit_file", { path: "note.txt", old_string: "alpha", new_string: "beta" }, "call_edit"),
      textResult("updated"),
    ]),
    messages: again.messages,
    tools: [],
    ctx: again.ctx,
    maxSteps: 5,
    hooks: again.hooks,
  });
  assert.equal(readFileSync(path.join(again.root, "note.txt"), "utf8"), "beta\n");
});
