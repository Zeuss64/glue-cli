import { runAgentTurn, type AgentHooks, type PermissionChoice, type PermissionPrompt } from "./agent/loop.js";
import { runSpawnedSubagent, toolsForSession } from "./agent/subagent.js";
import { ensureGlobalConfigForSession, type AppConfig } from "./config.js";
import { createLlmClient } from "./llm/client.js";
import { buildSystemPrompt } from "./prompt.js";
import { displayName, formatDiffPlain } from "./render/format.js";
import { Sandbox } from "./sandbox.js";
import type { ToolContext } from "./tools/execute.js";
import type { ChatMessage, TokenUsage } from "./types.js";

const orange = (s: string) => (process.env.NO_COLOR ? s : `\x1b[38;5;173m${s}\x1b[0m`);
const dim = (s: string) => (process.env.NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`);
const bold = (s: string) => (process.env.NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`);

export async function runPrint(opts: {
  config: AppConfig;
  prompt: string;
  output?: "text" | "json";
  readOnly?: boolean;
  messages?: ChatMessage[];
}): Promise<number> {
  ensureGlobalConfigForSession();
  const json = opts.output === "json";
  const sandbox = new Sandbox([opts.config.workspace]);
  const ctx: ToolContext = {
    sandbox,
    shellEnabled: opts.config.shellEnabled,
    shellCwd: sandbox.primary,
    readFiles: new Set(),
    todos: [],
    tasks: new Map(),
  };
  const messages: ChatMessage[] = opts.messages?.length
    ? opts.messages
    : [{ role: "system", content: buildSystemPrompt(opts.config) }];
  if (!messages.some((message) => message.role === "system")) {
    messages.unshift({ role: "system", content: buildSystemPrompt(opts.config) });
  }
  messages.push({ role: "user", content: opts.prompt });
  const client = createLlmClient(opts.config);
  const usage: TokenUsage = { input: 0, output: 0 };
  let atLineStart = true;
  const emit = (event: Record<string, unknown>) => {
    if (json) process.stdout.write(JSON.stringify(event) + "\n");
  };
  const hooks: AgentHooks = {
    onTextDelta(text) {
      if (json) emit({ type: "text-delta", text });
      else {
        process.stdout.write(text);
        atLineStart = text.endsWith("\n");
      }
    },
    onSegmentDone() {
      if (!json && !atLineStart) {
        process.stdout.write("\n");
        atLineStart = true;
      }
    },
    onToolStart(event) {
      if (json) return;
      if (!atLineStart) process.stdout.write("\n");
      process.stdout.write(`${orange("⏺")} ${bold(displayName(event.name))}${dim(event.target ? `(${event.target})` : "")}\n`);
      atLineStart = true;
    },
    onToolEnd(event) {
      if (json) {
        emit({ type: "tool", name: event.name, target: event.target, status: event.denied ? "denied" : event.ok ? "ok" : "error", summary: event.summary });
        return;
      }
      process.stdout.write(dim(`  ⎿  ${event.summary}\n`));
      if (event.diff?.length) process.stdout.write(dim(formatDiffPlain(event.diff)) + "\n");
      atLineStart = true;
    },
    onUsage(part) {
      usage.input += part.input;
      usage.output += part.output;
    },
    onNotice(text) {
      if (json) emit({ type: "notice", text });
      else process.stdout.write(dim(text) + "\n");
    },
    askPermission(prompt: PermissionPrompt): Promise<PermissionChoice> {
      const hint = `Needs approval (${prompt.title}: ${prompt.target}). Print mode cannot prompt. Re-run with --permission-mode acceptEdits, an allow rule, or --dangerously-skip-permissions.`;
      return Promise.resolve({ decision: "deny", feedback: hint });
    },
    askUser() {
      return Promise.resolve("No interactive user is available. Proceed with the safest option.");
    },
    askPlan() {
      return Promise.resolve({ approved: false, feedback: "Print mode cannot approve a plan. Use an interactive session or --permission-mode acceptEdits." });
    },
    getMode: () => opts.config.permissionMode,
    setMode(mode) {
      opts.config.permissionMode = mode;
    },
    getApproval: () => opts.config.approval,
    getRules: () => opts.config.permissions,
    addRule(kind, rule) {
      opts.config.permissions[kind].push(rule);
    },
  };
  if (opts.config.ultracode) {
    ctx.spawnSubagent = (prompt, readOnly) =>
      runSpawnedSubagent({
        client: createLlmClient({ ...opts.config, effort: opts.config.effort }),
        task: prompt,
        ctx,
        shellEnabled: opts.config.shellEnabled && !readOnly,
        readOnly,
        hooks,
        maxSteps: opts.config.maxSteps,
        workspace: opts.config.workspace,
      });
  }
  try {
    const result = await runAgentTurn({
      client,
      messages,
      tools: toolsForSession(opts.config.shellEnabled, opts.config.ultracode),
      ctx,
      maxSteps: opts.config.maxSteps,
      readOnly: opts.readOnly,
      hooks,
    });
    if (json) emit({ type: "done", aborted: result.aborted, usage });
    else if (process.stderr.isTTY && (usage.input || usage.output)) {
      process.stderr.write(dim(`${usage.input} in · ${usage.output} out`) + "\n");
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) emit({ type: "error", message });
    else process.stderr.write(`glue: ${message}\n`);
    return 1;
  }
}
