import type { AgentHooks } from "./loop.js";
import { runAgentTurn } from "./loop.js";
import type { LlmClient } from "../llm/client.js";
import { toolDefinitions } from "../tools/defs.js";
import type { ToolContext } from "../tools/execute.js";
import type { ChatMessage, ToolDef } from "../types.js";

export const SPAWN_SUBAGENT = "spawn_subagent";

export function spawnSubagentTool(): ToolDef {
  return {
    name: SPAWN_SUBAGENT,
    description:
      "Dispatch one subagent for an independent subtask. Available only while UltraCode is on (max thinking plus subagent dispatch). The subagent cannot spawn another subagent. Pass a self-contained prompt and wait for its report.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: { type: "string", description: "What the subagent should do and what it should report back." },
        read_only: { type: "boolean", description: "When true, the subagent may not edit files or run mutating commands." },
      },
    },
  };
}

/** Session tools. `spawn_subagent` is added only while UltraCode is on. */
export function toolsForSession(shellEnabled: boolean, ultracode: boolean): ToolDef[] {
  const tools = toolDefinitions(shellEnabled);
  if (ultracode) tools.push(spawnSubagentTool());
  return tools;
}

export function subagentSystem(workspace: string): string {
  return [
    "You are a Glue subagent dispatched by the parent session.",
    "Finish the assigned subtask and report the result. Do not spawn further subagents.",
    "Use tools to inspect the workspace. Do not invent file contents or command output.",
    `Workspace: ${workspace}`,
  ].join("\n");
}

/**
 * Run one subagent turn. The child tool list never includes `spawn_subagent`.
 * Text stays in the returned report. Tool events are forwarded with a subagent prefix.
 */
export async function runSpawnedSubagent(opts: {
  client: LlmClient;
  task: string;
  ctx: ToolContext;
  shellEnabled: boolean;
  readOnly?: boolean;
  hooks: AgentHooks;
  maxSteps: number;
  signal?: AbortSignal;
  workspace: string;
}): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: subagentSystem(opts.workspace) },
    { role: "user", content: opts.task },
  ];
  let report = "";
  const childCtx: ToolContext = { ...opts.ctx, spawnSubagent: undefined };
  await runAgentTurn({
    client: opts.client,
    messages,
    tools: toolDefinitions(opts.shellEnabled),
    ctx: childCtx,
    maxSteps: Math.max(1, Math.min(8, opts.maxSteps)),
    signal: opts.signal,
    readOnly: opts.readOnly === true,
    hooks: {
      ...opts.hooks,
      onTextDelta: (text) => {
        report += text;
      },
      onSegmentDone: (text) => {
        if (text.trim()) report = text;
      },
      onToolStart: (event) => opts.hooks.onToolStart?.({ ...event, name: `subagent ${event.name}` }),
      onToolEnd: (event) => opts.hooks.onToolEnd?.({ ...event, name: `subagent ${event.name}` }),
    },
  });
  return report.trim() || "(subagent returned no text)";
}
