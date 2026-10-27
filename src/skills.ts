import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { listPlugins, type PluginRecord } from "./plugins.js";

export type SkillSource = "personal" | "project" | "plugin";

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  source: SkillSource;
  plugin?: string;
  path: string;
}

export interface ActiveSkill {
  id: string;
  body: string;
  description: string;
}

const BODY_LIMIT = 24_000;

export function parseSkillMarkdown(raw: string, fallbackName: string): { name: string; description: string; body: string } | undefined {
  const text = raw.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  let description = "";
  let body = text.trim();
  let name = sanitizeSkillName(fallbackName);
  if (match) {
    const meta = match[1] ?? "";
    body = (match[2] ?? "").trim();
    const named = sanitizeSkillName(frontValue(meta, "name"));
    if (named) name = named;
    description = frontValue(meta, "description");
  } else {
    const line = body.split(/\r?\n/).map((item) => item.trim()).find((item) => item && !item.startsWith("#"));
    description = (line ?? "").slice(0, 240);
  }
  if (!name) return undefined;
  if (!body && description) body = description;
  if (!body) return undefined;
  if (body.length > BODY_LIMIT) body = `${body.slice(0, BODY_LIMIT)}\n…`;
  return { name, description: description.slice(0, 400), body };
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

export function toActiveSkill(skill: Skill): ActiveSkill {
  return { id: skill.id, body: skill.body, description: skill.description };
}

export function formatSkillList(skills: readonly Skill[]): string {
  if (!skills.length) {
    return [
      "还没有技能。",
      "项目：.glue/skills/<name>/SKILL.md 或 .agent/skills/<name>/SKILL.md",
      "个人：~/.glue/skills/<name>/SKILL.md",
      "插件：/plugin load <目录> 或 /plugin install <owner/repo>",
    ].join("\n");
  }
  const lines = ["技能"];
  for (const skill of skills) {
    const desc = skill.description ? `  ${skill.description.replace(/\s+/g, " ").slice(0, 72)}` : "";
    lines.push(`  ${skill.id.padEnd(18)} ${skill.source}${desc}`);
  }
  lines.push("", "/skill <name> [要求] 加载并执行。/skill clear 取消。");
  return lines.join("\n");
}

export function sanitizeSkillName(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 64).toLowerCase();
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  return cleaned;
}

function skillsFromPlugin(plugin: PluginRecord): Skill[] {
  return [
    ...readSkillRoot(path.join(plugin.path, "skills"), "plugin", plugin.name),
    ...readSkillFile(path.join(plugin.path, "SKILL.md"), plugin.name, "plugin", plugin.name),
  ];
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
  return [{ id, name: parsed.name, description: parsed.description, body: parsed.body, source, plugin, path: file }];
}

function frontValue(meta: string, key: string): string {
  for (const line of meta.split(/\r?\n/)) {
    const match = new RegExp(`^${key}\\s*:\\s*(.*)$`, "i").exec(line.trim());
    if (!match) continue;
    let value = (match[1] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim();
  }
  return "";
}
