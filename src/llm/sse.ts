/** Pull complete SSE data payloads out of an accumulating byte buffer. */
export function consumeSse(buffer: string): { messages: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const messages: string[] = [];
  let rest = normalized;
  while (true) {
    const idx = rest.indexOf("\n\n");
    if (idx === -1) break;
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) messages.push(data);
  }
  return { messages, rest };
}
