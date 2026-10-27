import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applyEdit, EditError } from "../edit.js";
import { ULTRACODE_DESCRIPTION } from "../effort.js";
import { compactDiff, diffLines, diffStats } from "../diff.js";
import { globMatch } from "../glob.js";
import { Sandbox, SandboxError } from "../sandbox.js";
import type { DiffLine, TodoItem } from "../types.js";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
const MAX_READ_BYTES = 1_000_000;
const DEFAULT_READ_LINES = 2000;
const MAX_MATCHES = 100;
const MAX_WALK = 8000;
const SHELL_OUTPUT_CAP = 30_000;

export interface BackgroundTask {
  id: string;
  command: string;
  status: "running" | "done" | "killed";
  outputPath: string;
  startedAt: number;
  exitCode?: number;
  child?: ChildProcess;
}

export interface ToolContext {
  sandbox: Sandbox;
  shellEnabled: boolean;
  shellCwd: string;
  readFiles: Set<string>;
  todos: TodoItem[];
  tasks: Map<string, BackgroundTask>;
  signal?: AbortSignal;
  noteFile?: (filePath: string, before: string | null) => void;
  consumeBackground?: () => boolean;
  /**
   * Present only while UltraCode is on. Runs one subagent and returns its report.
   * The second argument is the read-only flag.
   */
  spawnSubagent?: (prompt: string, readOnly: boolean) => Promise<string>;
}

export interface ToolOutcome {
  ok: boolean;
  output: string;
  summary: string;
  diff?: DiffLine[];
  detail?: string;
}

export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "list_dir":
        return listDir(ctx, str(args, "path") ?? ".");
      case "read_file":
        return readFile(ctx, required(args, "path"), int(args, "offset"), int(args, "limit"));
      case "write_file":
        return writeFile(ctx, required(args, "path"), required(args, "content"));
      case "edit_file":
        return editFile(ctx, required(args, "path"), required(args, "old_string"), stringOrEmpty(args, "new_string"), bool(args, "replace_all"));
      case "glob":
        return globSearch(ctx, required(args, "pattern"), str(args, "path"));
      case "grep":
        return grepSearch(ctx, required(args, "pattern"), str(args, "path"), str(args, "glob"));
      case "todo_write":
        return writeTodos(ctx, args.todos);
      case "spawn_subagent":
        return spawnSubagent(ctx, required(args, "prompt"), bool(args, "read_only"));
      case "run_shell":
        return runShell(ctx, required(args, "command"), int(args, "timeout_ms"), bool(args, "run_in_background"));
      default:
        return fail(`Unknown tool ${name}.`);
    }
  } catch (error) {
    if (error instanceof SandboxError || error instanceof EditError) return fail(error.message);
    if (error instanceof Error) return fail(error.message);
    return fail(String(error));
  }
}

async function spawnSubagent(ctx: ToolContext, prompt: string, readOnly: boolean): Promise<ToolOutcome> {
  if (!ctx.spawnSubagent) {
    return fail(`spawn_subagent is available only while UltraCode is on. ${ULTRACODE_DESCRIPTION}.`);
  }
  const output = await ctx.spawnSubagent(prompt, readOnly);
  const summary = output.replace(/\s+/g, " ").trim().slice(0, 80) || "subagent finished";
  return { ok: true, output, summary };
}

function listDir(ctx: ToolContext, userPath: string): ToolOutcome {
  const abs = ctx.sandbox.resolve(userPath);
  const stat = statSync(abs);
  if (!stat.isDirectory()) return fail(`${ctx.sandbox.relative(abs)} is not a directory.`);
  const entries = readdirSync(abs, { withFileTypes: true })
    .map((entry) => {
      const child = path.join(abs, entry.name);
      let size = "";
      try {
        const st = lstatSync(child);
        size = st.isDirectory() ? "" : ` ${st.size}`;
      } catch {
        size = "";
      }
      const kind = entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "dir" : "file";
      return { kind, name: entry.name, size };
    })
    .sort((a, b) => Number(b.kind === "dir") - Number(a.kind === "dir") || a.name.localeCompare(b.name))
    .slice(0, 500);
  const rel = ctx.sandbox.relative(abs);
  const body = entries.map((entry) => `${entry.kind.padEnd(4)} ${entry.name}${entry.size}`).join("\n");
  return {
    ok: true,
    output: body || "(empty directory)",
    summary: `${entries.length} ${entries.length === 1 ? "entry" : "entries"} in ${rel === "." ? "." : rel}`,
    detail: body,
  };
}

