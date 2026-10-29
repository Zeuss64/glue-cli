import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { skillsFromPlugin } from "./skills.js";

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

export type PluginScope = "user" | "project";

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

/** Identity and skill paths from `.glue-plugin`, `.claude-plugin`, or `plugin.json`. */
export interface PluginManifest {
  name: string;
  description: string;
  version: string;
  author?: PluginAuthor;
  homepage: string;
  repository: string;
  license: string;
  keywords: string[];
  /** Skill directories or `SKILL.md` files, as written in the manifest. Empty when the file omits `skills`. */
  skills: string[];
}

export type PluginCommand =
  | { action: "list" }
  | { action: "install"; source: string; scope: PluginScope }
  | { action: "load"; source: string; scope: PluginScope }
  | { action: "remove"; target: string };

interface StoredPlugin {
  name: string;
  source: string;
  path: string;
}

interface ManifestInfo {
  manifest: PluginManifest;
  namedByFile: boolean;
}

interface MarketPlugin {
  name: string;
  /** Empty string means the repository root. */
  relative: string;
}

export function userPluginRegistry(home: string): string {
  return path.join(home, ".glue", "plugins.json");
}

export function projectPluginRegistry(workspace: string): string {
  return path.join(workspace, ".agent", "plugins.json");
}

export function parsePluginCommand(args: string): PluginCommand {
  const trimmed = args.trim();
  if (!trimmed || /^(list|列表)$/i.test(trimmed)) return { action: "list" };
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const sub = (tokens[0] ?? "").toLowerCase();
  const rest = tokens.slice(1);
  if (sub === "list" || sub === "列表") throw new Error("用法：/plugin list");
  if (sub === "install" || sub === "add") {
    const parsed = takeScope(rest, "user");
    if (!parsed.source) throw new Error("用法：/plugin install <owner/repo|目录> [--scope user|project]");
    return { action: "install", source: parsed.source, scope: parsed.scope };
  }
  if (sub === "load") {
    const parsed = takeScope(rest, "project");
    if (!parsed.source) throw new Error("用法：/plugin load <目录> [--scope user|project]");
    return { action: "load", source: parsed.source, scope: parsed.scope };
  }
  if (sub === "remove" || sub === "uninstall" || sub === "rm") {
    if (rest.some((token) => token === "--scope" || token.startsWith("--scope="))) throw new Error("用法：/plugin remove <name|来源>");
    const target = rest.join(" ");
    if (!target) throw new Error("用法：/plugin remove <name|来源>");
    return { action: "remove", target };
  }
  throw new Error("未知的插件命令。用法：/plugin list，/plugin install <owner/repo|目录> [--scope user|project]，/plugin load <目录> [--scope user|project]，/plugin remove <name|来源>。");
}

