import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chatEndpoint, createOpenAIClient } from "../src/llm/client.js";
import { consumeSse } from "../src/llm/sse.js";
import { buildSystemPrompt, loadProfileText } from "../src/prompt.js";
import { snapsToRestore } from "../src/rewind.js";
import { emptyEditor, reduceEditor, type KeyIn } from "../src/tui/editor.js";

function key(partial: Partial<KeyIn>): KeyIn {
  return {
    input: "",
    ctrl: false,
    meta: false,
    shift: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    up: false,
    down: false,
    left: false,
    right: false,
    pageUp: false,
    pageDown: false,
    ...partial,
  };
}

test("sse frames split across reads", () => {
  const first = consumeSse('data: {"a":1}\n\ndata: {"b"');
  assert.deepEqual(first.messages, ['{"a":1}']);
  const second = consumeSse(first.rest + ':2}\n\n');
  assert.deepEqual(second.messages, ['{"b":2}']);
  assert.equal(second.rest, "");
});

test("chat endpoint is appended once", () => {
  assert.equal(chatEndpoint("https://api.deepseek.com/v1/"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(
    chatEndpoint("https://example.com/v1/chat/completions"),
    "https://example.com/v1/chat/completions",
  );
});

test("streaming client emits text and accumulates a split tool call", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"a.ts\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
    "data: [DONE]\n\n",
  ];
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  const deltas: string[] = [];
  const client = createOpenAIClient({
    baseURL: "http://127.0.0.1:9/v1",
    apiKey: "test-key",
    model: "mock",
    temperature: 0,
    maxTokens: 32,
    fetchImpl,
  });
  const result = await client.stream([{ role: "user", content: "hi" }], [], undefined, (delta) => {
    if (delta.text) deltas.push(delta.text);
  });
  assert.equal(deltas.join(""), "Hi");
  assert.equal(result.toolCalls[0]?.function.name, "read_file");
  assert.equal(result.toolCalls[0]?.function.arguments, '{"path":"a.ts"}');
  assert.deepEqual(result.usage, { input: 3, output: 2 });
});

test("missing api key names the Glue env vars", async () => {
  const client = createOpenAIClient({
    baseURL: "http://127.0.0.1:9/v1",
    model: "mock",
    temperature: 0,
    maxTokens: 8,
    fetchImpl: async () => {
      throw new Error("should not fetch");
    },
  });
  await assert.rejects(
    () => client.stream([{ role: "user", content: "hi" }], [], undefined, () => {}),
    /GLUE_API_KEY/,
  );
});

test("default profile is loaded and the cpld stub is not", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-prompt-"));
  const prompt = buildSystemPrompt({
    workspace: cwd,
    profile: "default",
    permissionMode: "default",
    shellEnabled: false,
    outputStyle: "normal",
  });
  assert.match(prompt, /You are Glue/);
  assert.match(prompt, /No domain-specific rules are active/);
  const cpld = buildSystemPrompt({
    workspace: cwd,
    profile: "cpld",
    permissionMode: "plan",
    shellEnabled: false,
    outputStyle: "concise",
  });
  assert.equal(loadProfileText("cpld", cwd), undefined);
  assert.doesNotMatch(cpld, /No domain-specific rules are active/);
  assert.match(cpld, /Profile: cpld/);
});

test("rewind keeps the first before-image from the chosen turn", () => {
  const files = snapsToRestore(
    [
      { files: [{ path: "/w/a.ts", content: "v1" }] },
      { files: [{ path: "/w/a.ts", content: "v2" }, { path: "/w/b.ts", content: null }] },
    ],
    1,
  );
  assert.deepEqual(files, [
    { path: "/w/a.ts", content: "v2" },
    { path: "/w/b.ts", content: null },
  ]);
});

test("shift+tab cycles mode and ? opens help only on an empty prompt", () => {
  const empty = emptyEditor();
  assert.equal(reduceEditor(empty, key({ tab: true, shift: true })).effect, "cycle-mode");
  assert.equal(reduceEditor(empty, key({ input: "?" })).effect, "help");
  const typed = reduceEditor({ ...empty, text: "x", cursor: 1 }, key({ input: "?" }));
  assert.equal(typed.effect, undefined);
  assert.equal(typed.state.text, "x?");
  assert.equal(reduceEditor(empty, key({ return: true })).effect, "submit");
});
