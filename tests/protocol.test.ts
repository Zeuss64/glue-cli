import assert from "node:assert/strict";
import test from "node:test";
import { createLlmClient } from "../src/llm/client.js";
import { inferProtocol, messagesEndpoint, resolveProtocol } from "../src/llm/protocol.js";
import type { ChatMessage, ToolDef } from "../src/types.js";

const tool: ToolDef = {
  name: "read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

const history: ChatMessage[] = [
  { role: "system", content: "You are Glue" },
  { role: "user", content: "read a.ts" },
  {
    role: "assistant",
    content: "Looking.",
    tool_calls: [
      { id: "toolu_1", type: "function", function: { name: "read_file", arguments: "{\"path\":\"a.ts\"}" } },
    ],
  },
  { role: "tool", tool_call_id: "toolu_1", content: "file text" },
];

test("protocol follows an explicit name, otherwise the URL", () => {
  assert.equal(resolveProtocol("anthropic", "https://example.com/v1"), "anthropic");
  assert.equal(resolveProtocol("openai", "https://api.anthropic.com"), "openai");
  assert.equal(resolveProtocol("messages", "https://example.com/v1"), "anthropic");
  assert.equal(inferProtocol("https://api.anthropic.com/v1"), "anthropic");
  assert.equal(inferProtocol("https://example.com/v1/messages"), "anthropic");
  assert.equal(inferProtocol("https://example.com/v1/chat/completions"), "openai");
  assert.equal(inferProtocol("https://example.com/v1"), undefined);
  assert.equal(resolveProtocol(undefined, "https://example.com/v1"), "openai");
  assert.throws(() => resolveProtocol("grpc", "https://example.com/v1"), /openai or anthropic/);
});

test("messages endpoint fills /v1/messages once", () => {
  assert.equal(messagesEndpoint("https://api.anthropic.com"), "https://api.anthropic.com/v1/messages");
  assert.equal(messagesEndpoint("https://api.anthropic.com/v1/"), "https://api.anthropic.com/v1/messages");
  assert.equal(messagesEndpoint("https://example.com/proxy/v1/messages"), "https://example.com/proxy/v1/messages");
});

test("anthropic client sends a Messages request and reads the SSE stream", async () => {
  let url = "";
  let headers: Record<string, string> = {};
  let body: Record<string, unknown> = {};
  const frames = [
    frame("message_start", { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 1 } } }),
    frame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    frame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }),
    frame("content_block_stop", { type: "content_block_stop", index: 0 }),
    frame("content_block_start", {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_9", name: "read_file", input: {} },
    }),
    frame("content_block_delta", {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: "{\"pa" },
    }),
    frame("content_block_delta", {
      type: "content_block_delta",
      index: 1,
      delta: { type: "input_json_delta", partial_json: "th\":\"a.ts\"}" },
    }),
    frame("content_block_stop", { type: "content_block_stop", index: 1 }),
    frame("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 8 } }),
    frame("message_stop", { type: "message_stop" }),
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    url = String(input);
    headers = { ...(init?.headers as Record<string, string>) };
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(frames.join(""), { headers: { "content-type": "text/event-stream" } });
  };
  const deltas: string[] = [];
  const client = createLlmClient({
    baseURL: "https://api.anthropic.com",
    apiKey: "test-key",
    model: "claude-test",
    temperature: 0,
    maxTokens: 32,
    fetchImpl,
  });
  const result = await client.stream(history, [tool], undefined, (delta) => {
    if (delta.text) deltas.push(delta.text);
  });
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(headers["x-api-key"], "test-key");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.equal(headers.authorization, "Bearer test-key");
  assert.equal(body.model, "claude-test");
  assert.equal(body.max_tokens, 32);
  assert.equal(body.stream, true);
  assert.equal(body.system, "You are Glue");
  const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "user"]);
  assert.equal(messages[1]?.content[1]?.type, "tool_use");
  assert.equal(messages[1]?.content[1]?.name, "read_file");
  assert.deepEqual(messages[1]?.content[1]?.input, { path: "a.ts" });
  assert.equal(messages[2]?.content[0]?.type, "tool_result");
  assert.equal(messages[2]?.content[0]?.tool_use_id, "toolu_1");
  const tools = body.tools as Array<Record<string, unknown>>;
  assert.equal(tools[0]?.name, "read_file");
  assert.equal((tools[0]?.input_schema as { type?: string }).type, "object");
  assert.equal(deltas.join(""), "Hi");
  assert.equal(result.toolCalls[0]?.id, "toolu_9");
  assert.equal(result.toolCalls[0]?.function.name, "read_file");
  assert.equal(result.toolCalls[0]?.function.arguments, "{\"path\":\"a.ts\"}");
  assert.deepEqual(result.usage, { input: 5, output: 8 });
  assert.equal(result.finishReason, "tool_use");
});

test("anthropic JSON responses and an explicit openai override still route", async () => {
  const jsonFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "Done" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 2, output_tokens: 3 },
      }),
      { headers: { "content-type": "application/json" } },
    );
  const jsonClient = createLlmClient({
    baseURL: "https://example.com/v1",
    protocol: "anthropic",
    apiKey: "test-key",
    model: "claude-test",
    temperature: 0,
    maxTokens: 8,
    fetchImpl: jsonFetch,
  });
  const jsonResult = await jsonClient.stream([{ role: "user", content: "hi" }], [], undefined, () => {});
  assert.equal(jsonResult.text, "Done");
  assert.deepEqual(jsonResult.usage, { input: 2, output: 3 });

  let openaiUrl = "";
  const openaiFetch: typeof fetch = async (input) => {
    openaiUrl = String(input);
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
      { headers: { "content-type": "application/json" } },
    );
  };
  await createLlmClient({
    baseURL: "https://api.anthropic.com",
    protocol: "openai",
    apiKey: "test-key",
    model: "gpt-test",
    temperature: 0,
    maxTokens: 8,
    fetchImpl: openaiFetch,
  }).stream([{ role: "user", content: "hi" }], [], undefined, () => {});
  assert.equal(openaiUrl, "https://api.anthropic.com/chat/completions");
});

test("anthropic client names the same key env vars when the key is missing", async () => {
  const client = createLlmClient({
    baseURL: "https://api.anthropic.com",
    model: "claude-test",
    temperature: 0,
    maxTokens: 8,
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  });
  await assert.rejects(() => client.stream([{ role: "user", content: "hi" }], [], undefined, () => {}), /GLUE_API_KEY/);
});

function frame(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
