import type { ToolDef } from "../types.js";

function parameters(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

const pathProp = { type: "string", description: "File or directory path, relative to the workspace or absolute inside it." };

export function toolDefinitions(shellEnabled: boolean): ToolDef[] {
  const tools: ToolDef[] = [
    {
      name: "list_dir",
      description: "List one directory level inside the workspace. Defaults to the workspace root.",
      parameters: parameters({ path: pathProp }, []),
    },
    {
      name: "read_file",
      description:
        "Read a text file inside the workspace and return numbered lines. Read a file before editing it. Use offset and limit for large files.",
      parameters: parameters(
        {
          path: pathProp,
          offset: { type: "integer", description: "1-based line to start at." },
          limit: { type: "integer", description: "How many lines to return. Defaults to 2000." },
        },
        ["path"],
      ),
    },
    {
      name: "write_file",
      description:
        "Create a file or overwrite it entirely with the provided content. Prefer edit_file for partial changes. Refuses paths outside the workspace.",
      parameters: parameters({ path: pathProp, content: { type: "string", description: "Full new file contents." } }, ["path", "content"]),
    },
    {
      name: "edit_file",
      description:
        "Replace an exact snippet in a file. old_string must match the file text exactly, including whitespace, and must occur once unless replace_all is true. Read the file first.",
      parameters: parameters(
        {
          path: pathProp,
          old_string: { type: "string", description: "Exact text to replace." },
          new_string: { type: "string", description: "Replacement text. May be empty to delete the snippet." },
          replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match." },
        },
        ["path", "old_string", "new_string"],
      ),
    },
    {
      name: "glob",
      description: "Find files by glob pattern, such as **/*.ts. Skips node_modules, .git, dist, and coverage. Returns up to 100 paths.",
      parameters: parameters(
        {
          pattern: { type: "string", description: "Glob pattern." },
          path: { type: "string", description: "Directory to search. Defaults to the workspace." },
        },
        ["pattern"],
      ),
    },
    {
      name: "grep",
      description:
        "Search file contents with a regular expression. Returns path:line:text for up to 100 matches. Skips binary files and dependency directories.",
      parameters: parameters(
        {
          pattern: { type: "string", description: "JavaScript regular expression." },
          path: { type: "string", description: "File or directory to search. Defaults to the workspace." },
          glob: { type: "string", description: "Optional glob filter, such as **/*.ts." },
        },
        ["pattern"],
      ),
    },
    {
      name: "todo_write",
      description: "Replace the session checklist. Use it for multi-step work. Keep one item in_progress.",
      parameters: parameters(
        {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
              required: ["id", "content", "status"],
            },
          },
        },
        ["todos"],
      ),
    },
    {
      name: "ask_user",
      description:
        "Ask the user one multiple-choice question when you cannot proceed without a decision. Do not use it to confirm ordinary edits.",
      parameters: parameters(
        {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, description: "Two to four short choices." },
        },
        ["question", "options"],
      ),
    },
    {
      name: "enter_plan_mode",
      description:
        "Switch to plan mode before a large or risky change. In plan mode you may read and search, but not edit, until the user approves a plan.",
      parameters: parameters({ reason: { type: "string" } }, []),
    },
    {
      name: "exit_plan_mode",
      description: "Present a written plan and ask the user to approve it. Include the files you will change and how you will verify the work.",
      parameters: parameters({ plan: { type: "string" } }, ["plan"]),
    },
  ];
  if (shellEnabled) {
    tools.push({
      name: "run_shell",
      description:
        "Run a shell command with a working directory inside the workspace. Do not use it to read or edit files; use the file tools. The user may be asked to approve the command. A bare cd persists only when it stays inside the workspace.",
      parameters: parameters(
        {
          command: { type: "string", description: "The shell command to run." },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds. Defaults to 120000." },
          run_in_background: { type: "boolean", description: "Start the command and return a task id without waiting." },
        },
        ["command"],
      ),
    });
  }
  return tools;
}
