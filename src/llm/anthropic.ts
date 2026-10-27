import { anthropicOutputConfig } from "../effort.js";
import type { ChatMessage, LlmDelta, LlmResult, TokenUsage, ToolCall, ToolDef } from "../types.js";
import type { ApiClientOptions } from "./protocol.js";
import { messagesEndpoint } from "./protocol.js";
import { consumeSse } from "./sse.js";

const ANTHROPIC_VERSION = "2023-06-01";

interface Acc {
  text: string;
  tools: Array<{ id: string; name: string; arguments: string }>;
  usage: TokenUsage;
  finish: string | null;
}

interface LiveBlock {
  kind: "text" | "tool";
  id: string;
  name: string;
  json: string;
  sawDelta: boolean;
  seed: string;
}

export function createAnthropicClient(opts: ApiClientOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    stream(
      messages: ChatMessage[],
      tools: ToolDef[],
      signal: AbortSignal | undefined,
      onDelta: (delta: LlmDelta) => void,
    ): Promise<LlmResult> {
      return completeMessages(opts, fetchImpl, messages, tools, signal, onDelta);
    },
  };
}

async function completeMessages(
  opts: ApiClientOptions,
  fetchImpl: typeof fetch,
  messages: ChatMessage[],
  tools: ToolDef[],
  signal: AbortSignal | undefined,
  onDelta: (delta: LlmDelta) => void,
): Promise<LlmResult> {
  if (!opts.apiKey) {
    throw new Error("No API key. Set GLUE_API_KEY, AGENT_API_KEY, or OPENAI_API_KEY.");
  }
  const shaped = toAnthropicMessages(messages);
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    stream: true,
    messages: shaped.messages,
  };
  if (shaped.system) body.system = shaped.system;
  if (tools.length) body.tools = tools.map(anthropicTool);
  const outputConfig = anthropicOutputConfig(opts.effort);
  if (outputConfig) body.output_config = outputConfig;
  const timeout = AbortSignal.timeout(180_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(messagesEndpoint(opts.baseURL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      authorization: `Bearer ${opts.apiKey}`,
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify(body),
    signal: combined,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 2000);
    throw new Error(`Model request failed (${response.status}): ${detail || response.statusText}`);
  }
  const acc: Acc = { text: "", tools: [], usage: { input: 0, output: 0 }, finish: null };
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    absorbMessage(acc, (await response.json()) as unknown, onDelta);
    return finishAcc(acc, onDelta);
  }
  if (!response.body) throw new Error("Model response had no body.");
  const blocks: LiveBlock[] = [];
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
      if (data.trim() === "[DONE]") {
        absorbBlocks(acc, blocks);
        return finishAcc(acc, onDelta);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(data) as unknown;
      } catch {
        continue;
      }
      absorbStream(acc, blocks, payload, onDelta);
    }
  }
  absorbBlocks(acc, blocks);
  return finishAcc(acc, onDelta);
}

export function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: Array<Record<string, unknown>> }>;
} {
  const system: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: Array<Record<string, unknown>> }> = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) system.push(message.content);
      continue;
    }
    if (message.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.tool_calls ?? []) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: parseInput(call.function.arguments),
        });
      }
      if (content.length) pushMerged(out, { role: "assistant", content });
      continue;
    }
    if (message.role === "tool") {
      pushMerged(out, {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }],
      });
      continue;
    }
    pushMerged(out, { role: "user", content: [{ type: "text", text: message.content }] });
  }
  return { system: system.length ? system.join("\n\n") : undefined, messages: out };
}

function pushMerged(
  out: Array<{ role: "user" | "assistant"; content: Array<Record<string, unknown>> }>,
  next: { role: "user" | "assistant"; content: Array<Record<string, unknown>> },
): void {
  const last = out[out.length - 1];
  if (last && last.role === next.role) {
    last.content.push(...next.content);
    return;
  }
  out.push(next);
}

