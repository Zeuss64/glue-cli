import { existsSync, readFileSync, statSync } from "node:fs";
import { applyEdit } from "../edit.js";
import { bashAllowRule, decidePermission, type PermissionDecision } from "../permissions.js";
import { displayName, toolTarget } from "../render/format.js";
import { executeTool, type ToolContext, type ToolOutcome } from "../tools/execute.js";
import type { LlmClient } from "../llm/client.js";
import type { ChatMessage, DiffLine, PermissionMode, PermissionRules, ToolCall, ToolDef } from "../types.js";

export interface PermissionPrompt {
  tool: string;
  title: string;
  target: string;
  detail: string;
  allowLabel: string;
  diff?: DiffLine[];
}

export type PermissionChoice =
  | { decision: "allow" }
  | { decision: "allow-session" }
  | { decision: "deny"; feedback?: string };

export interface AgentHooks {
  onTextDelta?: (text: string) => void;
  onSegmentDone?: (text: string) => void;
  onToolStart?: (event: { id: string; name: string; target: string }) => void;
  onToolEnd?: (event: {
    id: string;
    name: string;
    target: string;
    ok: boolean;
    summary: string;
    diff?: DiffLine[];
    detail?: string;
    denied?: boolean;
  }) => void;
  onUsage?: (usage: { input: number; output: number }) => void;
  onNotice?: (text: string) => void;
  askPermission: (prompt: PermissionPrompt) => Promise<PermissionChoice>;
  askUser: (question: string, options: string[]) => Promise<string>;
  askPlan: (plan: string) => Promise<{ approved: boolean; feedback?: string }>;
  getMode: () => PermissionMode;
  setMode: (mode: PermissionMode) => void;
  getApproval?: () => "manual" | "auto";
  getRules: () => PermissionRules;
  addRule: (kind: "allow" | "deny" | "ask", rule: string) => void;
}

export async function runAgentTurn(opts: {
  client: LlmClient;
  messages: ChatMessage[];
  tools: ToolDef[];
  ctx: ToolContext;
  maxSteps: number;
  hooks: AgentHooks;
  signal?: AbortSignal;
  readOnly?: boolean;
}): Promise<{ aborted: boolean }> {
  let aborted = false;
  let finished = false;
  for (let step = 0; step < opts.maxSteps; step++) {
    if (opts.signal?.aborted) {
      aborted = true;
      break;
    }
    let streamed = "";
    let result;
    try {
      result = await opts.client.stream(opts.messages, opts.tools, opts.signal, (delta) => {
        if (delta.text) {
          streamed += delta.text;
          opts.hooks.onTextDelta?.(delta.text);
        }
        if (delta.usage) opts.hooks.onUsage?.(delta.usage);
      });
    } catch (error) {
      if (opts.signal?.aborted || isAbort(error)) {
        aborted = true;
        if (streamed.trim()) {
          opts.hooks.onSegmentDone?.(streamed);
          opts.messages.push({ role: "assistant", content: streamed });
        }
        break;
      }
      throw error;
    }
    const text = result.text || streamed;
    if (text.trim()) opts.hooks.onSegmentDone?.(text);
    const toolCalls = result.toolCalls.filter((call) => call.function.name);
    opts.messages.push({
      role: "assistant",
      content: text,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    });
    if (!toolCalls.length) {
      finished = true;
      break;
    }
    for (const call of toolCalls) {
      if (opts.signal?.aborted) {
        aborted = true;
        break;
      }
      const outcome = await dispatchTool(call, opts.ctx, opts.hooks, opts.readOnly === true);
      opts.messages.push({ role: "tool", tool_call_id: call.id, content: outcome.output });
    }
    if (aborted) break;
  }
  if (!aborted && !finished) {
    opts.hooks.onNotice?.(`Stopped after ${opts.maxSteps} steps. Send another message to continue.`);
  }
  return { aborted };
}

