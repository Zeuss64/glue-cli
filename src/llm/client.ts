import type { ChatMessage, LlmDelta, LlmResult, TokenUsage, ToolCall, ToolDef } from "../types.js";
import { createAnthropicClient } from "./anthropic.js";
import { resolveProtocol, type ApiClientOptions } from "./protocol.js";
import { consumeSse } from "./sse.js";

export interface LlmClient {
  stream(
    messages: ChatMessage[],
    tools: ToolDef[],
    signal: AbortSignal | undefined,
    onDelta: (delta: LlmDelta) => void,
  ): Promise<LlmResult>;
}

export interface OpenAIClientOptions {
  baseURL: string;
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

interface Acc {
  text: string;
  tools: Array<{ id: string; name: string; arguments: string }>;
  usage: TokenUsage;
  finish: string | null;
}

export function createOpenAIClient(opts: OpenAIClientOptions): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    stream(messages, tools, signal, onDelta) {
      return completeChat(opts, fetchImpl, messages, tools, signal, onDelta);
    },
  };
}

export function createLlmClient(opts: ApiClientOptions): LlmClient {
  const protocol = resolveProtocol(opts.protocol, opts.baseURL);
  if (protocol === "anthropic") return createAnthropicClient(opts);
  return createOpenAIClient(opts);
}

export function chatEndpoint(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

async function completeChat(
  opts: OpenAIClientOptions,
  fetchImpl: typeof fetch,
  messages: ChatMessage[],
  tools: ToolDef[],
  signal: AbortSignal | undefined,
  onDelta: (delta: LlmDelta) => void,
): Promise<LlmResult> {
  if (!opts.apiKey) {
    throw new Error("No API key. Set GLUE_API_KEY, AGENT_API_KEY, or OPENAI_API_KEY.");
  }
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: messages.map(wireMessage),
    temperature: opts.temperature,
    max_tokens: opts.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  // Chat Completions does not get `reasoning_effort`. Effort is session state
  // unless the protocol is Anthropic, which sends `output_config.effort`.
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    body.tool_choice = "auto";
  }
  return post(opts, fetchImpl, body, signal, onDelta, true);
}

async function post(
  opts: OpenAIClientOptions,
  fetchImpl: typeof fetch,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onDelta: (delta: LlmDelta) => void,
  canRetry: boolean,
): Promise<LlmResult> {
  const timeout = AbortSignal.timeout(180_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(chatEndpoint(opts.baseURL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify(body),
    signal: combined,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2000);
    if (canRetry && response.status === 400 && /stream_options|temperature|max_tokens/i.test(detail)) {
      const next = { ...body };
      delete next.stream_options;
      if (/temperature/i.test(detail)) delete next.temperature;
      if (/max_tokens/i.test(detail)) delete next.max_tokens;
      return post(opts, fetchImpl, next, signal, onDelta, false);
    }
    throw new Error(`Model request failed (${response.status}): ${detail || response.statusText}`);
  }
  const acc: Acc = { text: "", tools: [], usage: { input: 0, output: 0 }, finish: null };
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    absorb(acc, (await response.json()) as unknown, onDelta);
    return finishAcc(acc, onDelta);
  }
  if (!response.body) throw new Error("Model response had no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const consumed = consumeSse(buf);
    buf = consumed.rest;
    for (const data of consumed.messages) {
      if (data.trim() === "[DONE]") return finishAcc(acc, onDelta);
      try {
        absorb(acc, JSON.parse(data) as unknown, onDelta);
      } catch {
        /* ignore a keepalive that is not JSON */
      }
    }
  }
  return finishAcc(acc, onDelta);
}

function finishAcc(acc: Acc, onDelta: (delta: LlmDelta) => void): LlmResult {
  if (acc.usage.input || acc.usage.output || acc.usage.cacheRead || acc.usage.cacheWrite) onDelta({ usage: acc.usage });
  const toolCalls: ToolCall[] = acc.tools
    .filter((tool) => tool.name)
    .map((tool, index) => ({
      id: tool.id || `call_${index}`,
      type: "function" as const,
      function: { name: tool.name, arguments: tool.arguments || "{}" },
    }));
  return { text: acc.text, toolCalls, usage: acc.usage, finishReason: acc.finish };
}

function absorb(acc: Acc, payload: unknown, onDelta: (delta: LlmDelta) => void): void {
  if (!payload || typeof payload !== "object") return;
  const record = payload as Record<string, unknown>;
  const usage = asRecord(record.usage);
  if (usage) {
    const next: TokenUsage = {
      input: numberOf(usage.prompt_tokens ?? usage.input_tokens),
      output: numberOf(usage.completion_tokens ?? usage.output_tokens),
    };
    const details = asRecord(usage.prompt_tokens_details);
    const cached = typeof details?.cached_tokens === "number"
      ? details.cached_tokens
      : typeof usage.cached_tokens === "number"
        ? usage.cached_tokens
        : typeof usage.cache_read_input_tokens === "number"
          ? usage.cache_read_input_tokens
          : undefined;
    if (cached !== undefined) next.cacheRead = cached;
    if (typeof usage.cache_creation_input_tokens === "number") next.cacheWrite = usage.cache_creation_input_tokens;
    acc.usage = next;
  }
  const choice = asRecord((record.choices as unknown[] | undefined)?.[0]);
  if (!choice) return;
  if (typeof choice.finish_reason === "string") acc.finish = choice.finish_reason;
  const message = asRecord(choice.message);
  const delta = asRecord(choice.delta) ?? message;
  if (!delta) return;
  if (typeof delta.content === "string" && delta.content) {
    acc.text += delta.content;
    onDelta({ text: delta.content });
  }
  const calls = delta.tool_calls;
  if (!Array.isArray(calls)) return;
  for (const raw of calls) {
    const call = asRecord(raw);
    if (!call) continue;
    const fn = asRecord(call.function);
    const index =
      typeof call.index === "number"
        ? call.index
        : acc.tools.length === 0 || typeof call.id === "string" || typeof fn?.name === "string"
          ? acc.tools.length
          : acc.tools.length - 1;
    const current = acc.tools[index] ?? { id: "", name: "", arguments: "" };
    if (typeof call.id === "string") current.id = call.id;
    if (typeof fn?.name === "string") current.name += fn.name;
    if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
    acc.tools[index] = current;
  }
}

function wireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "assistant") {
    const out: Record<string, unknown> = { role: "assistant", content: message.content ?? "" };
    if (message.tool_calls?.length) out.tool_calls = message.tool_calls;
    return out;
  }
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.tool_call_id, content: message.content };
  }
  return { role: message.role, content: message.content };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
