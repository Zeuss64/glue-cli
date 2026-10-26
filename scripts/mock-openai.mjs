/**
 * Tiny OpenAI-compatible chat server for local Glue runs.
 * First turn asks for write_file hello.txt. The follow-up turn replies in text.
 *
 *   PORT=8787 node scripts/mock-openai.mjs
 *   # PORT unset or 0 picks a free port and prints `LISTENING <port>`.
 */
import http from "node:http";

const requested = process.env.PORT === undefined || process.env.PORT === "" ? 8787 : Number(process.env.PORT);
const port = Number.isFinite(requested) ? requested : 8787;

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "";
  if (req.method !== "POST" || !url.includes("/chat/completions")) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("invalid json");
    return;
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const hasTool = messages.some((message) => message && message.role === "tool");
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  if (!hasTool) {
    const args = JSON.stringify({ path: "hello.txt", content: "hello from glue\n" });
    send({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_hello",
                type: "function",
                function: { name: "write_file", arguments: args },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    send({
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 12, completion_tokens: 9 },
    });
  } else {
    const text = "Created hello.txt";
    for (const ch of text) {
      send({ choices: [{ index: 0, delta: { content: ch }, finish_reason: null }] });
    }
    send({
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 24, completion_tokens: 4 },
    });
  }
  res.write("data: [DONE]\n\n");
  res.end();
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const bound = address && typeof address === "object" ? address.port : port;
  process.stdout.write(`LISTENING ${bound}\n`);
});
