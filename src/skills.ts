import { existsSync, readdirSync, readFileSync, realpathSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { listPlugins, readPluginManifest, resolveInsidePlugin, type PluginRecord } from "./plugins.js";
import { fitWidth } from "./tui/text.js";

export type SkillSource = "personal" | "project" | "plugin";

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  plugin?: string;
  path: string;
  /** Frontmatter `user-invocable`. False hides the skill from the `/` menu. */
  userInvocable: boolean;
  /** Frontmatter `disable-model-invocation`. True omits the skill from the system prompt catalog. */
  disableModelInvocation: boolean;
  /** Frontmatter `argument-hint`, shown at the end of a menu row. */
  argumentHint: string;
}

export interface ActiveSkill {
  id: string;
  body: string;
  description: string;
}

const BODY_LIMIT = 24_000;

export function parseSkillMarkdown(raw: string, fallbackName: string): {
  name: string;
  description: string;
  body: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  argumentHint: string;
} | undefined {
  const text = raw.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  let description = "";
  let body = text.trim();
  let name = sanitizeSkillName(fallbackName);
  let userInvocable = true;
  let disableModelInvocation = false;
  let argumentHint = "";
  if (match) {
    const front = frontMap(match[1] ?? "");
    body = (match[2] ?? "").trim();
    const named = sanitizeSkillName(front.get("name") ?? "");
    if (named) name = named;
    description = oneLine(front.get("description") ?? "").slice(0, 400);
    const invoke = frontFlag(front.get("user-invocable"));
    if (invoke !== undefined) userInvocable = invoke;
    const model = frontFlag(front.get("disable-model-invocation"));
    if (model !== undefined) disableModelInvocation = model;
    argumentHint = oneLine(front.get("argument-hint") ?? "").slice(0, 120);
  } else {
    const line = body.split(/\r?\n/).map((item) => item.trim()).find((item) => item && !item.startsWith("#"));
    description = oneLine(line ?? "").slice(0, 240);
  }
  if (!name) return undefined;
  if (!body && description) body = description;
  if (!body) return undefined;
  if (body.length > BODY_LIMIT) body = `${body.slice(0, BODY_LIMIT)}\n…`;
  return { name, description, body, userInvocable, disableModelInvocation, argumentHint };
}

export function discoverSkills(opts: { workspace: string; home: string }): Skill[] {
  const map = new Map<string, Skill>();
  const add = (skill: Skill | undefined) => {
    if (skill) map.set(skill.id, skill);
  };
  for (const skill of readSkillRoot(path.join(opts.home, ".glue", "skills"), "personal")) add(skill);
  const plugins = listPlugins(opts);
  for (const plugin of plugins.filter((item) => item.scope === "user")) {
    for (const skill of skillsFromPlugin(plugin)) add(skill);
  }
  for (const root of [path.join(opts.workspace, ".agent", "skills"), path.join(opts.workspace, ".glue", "skills")]) {
    for (const skill of readSkillRoot(root, "project")) add(skill);
  }
  for (const plugin of plugins.filter((item) => item.scope === "project")) {
    for (const skill of skillsFromPlugin(plugin)) add(skill);
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveSkill(skills: readonly Skill[], query: string): Skill | "ambiguous" | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const byId = skills.find((skill) => skill.id.toLowerCase() === q);
  if (byId) return byId;
  const byName = skills.filter((skill) => skill.name.toLowerCase() === q);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return "ambiguous";
  return undefined;
}

/** Skill directory, so the model can open sibling files such as `tests.md` or `UI.md`. */
export function skillBaseDirectory(skill: Pick<Skill, "path">): string {
  return path.dirname(path.resolve(skill.path));
}

/** Body returned by the skill tool and stored on the active skill. */
export function activatedSkillBody(skill: Pick<Skill, "path" | "body">): string {
  return `Base directory for this skill: ${skillBaseDirectory(skill)}\n\n${skill.body.trim()}`;
}

export function toActiveSkill(skill: Skill): ActiveSkill {
  return { id: skill.id, body: activatedSkillBody(skill), description: skill.description };
}

export function skillSourceLabel(skill: Pick<Skill, "source" | "plugin">): string {
  if (skill.source === "plugin") return `plugin:${skill.plugin || "plugin"}`;
  return skill.source;
}

/** Collapse a multiline description to one line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function skillMenuSummary(skill: Pick<Skill, "source" | "plugin" | "description" | "argumentHint">): string {
  return [`(${skillSourceLabel(skill)})`, oneLine(skill.description), oneLine(skill.argumentHint)].filter(Boolean).join(" ");
}

/** Names and descriptions the model may see. `disable-model-invocation` skills are omitted. */
export function skillCatalogEntries(skills: readonly Skill[]): Array<{ id: string; description: string; argumentHint?: string }> {
  return skills.filter((skill) => !skill.disableModelInvocation).map((skill) => ({
    id: skill.id,
    description: skill.description,
    ...(skill.argumentHint ? { argumentHint: skill.argumentHint } : {}),
  }));
}

export function formatSkillList(skills: readonly Skill[], columns = 80): string {
  if (!skills.length) {
    return [
      "还没有技能。",
      "项目：.glue/skills/<name>/SKILL.md 或 .agent/skills/<name>/SKILL.md",
      "个人：~/.glue/skills/<name>/SKILL.md",
      "插件：/plugin load <目录> 或 /plugin install <owner/repo>",
    ].join("\n");
  }
  const width = Math.max(4, columns);
  const lines = ["技能"];
  for (const skill of skills) {
    const desc = oneLine(skill.description);
    const prefix = `  ${skill.id.padEnd(18)} ${skillSourceLabel(skill)}`;
    lines.push(fitWidth(desc ? `${prefix}  ${desc}` : prefix, width));
  }
  lines.push("", "/skill <name> [要求] 加载并执行。/skill clear 取消。");
  return lines.join("\n");
}

export function sanitizeSkillName(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64).toLowerCase();
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  return cleaned;
}