export function parsePluginSource(input: string): { kind: "git"; name: string; url: string; source: string } | { kind: "local"; source: string } {
  const raw = input.trim().replace(/^['"]|['"]$/g, "");
  if (!raw) throw new Error("缺少插件来源。");
  if (/^(https?:|git@|ssh:)/i.test(raw) || /^github\.com\//i.test(raw)) return parseRemoteSource(raw);
  if (isOwnerRepoAttempt(raw)) return parseOwnerRepo(raw);
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
    const where = pluginSkillLabel(plugin);
    lines.push(`  ${plugin.name.padEnd(16)} ${plugin.scope.padEnd(8)} ${where}  ${plugin.source}`);
  }
  lines.push("", "/plugin load <目录> [--scope user|project] · /plugin install <owner/repo|目录> [--scope user|project] · /plugin remove <name|来源>");
  return lines.join("\n");
}

export function installPlugin(
  source: string,
  opts: { home: string; workspace: string; scope?: PluginScope; run?: PluginRunner },
): PluginRecord {
  const scope = opts.scope ?? "user";
  assertScope(scope);
  const parsed = parsePluginSource(source);
  if (parsed.kind === "git") {
    const dest = pluginInstallDir(scope, parsed.name, opts);
    mkdirSync(path.dirname(dest), { recursive: true });
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    const run = opts.run ?? defaultRun;
    const result = run("git", ["clone", "--depth", "1", parsed.url, dest]);
    if (result.status !== 0) {
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      throw new Error((result.stderr || `git clone failed for ${parsed.url}`).trim());
    }
    const located = locatePlugin(dest);
    const record: StoredPlugin = { name: located.name, source: parsed.source, path: located.path };
    const file = registryFile(scope, opts);
    writeRegistry(file, upsert(readStored(file), record));
    return { ...record, scope };
  }
  const abs = path.resolve(opts.workspace, parsed.source);
  assertDirectory(abs, parsed.source);
  const located = locatePlugin(abs);
  const dest = pluginInstallDir(scope, located.name, opts);
  mkdirSync(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(located.path, dest, { recursive: true, dereference: true, filter: skipHeavy });
  const record: StoredPlugin = { name: located.name, source: abs, path: dest };
  const file = registryFile(scope, opts);
  writeRegistry(file, upsert(readStored(file), record));
  return { ...record, scope };
}

export function loadPlugin(source: string, opts: { workspace: string; home?: string; scope?: PluginScope }): PluginRecord {
  const scope = opts.scope ?? "project";
  assertScope(scope);
  if (scope === "user" && !opts.home) throw new Error("缺少用户目录。");
  const abs = path.resolve(opts.workspace, source.trim());
  assertDirectory(abs, source);
  const located = locatePlugin(abs);
  const record: StoredPlugin = { name: located.name, source: abs, path: located.path };
  const file = scope === "user" ? userPluginRegistry(opts.home ?? "") : projectPluginRegistry(opts.workspace);
  writeRegistry(file, upsert(readStored(file), record));
  return { ...record, scope };
}

export function removePlugin(name: string, opts: { home: string; workspace: string }): string {
  const query = name.trim();
  if (!query) throw new Error("缺少插件名。");
  const userFile = userPluginRegistry(opts.home);
  const projectFile = projectPluginRegistry(opts.workspace);
  const user = readStored(userFile);
  const project = readStored(projectFile);
  const hit = [...user, ...project].filter((plugin) => pluginMatches(plugin, query, opts.workspace));
  if (!hit.length) throw new Error(`没有插件 ${query}。`);
  writeRegistry(userFile, user.filter((plugin) => !pluginMatches(plugin, query, opts.workspace)));
  writeRegistry(projectFile, project.filter((plugin) => !pluginMatches(plugin, query, opts.workspace)));
  const removed = new Set<string>();
  for (const plugin of hit) {
    const target = managedInstallRoot(plugin.path, opts);
    if (!target || removed.has(target)) continue;
    removed.add(target);
    rmSync(target, { recursive: true, force: true });
  }
  return [...new Set(hit.map((plugin) => plugin.name))].join("、");
}

export function sanitizePluginName(value: string): string {
  const cleaned = value.trim().replace(/\.git$/i, "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64).toLowerCase();
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..")) return "";
  return cleaned;
}

export function readPluginManifest(dir: string): PluginManifest {
  return readPluginManifestInfo(dir).manifest;
}

/** Resolve a manifest path and reject absolute paths, `..`, and symlinks that leave the plugin root. */
export function resolveInsidePlugin(root: string, rel: string): string | undefined {
  if (typeof rel !== "string") return undefined;
  const spec = rel.trim();
  if (!spec || spec.includes("\0")) return undefined;
  if (path.isAbsolute(spec) || path.win32.isAbsolute(spec) || path.posix.isAbsolute(spec)) return undefined;
  const segments = spec.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => segment === "..")) return undefined;
  const safe = segments.filter((segment) => segment && segment !== ".");
  const abs = path.resolve(root, ...safe);
  const base = path.resolve(root);
  const relToBase = path.relative(base, abs);
  if (relToBase.startsWith("..") || path.isAbsolute(relToBase)) return undefined;
  if (!existsSync(abs)) return undefined;
  try {
    const realBase = realpathSync(base);
    const realAbs = realpathSync(abs);
    const relReal = path.relative(realBase, realAbs);
    if (relReal.startsWith("..") || path.isAbsolute(relReal)) return undefined;
    return realAbs;
  } catch {
    return undefined;
  }
}

function pluginSkillLabel(plugin: PluginRecord): string {
  if (!existsSync(plugin.path)) return "missing";
  try {
    const count = skillsFromPlugin(plugin).length;
    return `${count} skill${count === 1 ? "" : "s"}`;
  } catch {
    return "missing";
  }
}

function takeScope(tokens: string[], fallback: PluginScope): { source: string; scope: PluginScope } {
  let scope: PluginScope | undefined;
  const source: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (token === "--scope" || token.startsWith("--scope=")) {
      const raw = token === "--scope" ? tokens[++i] : token.slice("--scope=".length);
      const value = raw?.toLowerCase();
      if (value !== "user" && value !== "project") throw new Error("--scope 只能是 user 或 project。");
      if (scope && scope !== value) throw new Error("--scope 只能指定一次。");
      scope = value;
      continue;
    }
    source.push(token);
  }
  return { source: source.join(" "), scope: scope ?? fallback };
}

function assertScope(scope: PluginScope): void {
  if (scope !== "user" && scope !== "project") throw new Error("--scope 只能是 user 或 project。");
}

function isOwnerRepoAttempt(raw: string): boolean {
  if (path.isAbsolute(raw) || raw.startsWith(".") || raw.startsWith("~") || raw.includes("\\")) return false;
  const parts = raw.split("/");
  if (parts.length === 2) return true;
  return parts.length === 3 && parts[2] === "";
}

function parseOwnerRepo(raw: string): { kind: "git"; name: string; url: string; source: string } {
  const body = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  const parts = body.split("/");
  const owner = parts[0] ?? "";
  const repoRaw = parts[1] ?? "";
  if (parts.length !== 2 || !owner || !repoRaw) throw new Error("仓库要写成 owner/repo。");
  const repo = repoRaw.replace(/\.git$/i, "");
  if (!repo || !githubPart(owner) || !githubPart(repo)) {
    throw new Error("仓库要写成 owner/repo，只含字母、数字、点、下划线和短横线。");
  }
  return gitSource(owner, repo, `https://github.com/${owner}/${repo}.git`);
}

function parseRemoteSource(raw: string): { kind: "git"; name: string; url: string; source: string } {
  const https = /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(raw);
  if (https?.[1] && https[2] && githubPart(https[1]) && githubPart(https[2])) return gitSource(https[1], https[2], `https://github.com/${https[1]}/${https[2]}.git`);
  const ssh = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(raw);
  if (ssh?.[1] && ssh[2] && githubPart(ssh[1]) && githubPart(ssh[2])) return gitSource(ssh[1], ssh[2], raw);
  if (/github\.com/i.test(raw)) {
    throw new Error("GitHub 仓库要写成 owner/repo，或 https://github.com/owner/repo，不要带额外路径。");
  }
  throw new Error("只支持 GitHub 仓库（owner/repo 或 https://github.com/owner/repo）。");
}

function gitSource(owner: string, repo: string, url: string): { kind: "git"; name: string; url: string; source: string } {
  const name = sanitizePluginName(repo);
  if (!name) throw new Error("仓库名不可用。");
  return { kind: "git", name, url, source: `${owner}/${repo}` };
}

function githubPart(value: string): boolean {
  return /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== ".." && !value.includes("..");
}

function pluginInstallDir(scope: PluginScope, name: string, opts: { home: string; workspace: string }): string {
  const root = scope === "project" ? path.join(opts.workspace, ".agent", "plugins") : path.join(opts.home, ".glue", "plugins");
  return path.join(root, name);
}

function registryFile(scope: PluginScope, opts: { home: string; workspace: string }): string {
  return scope === "project" ? projectPluginRegistry(opts.workspace) : userPluginRegistry(opts.home);
}

function locatePlugin(dir: string): { name: string; path: string } {
  const market = readSinglePluginMarketplace(dir);
  let root = dir;
  if (market?.relative) {
    const resolved = resolveInsidePlugin(dir, market.relative);
    if (resolved && isDirectory(resolved)) root = resolved;
  }
  const info = readPluginManifestInfo(root);
  const marketName = market ? sanitizePluginName(market.name) : "";
  const name = info.namedByFile ? info.manifest.name : marketName || info.manifest.name;
  if (!name) throw new Error(`插件目录名不可用：${dir}`);
  return { name, path: root };
}

function readSinglePluginMarketplace(dir: string): MarketPlugin | undefined {
  for (const file of [path.join(dir, ".glue-plugin", "marketplace.json"), path.join(dir, ".claude-plugin", "marketplace.json")]) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      if (!Array.isArray(parsed.plugins) || parsed.plugins.length !== 1) return undefined;
      const entry = parsed.plugins[0];
      if (!entry || typeof entry !== "object") return undefined;
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : "";
      const relative = relativeMarketplaceSource(record.source);
      if (relative === undefined) return undefined;
      return { name, relative };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function relativeMarketplaceSource(source: unknown): string | undefined {
  const spec = marketplaceSourceSpec(source);
  if (spec === undefined) return undefined;
  if (spec === "." || spec === "./") return "";
  if (!spec.startsWith("./") && !spec.startsWith(".\\")) return undefined;
  const cleaned = spec.replace(/^\.[\\/]/, "").replace(/[\\/]+$/, "");
  if (!cleaned) return "";
  if (cleaned.split(/[\\/]/).some((part) => !part || part === "." || part === "..")) return undefined;
  return cleaned;
}

function marketplaceSourceSpec(source: unknown): string | undefined {
  if (typeof source === "string") return source.trim();
  if (!source || typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  const kind = typeof record.source === "string" ? record.source.trim() : "";
  if (/^(github|git|url)$/i.test(kind)) return undefined;
  if (typeof record.path === "string" && record.path.trim()) return record.path.trim();
  if (kind.startsWith(".")) return kind;
  return undefined;
}

function readPluginManifestInfo(dir: string): ManifestInfo {
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
      if (!name) continue;
      const author = parseAuthor(parsed.author);
      const manifest: PluginManifest = {
        name,
        description: asString(parsed.description),
        version: asString(parsed.version),
        homepage: asString(parsed.homepage),
        repository: asRepository(parsed.repository),
        license: asString(parsed.license),
        keywords: parseKeywords(parsed.keywords),
        skills: parseSkillPaths(parsed.skills),
      };
      if (author) manifest.author = author;
      return { manifest, namedByFile: true };
    } catch {
      /* a broken manifest falls through to the next file, then the directory name */
    }
  }
  const name = sanitizePluginName(path.basename(dir));
  if (!name) throw new Error(`插件目录名不可用：${dir}`);
  return {
    manifest: { name, description: "", version: "", homepage: "", repository: "", license: "", keywords: [], skills: [] },
    namedByFile: false,
  };
}

function parseAuthor(value: unknown): PluginAuthor | undefined {
  if (typeof value === "string") {
    const name = value.trim();
    return name ? { name } : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = asString(record.name);
  if (!name) return undefined;
  const author: PluginAuthor = { name };
  const email = asString(record.email);
  const url = asString(record.url);
  if (email) author.email = email;
  if (url) author.url = url;
  return author;
}

function parseKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function parseSkillPaths(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) out.push(trimmed);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const candidate = record.path ?? record.skill;
    if (typeof candidate === "string" && candidate.trim()) out.push(candidate.trim());
  }
  return out;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRepository(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return asString((value as Record<string, unknown>).url);
  return "";
}

function pluginMatches(plugin: StoredPlugin, query: string, workspace: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (!/[\\/]/.test(trimmed) && plugin.name === sanitizePluginName(trimmed)) return true;
  if (plugin.source === trimmed) return true;
  let parsed: ReturnType<typeof parsePluginSource>;
  try {
    parsed = parsePluginSource(trimmed);
  } catch {
    return false;
  }
  if (parsed.kind === "git") return plugin.source.toLowerCase() === parsed.source.toLowerCase();
  const abs = path.resolve(workspace, parsed.source);
  return samePath(plugin.source, abs) || samePath(plugin.source, parsed.source) || samePath(plugin.path, abs);
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function managedInstallRoot(target: string, opts: { home: string; workspace: string }): string | undefined {
  let resolved = path.resolve(target);
  try {
    resolved = realpathSync(resolved);
  } catch {
    return undefined;
  }
  const bases = [path.resolve(opts.home, ".glue", "plugins"), path.resolve(opts.workspace, ".agent", "plugins")];
  for (const base of bases) {
    let realBase = base;
    try {
      if (existsSync(base)) realBase = realpathSync(base);
    } catch {
      continue;
    }
    const rel = path.relative(realBase, resolved);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const top = rel.split(path.sep)[0];
    if (!top || top === "." || top === "..") continue;
    return path.join(realBase, top);
  }
  return undefined;
}

function assertDirectory(abs: string, label: string): void {
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error(`找不到插件目录 ${label}`);
}

function isDirectory(abs: string): boolean {
  try {
    return statSync(abs).isDirectory();
  } catch {
    return false;
  }
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

function defaultRun(command: string, args: string[]): PluginRunResult {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { status: result.status, stderr: `${result.stderr ?? ""}${result.stdout ?? ""}`.trim() };
}
