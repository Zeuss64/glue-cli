export interface CliArgs {
  help: boolean;
  version: boolean;
  doctor: boolean;
  print: boolean;
  continueSession: boolean;
  resume?: string;
  openResume: boolean;
  cwd?: string;
  model?: string;
  baseURL?: string;
  protocol?: string;
  permissionMode?: string;
  dangerouslySkip: boolean;
  allowBypass: boolean;
  allowedTools: string[];
  addDir: string[];
  profile?: string;
  configPath?: string;
  appendSystem?: string;
  output: "text" | "json";
  prompt?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    version: false,
    doctor: false,
    print: false,
    continueSession: false,
    openResume: false,
    dangerouslySkip: false,
    allowBypass: false,
    allowedTools: [],
    addDir: [],
    output: "text",
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    const take = (flag: string): string => {
      const value = argv[++i];
      if (value === undefined || value.startsWith("-")) throw new Error(`Missing value for ${flag}`);
      return value;
    };
    if (token === "--") {
      rest.push(...argv.slice(i + 1));
      break;
    }
    if (token === "-h" || token === "--help" || token === "help") args.help = true;
    else if (token === "-V" || token === "-v" || token === "--version") args.version = true;
    else if (token === "-p" || token === "--print") args.print = true;
    else if (token === "-c" || token === "--continue") args.continueSession = true;
    else if (token === "--resume" || token === "-r") args.resume = take(token);
    else if (token === "--cwd") args.cwd = take(token);
    else if (token === "--model" || token === "-m") args.model = take(token);
    else if (token === "--base-url") args.baseURL = take(token);
    else if (token === "--protocol" || token === "--api-protocol") args.protocol = take(token);
    else if (token === "--permission-mode") args.permissionMode = take(token);
    else if (token === "--dangerously-skip-permissions" || token === "--yes") args.dangerouslySkip = true;
    else if (token === "--allow-dangerously-skip-permissions") args.allowBypass = true;
    else if (token === "--allowedTools" || token === "--allowed-tools") args.allowedTools.push(take(token));
    else if (token === "--add-dir") args.addDir.push(take(token));
    else if (token === "--profile") args.profile = take(token);
    else if (token === "--config") args.configPath = take(token);
    else if (token === "--append-system-prompt") args.appendSystem = take(token);
    else if (token === "--output-format") {
      const value = take(token);
      if (value !== "text" && value !== "json") throw new Error("--output-format must be text or json");
      args.output = value;
    } else if (token === "run") args.print = true;
    else if (token === "doctor") args.doctor = true;
    else if (token === "resume") {
      const peek = argv[i + 1];
      if (peek && !peek.startsWith("-")) args.resume = argv[++i];
      else args.openResume = true;
    } else if (token.startsWith("-")) throw new Error(`Unknown option ${token}`);
    else rest.push(token);
  }
  if (rest.length) args.prompt = rest.join(" ");
  if (args.dangerouslySkip) {
    args.permissionMode = "bypassPermissions";
    args.allowBypass = true;
  }
  return args;
}

export function cliHelp(): string {
  return `Glue Cli — terminal coding agent

Usage
  glue                         interactive session
  glue "fix the failing test"  interactive, send the first prompt
  glue -p "summarize src"      print mode, then exit
  glue run "summarize src"     same as -p
  glue -c                      continue the newest session
  glue --resume <id>           resume a session from the shell
  glue doctor                  check config, key, and workspace

In the interactive session, /resume opens a picker and /resume <id> resumes that session.

Options
  -p, --print                  non-interactive print mode
  -c, --continue               resume the latest session
  --resume <id>                resume a session id or name
  --cwd <dir>                  workspace root (default: current directory)
  --model <name>               model id
  --base-url <url>             OpenAI or Anthropic base URL
  --protocol <name>            openai or anthropic (default: infer from the URL)
  --permission-mode <mode>     default | acceptEdits | plan | dontAsk | bypassPermissions
  --dangerously-skip-permissions
                               start in bypass mode
  --allow-dangerously-skip-permissions
                               add bypass to the shift+tab cycle
  --allowedTools <rule>        session allow rule, repeatable. Example: Bash(npm test *)
  --add-dir <dir>              extra workspace root, repeatable
  --profile <name>             prompt profile (profiles/<name>/PROMPT.md)
  --config <file>              toml or json config
  --append-system-prompt <t>   extra system prompt text
  --output-format text|json    print mode event format
  -h, --help
  -v, -V, --version

Environment
  GLUE_API_KEY, AGENT_API_KEY, OPENAI_API_KEY
  GLUE_BASE_URL, AGENT_BASE_URL, OPENAI_BASE_URL
  GLUE_PROTOCOL, AGENT_PROTOCOL    openai or anthropic
  GLUE_MODEL, AGENT_MODEL, OPENAI_MODEL
  GLUE_PERMISSION_MODE, GLUE_PROFILE, GLUE_SHELL

Config files, first match wins
  .agent/config.toml
  .agent/config.json
  agent.config.json
  ~/.glue/config.toml          user defaults, under the project file.
                               %USERPROFILE%\\.glue\\config.toml on Windows.
                               Created on the first session if missing.
                               Optional api_key is local to this machine; do not commit it.

Shell is off until shell.enabled = true. File tools stay inside the workspace.
`;
}