function readFile(ctx: ToolContext, userPath: string, offset?: number, limit?: number): ToolOutcome {
  const abs = ctx.sandbox.resolve(userPath);
  if (ctx.sandbox.isProtected(abs)) return fail("That path is protected.");
  const stat = statSync(abs);
  if (stat.isDirectory()) return fail(`${ctx.sandbox.relative(abs)} is a directory. Use list_dir.`);
  if (stat.size > MAX_READ_BYTES) {
    return fail(`File is ${stat.size} bytes. Pass offset and limit to read a slice, or narrow the request.`);
  }
  const buf = readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return fail("File looks binary. Refusing to print it.");
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const start = Math.max(1, offset ?? 1);
  const take = Math.max(1, Math.min(limit ?? DEFAULT_READ_LINES, DEFAULT_READ_LINES));
  const slice = lines.slice(start - 1, start - 1 + take);
  if (start > lines.length && lines.length > 0) {
    return fail(`offset ${start} is past the end of the file (${lines.length} lines).`);
  }
  ctx.readFiles.add(abs);
  const rel = ctx.sandbox.relative(abs);
  if (lines.length === 0) {
    return { ok: true, output: `${rel} exists but is empty.`, summary: "Empty file", detail: "" };
  }
  const numbered = numberLines(slice, start);
  const partial = start > 1 || start - 1 + slice.length < lines.length;
  const note = partial
    ? `\n(showing lines ${start}-${start - 1 + slice.length} of ${lines.length})`
    : `\n(end of file, ${lines.length} lines)`;
  return {
    ok: true,
    output: numbered + note,
    summary: partial ? `Read lines ${start}-${start - 1 + slice.length} of ${lines.length}` : `Read ${lines.length} lines`,
    detail: numbered,
  };
}

function writeFile(ctx: ToolContext, userPath: string, content: string): ToolOutcome {
  const abs = ctx.sandbox.resolve(userPath);
  if (ctx.sandbox.isProtected(abs)) return fail("That path is protected.");
  const exists = existsSync(abs) && statSync(abs).isFile();
  if (exists && !ctx.readFiles.has(abs)) {
    return fail(`Read ${ctx.sandbox.relative(abs)} before overwriting it. Use edit_file for a partial change.`);
  }
  const before = exists ? readFileSync(abs, "utf8") : null;
  ctx.noteFile?.(abs, before);
  mkdirSync(path.dirname(abs), { recursive: true });
  atomicWrite(abs, content);
  ctx.readFiles.add(abs);
  const rel = ctx.sandbox.relative(abs);
  const lineCount = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  const diff = compactDiff(diffLines(before ?? "", content), 1, 20);
  return {
    ok: true,
    output: `Wrote ${rel} (${Buffer.byteLength(content)} bytes).`,
    summary: exists ? `Overwrote ${rel} (${lineCount} lines)` : `Wrote ${rel} (${lineCount} lines)`,
    diff,
    detail: content.slice(0, 4000),
  };
}

function editFile(ctx: ToolContext, userPath: string, oldString: string, newString: string, replaceAll: boolean): ToolOutcome {
  const abs = ctx.sandbox.resolve(userPath);
  if (ctx.sandbox.isProtected(abs)) return fail("That path is protected.");
  if (!existsSync(abs)) return fail(`File does not exist: ${ctx.sandbox.relative(abs)}. Use write_file to create it.`);
  if (!ctx.readFiles.has(abs)) return fail(`Read ${ctx.sandbox.relative(abs)} with read_file before editing it.`);
  const before = readFileSync(abs, "utf8");
  const outcome = applyEdit(before, oldString, newString, replaceAll);
  ctx.noteFile?.(abs, before);
  atomicWrite(abs, outcome.content);
  const stats = diffStats(outcome.diff);
  const rel = ctx.sandbox.relative(abs);
  return {
    ok: true,
    output: `Updated ${rel}. Replacements: ${outcome.replacements}. +${stats.add} -${stats.del}`,
    summary: `Updated ${rel} with ${stats.add} ${stats.add === 1 ? "addition" : "additions"} and ${stats.del} ${stats.del === 1 ? "removal" : "removals"}`,
    diff: outcome.diff,
  };
}