export function skillsFromPlugin(plugin: PluginRecord): Skill[] {
  if (!plugin.path || !existsSync(plugin.path)) return [];
  let listed: string[] = [];
  try {
    listed = readPluginManifest(plugin.path).skills;
  } catch {
    listed = [];
  }
  const found = new Map<string, Skill>();
  addSkillFiles(found, [path.join(plugin.path, "SKILL.md")], plugin.name, plugin.name);
  const skillsDir = path.join(plugin.path, "skills");
  const shallow = collectSkillFiles(skillsDir, 1);
  addSkillFiles(found, shallow, plugin.name);
  const fromManifest: string[] = [];
  for (const rel of listed) {
    const abs = resolveInsidePlugin(plugin.path, rel);
    if (!abs) continue;
    fromManifest.push(...filesAt(abs));
  }
  addSkillFiles(found, fromManifest, plugin.name);
  // A manifest skills list is the curated set. Without one, walk skills/ down to depth 3.
  if (listed.length === 0) addSkillFiles(found, collectSkillFiles(skillsDir, 3), plugin.name);
  return [...found.values()];
}

function addSkillFiles(into: Map<string, Skill>, files: readonly string[], pluginName: string, fallbackName?: string): void {
  for (const file of files) {
    const fallback = fallbackName ?? path.basename(path.dirname(file));
    for (const skill of readSkillFile(file, fallback, "plugin", pluginName)) {
      const key = pathKey(skill.path);
      if (!into.has(key)) into.set(key, skill);
    }
  }
}

function filesAt(abs: string): string[] {
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(abs);
  } catch {
    return [];
  }
  if (info.isFile()) return path.basename(abs) === "SKILL.md" ? [abs] : [];
  if (!info.isDirectory()) return [];
  const own = path.join(abs, "SKILL.md");
  if (existsSync(own)) return [own];
  const one = collectSkillFiles(abs, 1);
  if (one.length) return one;
  return collectSkillFiles(abs, 3);
}

function collectSkillFiles(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  walkSkillDirs(root, 1, maxDepth, out);
  return out;
}

function walkSkillDirs(dir: string, depth: number, maxDepth: number, out: string[]): void {
  if (depth > maxDepth || !existsSync(dir)) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    const skill = path.join(full, "SKILL.md");
    if (existsSync(skill)) out.push(skill);
    else if (depth < maxDepth) walkSkillDirs(full, depth + 1, maxDepth, out);
  }
}