async function dispatchTool(call: ToolCall, ctx: ToolContext, hooks: AgentHooks, readOnly: boolean): Promise<ToolOutcome> {
  const name = call.function.name;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
  } catch {
    const target = call.function.arguments.slice(0, 80);
    hooks.onToolStart?.({ id: call.id, name, target });
    const outcome = fail(`Tool arguments were not valid JSON.`);
    hooks.onToolEnd?.({ id: call.id, name, target, ok: false, summary: outcome.summary });
    return outcome;
  }
  const target = toolTarget(name, args);
  hooks.onToolStart?.({ id: call.id, name, target });

  if (name === "ask_user") {
    const question = typeof args.question === "string" ? args.question : "Choose one";
    const options = Array.isArray(args.options) ? args.options.filter((item): item is string => typeof item === "string") : [];
    if (options.length === 0) {
      const outcome = fail("ask_user needs a non-empty options array.");
      hooks.onToolEnd?.({ id: call.id, name, target, ok: false, summary: outcome.summary });
      return outcome;
    }
    const answer = await hooks.askUser(question, options);
    const outcome: ToolOutcome = { ok: true, output: `The user answered: ${answer}`, summary: answer };
    hooks.onToolEnd?.({ id: call.id, name, target: question, ok: true, summary: answer });
    return outcome;
  }

  if (name === "enter_plan_mode") {
    hooks.setMode("plan");
    const outcome: ToolOutcome = {
      ok: true,
      output: "Entered plan mode. Read and search only. Call exit_plan_mode with a written plan when you are ready. Do not edit files until the user approves it.",
      summary: "Plan mode on",
    };
    hooks.onToolEnd?.({ id: call.id, name, target, ok: true, summary: outcome.summary });
    return outcome;
  }

  if (name === "exit_plan_mode") {
    const plan = typeof args.plan === "string" ? args.plan : "";
    if (!plan.trim()) {
      const outcome = fail("exit_plan_mode needs a plan.");
      hooks.onToolEnd?.({ id: call.id, name, target, ok: false, summary: outcome.summary });
      return outcome;
    }
    const answer = await hooks.askPlan(plan);
    const outcome: ToolOutcome = answer.approved
      ? {
          ok: true,
          output: "The user approved the plan. Plan mode is off and file edits are now accepted for this session. Implement the plan.",
          summary: "Plan approved",
        }
      : {
          ok: true,
          output: `The user did not approve the plan. Stay in plan mode and revise it.${answer.feedback ? ` Feedback: ${answer.feedback}` : ""}`,
          summary: "Plan declined",
        };
    if (answer.approved) hooks.setMode("acceptEdits");
    hooks.onToolEnd?.({ id: call.id, name, target: "plan", ok: true, summary: outcome.summary, detail: plan });
    return outcome;
  }

  const blocked = preflight(name, args, ctx);
  if (blocked) {
    hooks.onToolEnd?.({ id: call.id, name, target, ok: false, summary: blocked.summary });
    return blocked;
  }

  const located = locate(ctx, name, args);
  const command = typeof args.command === "string" ? args.command : undefined;
  const decision: PermissionDecision = decidePermission({
    tool: name,
    mode: hooks.getMode(),
    rules: hooks.getRules(),
    relPath: located.relPath,
    command,
    outside: located.outside,
    protectedPath: located.protectedPath,
    shellEnabled: ctx.shellEnabled,
    readOnly,
    approval: hooks.getApproval?.() ?? "manual",
  });

  if (decision === "ask") {
    const choice = await hooks.askPermission(buildPrompt(name, args, target, located.resolved));
    if (choice.decision === "deny") {
      const outcome = fail(choice.feedback?.trim() ? `The user denied this action. ${choice.feedback.trim()}` : "The user denied this action.");
      hooks.onToolEnd?.({ id: call.id, name, target, ok: false, summary: "Denied", denied: true, detail: outcome.output });
      return outcome;
    }
    if (choice.decision === "allow-session") remember(hooks, name, command, located.relPath);
  } else if (decision === "deny") {
    const outcome = fail(denyReason(name, hooks.getMode(), located, ctx, readOnly, command));
    hooks.onToolEnd?.({ id: call.id, name, target, ok: false, summary: "Denied", denied: true, detail: outcome.output });
    return outcome;
  }

  const outcome = await executeTool(name, args, ctx);
  hooks.onToolEnd?.({
    id: call.id,
    name,
    target,
    ok: outcome.ok,
    summary: outcome.summary,
    diff: outcome.diff,
    detail: outcome.detail ?? outcome.output,
  });
  return outcome;
}