function globSearch(ctx: ToolContext, pattern: string, userPath?: string): ToolOutcome {
  const root = ctx.sandbox.resolve(userPath ?? ".");
  const found: string[] = [];
  walk(root, ctx, (file) => {
    const rel = ctx.sandbox.relative(file);
    if (globMatch(pattern, rel) || globMatch(pattern, path.relative(root, file).split(path.sep).join("/"))) {
      found.push(rel);
    }
    return found.length < MAX_MATCHES;
  });
  found.sort();
  const shown = found.slice(0, MAX_MATCHES);
  return {
    ok: true,
    output: shown.join("\n") || "No files matched.",
    summary: `Found ${shown.length} ${shown.length === 1 ? "file" : "files"}`,
    detail: shown.join("\n"),
  };
}

function grepSearch(ctx: ToolContext, pattern: string, userPath?: string, glob?: string): ToolOutcome {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (error) {
    return fail(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = ctx.sandbox.resolve(userPath ?? ".");
  const matches: string[] = [];
  const consider = (file: string) => {
    const rel = ctx.sandbox.relative(file);
    if (glob && !globMatch(glob, rel)) return true;
    const buf = readFileSync(file);
    if (buf.subarray(0, 8000).includes(0)) return true;
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i] ?? "")) continue;
      matches.push(`${rel}:${i + 1}:${lines[i]}`);
      if (matches.length >= MAX_MATCHES) return false;
    }
    return true;
  };
  if (statSync(root).isDirectory()) walk(root, ctx, consider);
  else consider(root);
  return {
    ok: true,
    output: matches.join("\n") || "No matches.",
    summary: matches.length ? `Found ${matches.length} ${matches.length === 1 ? "match" : "matches"}` : "No matches",
    detail: matches.join("\n"),
  };
}

function writeTodos(ctx: ToolContext, raw: unknown): ToolOutcome {
  if (!Array.isArray(raw)) return fail("todos must be an array.");
  const todos: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return fail("Each todo needs id, content, and status.");
    const row = item as Record<string, unknown>;
    const status = row.status;
    if (typeof row.id !== "string" || typeof row.content !== "string") return fail("Each todo needs id and content.");
    if (status !== "pending" && status !== "in_progress" && status !== "completed") return fail(`Bad todo status: ${String(status)}`);
    todos.push({ id: row.id, content: row.content, status });
  }
  ctx.todos.splice(0, ctx.todos.length, ...todos);
  const summary = `${todos.length} ${todos.length === 1 ? "task" : "tasks"}`;
  return { ok: true, output: todos.map((todo) => `[${todo.status}] ${todo.content}`).join("\n") || "Cleared the checklist.", summary };
}

async function runShell(ctx: ToolContext, command: string, timeoutMs: number | undefined, background: boolean): Promise<ToolOutcome> {
  if (!ctx.shellEnabled) return fail("Shell is disabled. Set shell.enabled = true in .agent/config.toml to allow run_shell.");
  const timeout = Math.min(Math.max(timeoutMs ?? 120_000, 1_000), 600_000);
  const shell = existsSync("/bin/bash") ? "/bin/bash" : "sh";
  const script = [
    'cd "$GLUE_START" || exit 97',
    'eval "$GLUE_COMMAND"',
    "status=$?",
    "printf '\\n__GLUE_CWD__%s\\n' \"$(pwd)\"",
    "exit $status",
  ].join("\n");
  const id = `t${randomBytes(3).toString("hex")}`;
  const outputPath = path.join(ctx.sandbox.primary, ".agent", "sessions", "tasks", `${id}.log`);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const child = spawn(shell, ["-lc", script], {
    cwd: ctx.sandbox.primary,
    env: { ...process.env, GLUE_START: ctx.shellCwd, GLUE_COMMAND: command },
    detached: background,
  });
  const task: BackgroundTask = { id, command, status: "running", outputPath, startedAt: Date.now(), child };
  ctx.tasks.set(id, task);
  if (background) {
    pipeToFile(child, outputPath, ctx, task);
    return {
      ok: true,
      output: `Command started in the background. Task ${id}. Output: ${ctx.sandbox.relative(outputPath)}`,
      summary: `Background task ${id}`,
    };
  }
  const result = await waitForChild(child, timeout, ctx, task);
  writeFileSync(outputPath, result.raw);
  const parsed = splitCwd(result.raw);
  if (parsed.cwd && ctx.sandbox.inside(parsed.cwd)) ctx.shellCwd = parsed.cwd;
  else if (parsed.cwd) parsed.output += `\nShell cwd was reset to ${ctx.sandbox.primary}`;
  task.status = result.killed ? "killed" : "done";
  task.exitCode = result.code ?? undefined;
  const benign = result.code === 0 || (result.code === 1 && benignExit(command));
  const clipped = clip(parsed.output.trimEnd(), SHELL_OUTPUT_CAP);
  const head = clipped || "(no output)";
  const prefix = benign ? "" : `Exit code ${result.code ?? "?"}\n`;
  return {
    ok: benign,
    output: prefix + head,
    summary: summarizeShell(command, benign, result.code, head),
    detail: head,
  };
}

