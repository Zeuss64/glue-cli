import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ULTRACODE_DESCRIPTION } from "./effort.js";
import { packageRoot } from "./paths.js";
import type { PermissionMode } from "./types.js";

export interface PromptParts {
  workspace: string;
  profile: string;
  permissionMode: PermissionMode;
  shellEnabled: boolean;
  outputStyle: "normal" | "concise";
  extraRoots?: string[];
  append?: string;
  goal?: string;
  /** When true, every task runs as a dynamic workflow via `spawn_subagent`. */
  ultracode?: boolean;
  /** Name and description only. The body loads when a skill is active. */
  skillCatalog?: Array<{ id: string; description: string }>;
  activeSkill?: { id: string; body: string };
}

/** Session instructions while UltraCode is on. The first line is the public description. */
export function ultracodeWorkflow(): string {
  return [
    ULTRACODE_DESCRIPTION,
    "On every task, run a multi-step workflow: decompose the work and prefer spawn_subagent for each independent step. Wait for the report, then continue. A subagent cannot dispatch another subagent. This toggle does not change the effort level.",
  ].join("\n");
}

export function buildSystemPrompt(parts: PromptParts): string {
  const roots = [parts.workspace, ...(parts.extraRoots ?? [])];
  const lines = [
    "You are Glue, an interactive coding agent in the user's terminal (Glue Cli).",
    "You help with the software project in the workspace by reading, searching, and carefully editing files.",
    "",
    "How to work:",
    "- Understand the existing code before changing it. Prefer a small exact edit over a rewrite.",
    "- Use tools to inspect the workspace. Do not invent file contents, test results, or command output.",
    "- Read a file before editing it. old_string must be copied exactly and must be unique unless replace_all is true.",
    "- Use edit_file for partial changes and write_file only when creating a file or replacing it entirely.",
    "- After edits, say what changed in a sentence or two. Mention files by their workspace-relative path.",
    "- If a tool fails or the user denies it, adjust. Do not claim an edit succeeded unless the tool said so.",
    "- Stay inside the workspace roots. If a path is rejected, say so instead of trying to escape it.",
    "- Do not write secrets into files. Do not exfiltrate credentials from the environment.",
    "",
    "Domain profiles:",
    "- A profile may be appended below this prompt. Follow it for domain workflow and vocabulary.",
    "- If no profile is present, act as a general coding agent.",
    "- A profile never overrides the workspace boundary or a permission denial.",
    "",
    `Workspace: ${parts.workspace}`,
    roots.length > 1 ? `Additional directories: ${roots.slice(1).join(", ")}` : "",
    `Profile: ${parts.profile}`,
    `Permission mode: ${parts.permissionMode}`,
    parts.shellEnabled
      ? "Shell: enabled. The user may still be asked to approve commands. Prefer file tools for reading and editing."
      : "Shell: disabled. Do not call run_shell. Ask the user to enable shell in .agent/config.toml if a command is required.",
    parts.permissionMode === "plan"
      ? "Plan mode is on. Read and search only. When you have a plan, call exit_plan_mode. Do not edit files or run mutating commands."
      : "",
    parts.goal?.trim()
      ? `Current goal: ${parts.goal.trim()}\nKeep working toward this goal until it is done or the user changes it with /goal. Do not drop it for an unrelated task.`
      : "",
    parts.ultracode ? ultracodeWorkflow() : "",
    parts.outputStyle === "concise"
      ? "Output style: concise. Short paragraphs, no preamble, one sentence after a successful edit."
      : "",
  ].filter((line) => line !== "");

  const profile = loadProfileText(parts.profile, parts.workspace);
  if (profile) {
    lines.push("", `## Active profile: ${parts.profile}`, profile.text.trim());
  }
  const memory = loadMemory(parts.workspace);
  if (memory) {
    lines.push("", "## Project memory (AGENT.md)", memory.trim());
  }
  if (parts.skillCatalog?.length) {
    const rows = parts.skillCatalog.slice(0, 40).map((skill) => `- ${skill.id}${skill.description ? `: ${skill.description}` : ""}`);
    lines.push("", "## Skills", "Invoke one with /skill <id>. Follow a skill when the user asks for it or the description matches.", ...rows);
  }
  if (parts.activeSkill?.body.trim()) {
    lines.push("", `## Active skill: ${parts.activeSkill.id}`, parts.activeSkill.body.trim());
  }
  if (parts.append?.trim()) {
    lines.push("", "## Additional instructions", parts.append.trim());
  }
  return lines.join("\n");
}

export function loadProfileText(name: string, workspace: string): { text: string; source: string } | undefined {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe) return undefined;
  const candidates = [
    path.join(workspace, ".agent", "profiles", safe, "PROMPT.md"),
    path.join(packageRoot(), "profiles", safe, "PROMPT.md"),
  ];
  const chunks: string[] = [];
  const sources: string[] = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8").trim();
    if (!text) continue;
    chunks.push(text);
    sources.push(file);
  }
  if (!chunks.length) return undefined;
  return { text: chunks.join("\n\n"), source: sources.join(" + ") };
}

export function memoryPath(workspace: string): string {
  const root = path.join(workspace, "AGENT.md");
  if (existsSync(root)) return root;
  return path.join(workspace, ".agent", "AGENT.md");
}

export function loadMemory(workspace: string): string | undefined {
  const file = memoryPath(workspace);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8").trim();
  return text || undefined;
}

export const INIT_PROMPT = [
  "Explore this repository and write AGENT.md at the workspace root.",
  "Cover what the project is, how to install, how to test, and any conventions you actually found.",
  "Do not invent commands. Keep it under 80 lines. Use write_file or edit_file.",
].join(" ");