function anthropicTool(tool: ToolDef): Record<string, unknown> {
  const schema = tool.parameters;
  const inputSchema =
    schema && typeof schema === "object" && Object.keys(schema).length > 0 ? schema : { type: "object", properties: {} };
  return { name: tool.name, description: tool.description, input_schema: inputSchema };
}

function parseInput(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    /* tool arguments were not a JSON object */
  }
  return {};
}

function absorbStream(acc: Acc, blocks: LiveBlock[], payload: unknown, onDelta: (delta: LlmDelta) => void): void {
  const record = asRecord(payload);
  if (!record) return;
  if (record.type === "error") {
    const err = asRecord(record.error);
    throw new Error(typeof err?.message === "string" ? err.message : "Anthropic stream error");
  }
  if (record.type === "message_start") {
    takeUsage(acc, asRecord(asRecord(record.message)?.usage));
    return;
  }
  if (record.type === "content_block_start") {
    const index = indexOf(record.index);
    const block = asRecord(record.content_block);
    const input = asRecord(block?.input);
    blocks[index] = {
      kind: block?.type === "tool_use" ? "tool" : "text",
      id: typeof block?.id === "string" ? block.id : "",
      name: typeof block?.name === "string" ? block.name : "",
      json: "",
      sawDelta: false,
      seed: input && Object.keys(input).length ? JSON.stringify(input) : "",
    };
    return;
  }
  if (record.type === "content_block_delta") {
    const index = indexOf(record.index);
    const delta = asRecord(record.delta);
    const current = blocks[index] ?? { kind: "text" as const, id: "", name: "", json: "", sawDelta: false, seed: "" };
    blocks[index] = current;
    if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
      acc.text += delta.text;
      onDelta({ text: delta.text });
    }
    if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
      current.kind = "tool";
      current.json += delta.partial_json;
      current.sawDelta = true;
    }
    return;
  }
  if (record.type === "message_delta") {
    const delta = asRecord(record.delta);
    if (typeof delta?.stop_reason === "string") acc.finish = delta.stop_reason;
    takeUsage(acc, asRecord(record.usage));
  }
}

function absorbMessage(acc: Acc, payload: unknown, onDelta: (delta: LlmDelta) => void): void {
  const record = asRecord(payload);
  if (!record) return;
  if (record.type === "error") {
    const err = asRecord(record.error);
    throw new Error(typeof err?.message === "string" ? err.message : "Anthropic request failed");
  }
  takeUsage(acc, asRecord(record.usage));
  if (typeof record.stop_reason === "string") acc.finish = record.stop_reason;
  if (typeof record.content === "string") {
    acc.text += record.content;
    if (record.content) onDelta({ text: record.content });
    return;
  }
  if (!Array.isArray(record.content)) return;
  for (const raw of record.content) {
    const block = asRecord(raw);
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") {
      acc.text += block.text;
      if (block.text) onDelta({ text: block.text });
    }
    if (block.type === "tool_use") {
      acc.tools.push({
        id: typeof block.id === "string" ? block.id : "",
        name: typeof block.name === "string" ? block.name : "",
        arguments: JSON.stringify(asRecord(block.input) ?? {}),
      });
    }
  }
}

function absorbBlocks(acc: Acc, blocks: LiveBlock[]): void {
  for (const block of blocks) {
    if (!block || block.kind !== "tool" || !block.name) continue;
    acc.tools.push({
      id: block.id,
      name: block.name,
      arguments: block.sawDelta ? block.json || "{}" : block.seed || "{}",
    });
  }
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

function takeUsage(acc: Acc, usage: Record<string, unknown> | undefined): void {
  if (!usage) return;
  if (typeof usage.input_tokens === "number") acc.usage.input = usage.input_tokens;
  if (typeof usage.output_tokens === "number") acc.usage.output = usage.output_tokens;
  if (typeof usage.cache_read_input_tokens === "number") acc.usage.cacheRead = usage.cache_read_input_tokens;
  if (typeof usage.cache_creation_input_tokens === "number") acc.usage.cacheWrite = usage.cache_creation_input_tokens;
}

function indexOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}
