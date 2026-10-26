import { readFileSync, statSync } from "node:fs";
import type { Sandbox } from "./sandbox.js";

/** Pull `@path` tokens into the model message and mark those files as read. */
export function expandMentions(
  text: string,
  sandbox: Sandbox,
  readFiles: Set<string>,
): { text: string; attached: string[] } {
  const attached: string[] = [];
  const extras: string[] = [];
  const re = /(^|\s)@([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const token = match[2];
    if (!token || attached.length >= 4) continue;
    try {
      const abs = sandbox.resolve(token.replace(/[),.;:]+$/, ""));
      if (!statSync(abs).isFile()) continue;
      const rel = sandbox.relative(abs);
      if (attached.includes(rel)) continue;
      const raw = readFileSync(abs, "utf8");
      const lines = raw.split("\n");
      const clipped = lines.slice(0, 200).join("\n");
      const more = lines.length > 200 ? `\n… ${lines.length - 200} more lines` : "";
      extras.push(`<attached path="${rel}">\n${clipped}${more}\n</attached>`);
      attached.push(rel);
      readFiles.add(abs);
    } catch {
      /* unknown path stays as text */
    }
  }
  if (!extras.length) return { text, attached };
  return { text: `${text}\n\n${extras.join("\n\n")}`, attached };
}

export function mentionQuery(text: string, cursor: number): { start: number; end: number; query: string } | null {
  const match = /(?:^|\s)@([^\s]*)$/.exec(text.slice(0, cursor));
  if (!match || match[1] === undefined || match.index === undefined) return null;
  const query = match[1];
  const start = cursor - query.length - 1;
  return { start, end: cursor, query };
}
