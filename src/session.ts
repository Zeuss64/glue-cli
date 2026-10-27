import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { sessionId } from "./id.js";
import type { ChatMessage, TodoItem, TranscriptItem } from "./types.js";

export interface SessionMeta {
  id: string;
  name: string;
  cwd: string;
  model: string;
  profile: string;
  permissionMode: string;
  createdAt: string;
  updatedAt: string;
  effort?: string;
  goal?: string;
  approval?: string;
  statusline?: string;
  /** Active skill id. Empty means none. */
  skill?: string;
}

export interface SessionSnapshot {
  meta: SessionMeta;
  messages: ChatMessage[];
  items: TranscriptItem[];
  todos: TodoItem[];
}

export function sessionsDir(workspace: string): string {
  return path.join(workspace, ".agent", "sessions");
}

export function createSession(workspace: string, partial: Omit<SessionMeta, "id" | "createdAt" | "updatedAt" | "name"> & { name?: string }): SessionLog {
  const now = new Date().toISOString();
  const meta: SessionMeta = {
    id: sessionId(),
    name: partial.name ?? "",
    cwd: partial.cwd,
    model: partial.model,
    profile: partial.profile,
    permissionMode: partial.permissionMode,
    createdAt: now,
    updatedAt: now,
    ...(partial.effort ? { effort: partial.effort } : {}),
    ...(partial.goal !== undefined ? { goal: partial.goal } : {}),
    ...(partial.approval ? { approval: partial.approval } : {}),
    ...(partial.statusline !== undefined ? { statusline: partial.statusline } : {}),
    ...(partial.skill !== undefined ? { skill: partial.skill } : {}),
  };
  const file = path.join(sessionsDir(workspace), `${meta.id}.jsonl`);
  mkdirSync(path.dirname(file), { recursive: true });
  const log = new SessionLog(file, meta);
  log.append({ kind: "meta", meta });
  return log;
}

export function loadSession(file: string): SessionSnapshot {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  let meta: SessionMeta | undefined;
  const messages: ChatMessage[] = [];
  const items: TranscriptItem[] = [];
  let todos: TodoItem[] = [];
  for (const line of lines) {
    const record = JSON.parse(line) as Record<string, unknown>;
    if (record.kind === "meta" || record.kind === "meta-update") {
      meta = { ...(meta ?? {}), ...(record.meta as SessionMeta) };
    } else if (record.kind === "message") {
      messages.push(record.message as ChatMessage);
    } else if (record.kind === "transcript") {
      items.push(record.item as TranscriptItem);
    } else if (record.kind === "todos") {
      todos = record.todos as TodoItem[];
    }
  }
  if (!meta?.id) throw new Error(`Session file is missing metadata: ${file}`);
  return { meta, messages, items, todos };
}

export function listSessions(workspace: string): SessionSnapshot[] {
  const dir = sessionsDir(workspace);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const out: SessionSnapshot[] = [];
  for (const file of files.slice(0, 30)) {
    try {
      out.push(loadSession(file));
    } catch {
      /* skip a torn file */
    }
  }
  return out;
}

export function latestSessionFile(workspace: string): string | undefined {
  const sessions = listSessions(workspace);
  const id = sessions[0]?.meta.id;
  if (!id) return undefined;
  return path.join(sessionsDir(workspace), `${id}.jsonl`);
}

export function findSessionFile(workspace: string, idOrName: string): string | undefined {
  const dir = sessionsDir(workspace);
  const exact = path.join(dir, idOrName.endsWith(".jsonl") ? idOrName : `${idOrName}.jsonl`);
  if (existsSync(exact)) return exact;
  const sessions = listSessions(workspace);
  const found = sessions.find((session) => session.meta.id === idOrName || session.meta.name === idOrName || session.meta.id.startsWith(idOrName));
  if (!found) return undefined;
  return path.join(dir, `${found.meta.id}.jsonl`);
}

export class SessionLog {
  constructor(
    readonly file: string,
    public meta: SessionMeta,
  ) {}

  append(record: unknown): void {
    try {
      appendFileSync(this.file, JSON.stringify(record) + "\n");
    } catch {
      /* persistence is best-effort */
    }
  }

  updateMeta(partial: Partial<SessionMeta>): void {
    this.meta = { ...this.meta, ...partial, updatedAt: new Date().toISOString() };
    this.append({ kind: "meta-update", meta: this.meta });
  }

  message(message: ChatMessage): void {
    this.append({ kind: "message", message });
  }

  item(item: TranscriptItem): void {
    this.append({ kind: "transcript", item });
  }

  saveTodos(todos: TodoItem[]): void {
    this.append({ kind: "todos", todos });
  }

  replace(messages: ChatMessage[], items: TranscriptItem[], todos: TodoItem[] = []): void {
    const lines = [
      JSON.stringify({ kind: "meta", meta: this.meta }),
      ...messages.map((message) => JSON.stringify({ kind: "message", message })),
      ...items.map((item) => JSON.stringify({ kind: "transcript", item })),
      JSON.stringify({ kind: "todos", todos }),
    ];
    try {
      writeFileSync(this.file, lines.join("\n") + "\n");
    } catch {
      /* persistence is best-effort */
    }
  }

  static open(file: string): SessionLog {
    const snap = loadSession(file);
    return new SessionLog(file, snap.meta);
  }
}

export function readPromptHistory(workspace: string): string[] {
  const file = path.join(workspace, ".agent", "prompt-history.jsonl");
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { text?: string };
      if (row.text) out.push(row.text);
    } catch {
      /* ignore */
    }
  }
  return out.slice(-200);
}

export function appendPromptHistory(workspace: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const file = path.join(workspace, ".agent", "prompt-history.jsonl");
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ text: trimmed, at: new Date().toISOString() }) + "\n");
  } catch {
    /* ignore */
  }
}

export function writeText(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}