function pathKey(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

function readSkillRoot(root: string, source: SkillSource, plugin?: string): Skill[] {
  if (!existsSync(root)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const entry of entries) {
    if (!entry || entry.startsWith(".") || entry === "node_modules") continue;
    const dir = path.join(root, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push(...readSkillFile(path.join(dir, "SKILL.md"), entry, source, plugin));
  }
  return out;
}

function readSkillFile(file: string, fallbackName: string, source: SkillSource, plugin?: string): Skill[] {
  if (!existsSync(file)) return [];
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const parsed = parseSkillMarkdown(raw, fallbackName);
  if (!parsed) return [];
  const id = plugin ? `${plugin}:${parsed.name}` : parsed.name;
  return [{
    id,
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    source,
    plugin,
    path: file,
    userInvocable: parsed.userInvocable,
    disableModelInvocation: parsed.disableModelInvocation,
    argumentHint: parsed.argumentHint,
  }];
}

interface BlockHeader {
  style: "fold" | "literal";
  chomp: "clip" | "strip" | "keep";
  indent: number;
}

/** Frontmatter values, including `>`, `|`, and an empty key whose value continues on indented lines. */
function frontMap(meta: string): Map<string, string> {
  const lines = meta.split(/\r?\n/);
  const map = new Map<string, string>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trim().startsWith("#")) {
      i += 1;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const key = (match[1] ?? "").toLowerCase();
    const raw = match[2] ?? "";
    const header = parseBlockHeader(raw);
    if (header) {
      const read = readBlock(lines, i + 1, header);
      map.set(key, read.value);
      i = read.next;
      continue;
    }
    const plain = parsePlain(raw);
    if (!plain && hasIndentedContinuation(lines, i + 1)) {
      const read = readBlock(lines, i + 1, { style: "fold", chomp: "clip", indent: 0 });
      map.set(key, read.value);
      i = read.next;
      continue;
    }
    map.set(key, plain);
    i += 1;
  }
  return map;
}

function parseBlockHeader(raw: string): BlockHeader | undefined {
  let text = raw.trim();
  const comment = text.search(/\s#/);
  if (comment !== -1) text = text.slice(0, comment).trim();
  if (!text || (text[0] !== ">" && text[0] !== "|")) return undefined;
  let chomp: BlockHeader["chomp"] = "clip";
  let indent = 0;
  let sawChomp = false;
  let sawIndent = false;
  for (let index = 1; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    if ((ch === "+" || ch === "-") && !sawChomp) {
      chomp = ch === "+" ? "keep" : "strip";
      sawChomp = true;
      continue;
    }
    if (ch >= "1" && ch <= "9" && !sawIndent) {
      indent = Number(ch);
      sawIndent = true;
      continue;
    }
    return undefined;
  }
  return { style: text[0] === "|" ? "literal" : "fold", chomp, indent };
}

function readBlock(lines: readonly string[], start: number, header: BlockHeader): { value: string; next: number } {
  const kept: string[] = [];
  let index = start;
  let contentIndent = header.indent > 0 ? header.indent : -1;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      if (contentIndent === -1) {
        index += 1;
        continue;
      }
      kept.push("");
      index += 1;
      continue;
    }
    const indent = leadingIndent(line);
    if (contentIndent === -1) {
      if (indent === 0) break;
      contentIndent = indent;
    }
    if (indent < contentIndent) break;
    kept.push(line.slice(contentIndent));
    index += 1;
  }
  const joined = header.style === "literal" ? kept.join("\n") : foldScalar(kept);
  return { value: applyChomp(joined, header.chomp), next: index };
}

function hasIndentedContinuation(lines: readonly string[], start: number): boolean {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line.trim()) continue;
    return leadingIndent(line) > 0;
  }
  return false;
}

function leadingIndent(line: string): number {
  let count = 0;
  while (count < line.length && (line[count] === " " || line[count] === "\t")) count += 1;
  return count;
}

function foldScalar(lines: readonly string[]): string {
  const parts: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    parts.push(paragraph.join(" "));
    paragraph = [];
  };
  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return parts.join("\n");
}

function applyChomp(text: string, chomp: BlockHeader["chomp"]): string {
  if (!text) return "";
  const withBreak = text.endsWith("\n") ? text : `${text}\n`;
  if (chomp === "keep") return withBreak;
  if (chomp === "strip") return withBreak.replace(/\n+$/, "");
  return withBreak.replace(/\n+$/, "\n");
}

function parsePlain(raw: string): string {
  let value = raw.trim().replace(/\s+#.*$/, "").trim();
  if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

function frontFlag(raw: string | undefined): boolean | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return undefined;
  if (value === "true" || value === "yes" || value === "1" || value === "on") return true;
  if (value === "false" || value === "no" || value === "0" || value === "off") return false;
  return undefined;
}