function summarizeShell(command: string, ok: boolean, code: number | null, output: string): string {
  const first = output.split("\n").find((line) => line.trim()) ?? command;
  if (!ok) return `Exit ${code ?? "?"} · ${trimOne(first, 120)}`;
  return trimOne(first, 160);
}

function waitForChild(
  child: ChildProcess,
  timeout: number,
  ctx: ToolContext,
  task: BackgroundTask,
): Promise<{ raw: string; code: number | null; killed: boolean }> {
  return new Promise((resolve) => {
    let raw = "";
    let settled = false;
    const finish = (code: number | null, killed: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ raw, code, killed });
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      task.status = "killed";
      finish(null, true);
    }, timeout);
    const onAbort = () => {
      child.kill("SIGTERM");
      clearTimeout(timer);
      finish(null, true);
    };
    ctx.signal?.addEventListener("abort", onAbort, { once: true });
    const backgroundTimer = setInterval(() => {
      if (!ctx.consumeBackground?.()) return;
      clearInterval(backgroundTimer);
      clearTimeout(timer);
      pipeToFile(child, task.outputPath, ctx, task, raw);
      if (!settled) {
        settled = true;
        resolve({ raw: `${raw}\nCommand moved to the background. Task ${task.id}. Output: ${task.outputPath}`, code: 0, killed: false });
      }
    }, 150);
    child.stdout?.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(backgroundTimer);
      ctx.signal?.removeEventListener("abort", onAbort);
      finish(code, false);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      clearInterval(backgroundTimer);
      raw += `\n${error.message}`;
      finish(null, true);
    });
  });
}

function pipeToFile(child: ChildProcess, outputPath: string, ctx: ToolContext, task: BackgroundTask, prior = ""): void {
  let body = prior;
  const flush = () => {
    try {
      writeFileSync(outputPath, body);
    } catch {
      /* ignore */
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf8");
    flush();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf8");
    flush();
  });
  child.on("close", (code) => {
    task.status = "done";
    task.exitCode = code ?? undefined;
    flush();
    ctx.signal?.removeEventListener("abort", () => child.kill("SIGTERM"));
  });
}

function splitCwd(raw: string): { output: string; cwd?: string } {
  const marker = "\n__GLUE_CWD__";
  const at = raw.lastIndexOf(marker);
  if (at === -1) return { output: raw };
  const cwd = raw.slice(at + marker.length).trim();
  return { output: raw.slice(0, at), cwd };
}

function benignExit(command: string): boolean {
  const cmd = command.trim();
  const bin = cmd.split(/\s+/)[0] ?? "";
  if (["grep", "rg", "egrep", "fgrep", "diff", "test", "["].includes(bin)) return true;
  return cmd.startsWith("git diff") || cmd.startsWith("git grep");
}

function walk(root: string, ctx: ToolContext, visit: (file: string) => boolean): void {
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (seen++ > MAX_WALK) return;
      const abs = path.join(dir, name);
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        const rel = ctx.sandbox.relative(abs);
        if (SKIP_DIRS.has(name) || rel === ".agent/sessions" || rel.startsWith(".agent/sessions/")) continue;
        stack.push(abs);
      } else if (st.isFile()) {
        if (!visit(abs)) return;
      }
    }
  }
}

function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
  writeFileSync(tmp, content);
  try {
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function numberLines(lines: string[], start: number): string {
  const width = String(start + lines.length).length;
  return lines.map((line, index) => `${String(start + index).padStart(width)}|${line}`).join("\n");
}

function fail(message: string): ToolOutcome {
  return { ok: false, output: `Error: ${message}`, summary: message };
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function required(args: Record<string, unknown>, key: string): string {
  const value = str(args, key);
  if (value === undefined) throw new Error(`Missing string argument "${key}".`);
  return value;
}

function stringOrEmpty(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value === "string") return value;
  if (value === undefined) throw new Error(`Missing string argument "${key}".`);
  throw new Error(`Argument "${key}" must be a string.`);
}

function bool(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function int(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… output truncated`;
}

function trimOne(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