function buildPrompt(name: string, args: Record<string, unknown>, target: string, resolved?: string): PermissionPrompt {
  const title = displayName(name);
  let diff: DiffLine[] | undefined;
  if (name === "edit_file" && resolved && existsSync(resolved)) {
    try {
      const edited = applyEdit(
        readFileSync(resolved, "utf8"),
        String(args.old_string ?? ""),
        String(args.new_string ?? ""),
        args.replace_all === true,
      );
      diff = edited.diff;
    } catch {
      diff = undefined;
    }
  }
  const command = typeof args.command === "string" ? args.command : "";
  const allowLabel =
    name === "run_shell"
      ? `Yes, and don't ask again for ${bashAllowRule(command).replace(/^Bash\(/, "").replace(/\)$/, "")}`
      : `Yes, and don't ask again for ${target}`;
  const detail = name === "run_shell" ? command : name === "write_file" ? `Write ${target}` : target;
  return { tool: name, title, target, detail, allowLabel, diff };
}

function remember(hooks: AgentHooks, name: string, command: string | undefined, relPath: string | undefined): void {
  if (name === "run_shell" && command) {
    hooks.addRule("allow", bashAllowRule(command));
    return;
  }
  if (relPath) hooks.addRule("allow", `${displayName(name)}(${relPath})`);
}

function denyReason(
  name: string,
  mode: PermissionMode,
  located: { outside?: boolean; protectedPath?: boolean },
  ctx: ToolContext,
  readOnly: boolean,
  command?: string,
): string {
  if (name === "run_shell" && !ctx.shellEnabled) return "Shell is disabled. Set shell.enabled = true in .agent/config.toml.";
  if (located.protectedPath) return "That path is protected.";
  if (located.outside) return "That path is outside the workspace. Use /add-dir to allow another directory.";
  if (readOnly) return "This turn is read-only.";
  if (mode === "plan") return "Plan mode is on. Read and search, then call exit_plan_mode. File edits and mutating commands are blocked.";
  if (mode === "dontAsk") return "dontAsk mode blocks anything that would prompt. Add an allow rule or use another permission mode.";
  if (command) return `Command denied: ${command}`;
  return "Denied by permission settings.";
}

function preflight(name: string, args: Record<string, unknown>, ctx: ToolContext): ToolOutcome | null {
  if (name !== "edit_file" && name !== "write_file") return null;
  const userPath = typeof args.path === "string" ? args.path : "";
  if (!userPath) return fail('Missing string argument "path".');
  let abs: string;
  try {
    abs = ctx.sandbox.resolve(userPath);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (ctx.sandbox.isProtected(abs)) return fail("That path is protected.");
  const exists = existsSync(abs) && safeFile(abs);
  if (name === "edit_file" && !exists) return fail(`File does not exist: ${ctx.sandbox.relative(abs)}. Use write_file to create it.`);
  if (exists && !ctx.readFiles.has(abs)) {
    return fail(`Read ${ctx.sandbox.relative(abs)} with read_file before ${name === "edit_file" ? "editing" : "overwriting"} it.`);
  }
  return null;
}

function locate(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): { relPath?: string; outside?: boolean; protectedPath?: boolean; resolved?: string } {
  const needsPath = ["read_file", "write_file", "edit_file", "list_dir", "glob", "grep"].includes(name);
  if (!needsPath) return {};
  const userPath = typeof args.path === "string" && args.path ? args.path : name === "read_file" || name === "write_file" || name === "edit_file" ? "" : ".";
  if (!userPath) return {};
  try {
    const resolved = ctx.sandbox.resolve(userPath);
    return { resolved, relPath: ctx.sandbox.relative(resolved), protectedPath: ctx.sandbox.isProtected(resolved) };
  } catch {
    return { outside: true };
  }
}

function safeFile(abs: string): boolean {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function fail(message: string): ToolOutcome {
  return { ok: false, output: message.startsWith("Error:") ? message : `Error: ${message}`, summary: message.replace(/^Error:\s*/, "") };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}
