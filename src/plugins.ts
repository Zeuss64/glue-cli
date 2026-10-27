import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface PluginRecord {
  name: string;
  source: string;
  path: string;
  scope: "user" | "project";
}

export interface PluginRunResult {
  status: number | null;
  stderr: string;
}

export type PluginRunner = (command: string, args: string[]) => PluginRunResult;

interface StoredPlugin {
  name: string;
  source: string;
  path: string;
}

export function userPluginRegistry(home: string): string {
  return path.join(home, ".glue", "plugins.json");
}

export function projectPluginRegistry(workspace: string): string {
  return path.join(workspace, ".agent", "plugins.json");
}

export function parsePluginSource(input: string): { kind: "git"; name: string; url: string; source: string } | { kind: "local"; source: string } {
  const raw = input.trim().replace(/^['"]|['"]$/g, "");
  if (!raw) throw new Error("缺少插件来源。");
  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(raw);
  if (shorthand?.[1] && shorthand[2] && safePart(shorthand[1]) && safePart(shorthand[2])) {
    const repo = shorthand[2].replace(/\.git$/i, "");
    return {
      kind: "git",
      name: sanitizePluginName(repo),
      url: `https://github.com/${shorthand[1]}/${repo}.git`,
      source: `${shorthand[1]}/${repo}`,
    };
  }
  const https = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(raw);
  if (https?.[1] && https[2] && safePart(https[1]) && safePart(https[2])) {
    const repo = https[2];
    return { kind: "git", name: sanitizePluginName(repo), url: `https://github.com/${https[1]}/${repo}.git`, source: `${https[1]}/${repo}` };
  }
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(raw);
  if (ssh?.[1] && ssh[2] && safePart(ssh[1]) && safePart(ssh[2])) {
    return { kind: "git", name: sanitizePluginName(ssh[2]), url: raw, source: `${ssh[1]}/${ssh[2]}` };
  }
  if (/^(https?:|git@|ssh:)/i.test(raw)) {
    throw new Error("只支持 GitHub 仓库（owner/repo 或 https://github.com/owner/repo）。");
  }
  return { kind: "local", source: raw };
}

export function listPlugins(opts: { home: string; workspace: string }): PluginRecord[] {
  const map = new Map<string, PluginRecord>();
  for (const plugin of readRegistry(userPluginRegistry(opts.home), "user")) map.set(plugin.name, plugin);
  for (const plugin of readRegistry(projectPluginRegistry(opts.workspace), "project")) map.set(plugin.name, plugin);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatPluginList(records: readonly PluginRecord[]): string {
  if (!records.length) {
    return [
      "还没有插件。",
      "/plugin load <目录> 把本地技能库接到这个项目。",
      "/plugin install <owner/repo> 从 GitHub 安装到 ~/.glue/plugins。",
    ].join("\n");
  }
  const lines = ["插件"];
  for (const plugin of records) {
    const count = countSkillFiles(plugin.path);
    const where = existsSync(plugin.path) ? `${count} skill${count === 1 ? "" : "s"}` : "missing";
    lines.push(`  ${plugin.name.padEnd(16)} ${plugin.scope.padEnd(8)} ${where}  ${plugin.source}`);
  }
  lines.push("", "/plugin load <目录> · /plugin install <owner/repo|目录> · /plugin remove <name>");
  return lines.join("\n");
}

export function installPlugin(
  source: string,
  opts: { home: string; workspace: string; run?: PluginRunner },
): PluginRecord {
  const parsed = parsePluginSource(source);
  if (parsed.kind === "git") {
    const dest = path.join(opts.home, ".glue", "plugins", parsed.name);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    const run = opts.run ?? defaultRun;
    const result = run("git", ["clone", "--depth", "1", parsed.url, dest]);
    if (result.status !== 0) {
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      throw new Error((result.stderr || `git clone failed for ${parsed.url}`).trim());
    }
    const manifest = readManifest(dest);
    const record: StoredPlugin = { name: manifest.name || parsed.name, source: parsed.source, path: dest };
    writeRegistry(userPluginRegistry(opts.home), upsert(readStored(userPluginRegistry(opts.home)), record));
    return { ...record, scope: "user" };
  }
  const abs = path.resolve(opts.workspace, parsed.source);
  assertDirectory(abs, parsed.source);
  const manifest = readManifest(abs);
  const dest = path.join(opts.home, ".glue", "plugins", manifest.name);
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(abs, dest, { recursive: true, dereference: true, filter: skipHeavy });
  const record: StoredPlugin = { name: manifest.name, source: abs, path: dest };
  writeRegistry(userPluginRegistry(opts.home), upsert(readStored(userPluginRegistry(opts.home)), record));
  return { ...record, scope: "user" };
}

export function loadPlugin(source: string, opts: { workspace: string }): PluginRecord {
  const abs = path.resolve(opts.workspace, source.trim());
  assertDirectory(abs, source);
  const manifest = readManifest(abs);
  const record: StoredPlugin = { name: manifest.name, source: abs, path: abs };
  const file = projectPluginRegistry(opts.workspace);
  writeRegistry(file, upsert(readStored(file), record));
  return { ...record, scope: "project" };
}

export function removePlugin(name: string, opts: { home: string; workspace: string }): string {
  const key = sanitizePluginName(name);
  if (!key) throw new Error("缺少插件名。");
  const userFile = userPluginRegistry(opts.home);
  const projectFile = projectPluginRegistry(opts.workspace);
  const user = readStored(userFile);
  const project = readStored(projectFile);
  const hit = [...user, ...project].filter((plugin) => plugin.name === key);
  if (!hit.length) throw new Error(`没有插件 ${key}。`);
  writeRegistry(userFile, user.filter((plugin) => plugin.name !== key));
  writeRegistry(projectFile, project.filter((plugin) => plugin.name !== key));
  const root = path.resolve(opts.home, ".glue", "plugins");
  for (const plugin of hit) {
    const target = path.resolve(plugin.path);
    if (target === root || target.startsWith(root + path.sep)) rmSync(target, { recursive: true, force: true });
  }
  return key;
}

export function sanitizePluginName(value: string): string {
  const cleaned = value.trim().replace(/\.git$/i, "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64).toLowerCase();
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..")) return "";
  return cleaned;
}

function safePart(value: string): boolean {
  return value !== "." && value !== ".." && !value.includes("..");
}

function assertDirectory(abs: string, label: string): void {
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`找不到插件目录 ${label}`);
}

function readManifest(dir: string): { name: string; description: string } {
  const candidates = [
    path.join(dir, ".glue-plugin", "plugin.json"),
    path.join(dir, ".claude-plugin", "plugin.json"),
    path.join(dir, "plugin.json"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const name = typeof parsed.name === "string" ? sanitizePluginName(parsed.name) : "";
      const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
      if (name) return { name, description };
    } catch {
      /* a broken manifest falls through to the directory name */
    }
  }
  const name = sanitizePluginName(path.basename(dir));
  if (!name) throw new Error(`插件目录名不可用：${dir}`);
  return { name, description: "" };
}

function readRegistry(file: string, scope: PluginRecord["scope"]): PluginRecord[] {
  return readStored(file).map((plugin) => ({ ...plugin, scope }));
}

function readStored(file: string): StoredPlugin[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { plugins?: unknown };
    if (!Array.isArray(parsed.plugins)) return [];
    const out: StoredPlugin[] = [];
    for (const item of parsed.plugins) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? sanitizePluginName(record.name) : "";
      const source = typeof record.source === "string" ? record.source : "";
      const pluginPath = typeof record.path === "string" ? record.path : "";
      if (!name || !pluginPath) continue;
      out.push({ name, source, path: pluginPath });
    }
    return out;
  } catch {
    return [];
  }
}

function writeRegistry(file: string, plugins: StoredPlugin[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ plugins }, null, 2)}\n`);
}

function upsert(plugins: StoredPlugin[], record: StoredPlugin): StoredPlugin[] {
  return [...plugins.filter((plugin) => plugin.name !== record.name), record];
}

function skipHeavy(source: string): boolean {
  const base = path.basename(source);
  return base !== ".git" && base !== "node_modules";
}

function countSkillFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  if (existsSync(path.join(dir, "SKILL.md"))) count += 1;
  const skills = path.join(dir, "skills");
  if (!existsSync(skills)) return count;
  try {
    for (const entry of readdirSync(skills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(path.join(skills, entry.name, "SKILL.md"))) count += 1;
    }
  } catch {
    return count;
  }
  return count;
}

function defaultRun(command: string, args: string[]): PluginRunResult {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { status: result.status, stderr: `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() };
}
