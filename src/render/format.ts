import type { DiffLine } from "../types.js";

export const DISPLAY_NAME: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  list_dir: "LS",
  glob: "Glob",
  grep: "Grep",
  run_shell: "Bash",
  todo_write: "TodoWrite",
  ask_user: "AskUserQuestion",
  enter_plan_mode: "EnterPlanMode",
  exit_plan_mode: "ExitPlanMode",
  spawn_subagent: "Subagent",
  skill: "Skill",
};

export function displayName(tool: string): string {
  return DISPLAY_NAME[tool] ?? tool;
}

export function toolTarget(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : "";
  const pattern = typeof args.pattern === "string" ? args.pattern : "";
  const command = typeof args.command === "string" ? args.command : "";
  switch (name) {
    case "read_file":
    case "write_file":
    case "edit_file":
      return path || ".";
    case "list_dir":
      return path || ".";
    case "glob":
      return pattern;
    case "grep":
      return path ? `${pattern} · ${path}` : pattern;
    case "run_shell":
      return command;
    case "ask_user":
      return typeof args.question === "string" ? args.question : "";
    case "exit_plan_mode":
      return "plan";
    case "spawn_subagent":
      return typeof args.prompt === "string" ? args.prompt.replace(/\s+/g, " ").slice(0, 80) : "";
    case "skill":
      return typeof args.name === "string" ? args.name : "";
    default:
      return "";
  }
}

export function formatDiffPlain(lines: DiffLine[], limit = 24): string {
  const slice = lines.slice(0, limit);
  const body = slice
    .map((line) => {
      const mark = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      return `${mark} ${line.text}`;
    })
    .join("\n");
  if (lines.length > limit) return `${body}\n  …`;
  return body;
}

export function diffStatLabel(add: number, del: number): string {
  return `+${add} -${del}`;
}
