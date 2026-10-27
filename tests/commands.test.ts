import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { filterCommands, helpText, isImmediateCommand, presentCommandOutput, resolveSubmittedSlash, runSlashCommand, unavailableLine, type CommandHost } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { emptyRules } from "../src/permissions.js";
import { glueSettingsPath, glueStatuslineScriptPath, readStatusLineConfig } from "../src/statusline.js";

function host(): CommandHost & { lines: string[]; resumed: Array<string | undefined> } {
  const lines: string[] = [];
  const resumed: Array<string | undefined> = [];
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-cmd-"));
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const config = loadConfig({ cwd, env: {}, home });
  const value: CommandHost & { lines: string[]; resumed: Array<string | undefined> } = {
    workspace: cwd,
    home,
    config,
    model: config.model,
    permissionMode: "default",
    profile: "default",
    themeName: "dark",
    editor: "normal",
    outputStyle: "normal",
    shellEnabled: false,
    usage: { input: 3, output: 4 },
    contextWindow: 128000,
    sessionName: "",
    sessionId: "test",
    rules: emptyRules(),
    tasks: [],
    lines,
    resumed,
    push(text) {
      lines.push(text);
    },
    setModel(model) {
      value.model = model;
    },
    setMode(mode) {
      value.permissionMode = mode;
    },
    setProfile(profile) {
      value.profile = profile;
    },
    setTheme(theme) {
      value.themeName = theme;
    },
    setAccent() {},
    setEditor(editor) {
      value.editor = editor;
    },
    setOutputStyle(style) {
      value.outputStyle = style;
    },
    setShell(enabled) {
      value.shellEnabled = enabled;
    },
    setSessionName(name) {
      value.sessionName = name;
    },
    addRule(kind, rule) {
      value.rules[kind].push(rule);
    },
    clear() {},
    exit() {
      lines.push("exit");
    },
    async runTurn() {},
    async compact() {},
    async btw() {},
    async recap() {},
    async resume(id) {
      resumed.push(id);
    },
    rewind() {},
    branch() {},
    addDir() {},
    cd() {},
    killTask() {},
    copyLast() {},
    exportSession() {},
    showMemory() {},
    showDiff() {},
  };
  return value;
}

test("slash menu filters and immediate commands stay available mid-turn", () => {
  assert.equal(isImmediateCommand("/status"), true);
  assert.equal(isImmediateCommand("/init"), false);
  const names = filterCommands("per").map((command) => command.name);
  assert.ok(names.includes("permissions"));
  assert.match(helpText(), /Glue Cli commands/);
});

test("/model, /permissions, and /vim update the session host", async () => {
  const session = host();
  await runSlashCommand("/model", session);
  assert.match(session.lines.at(-1) ?? "", /^Model: /);
  await runSlashCommand("/model deepseek-chat", session);
  assert.equal(session.model, "deepseek-chat");
  assert.equal(isImmediateCommand("/effort"), true);
  await runSlashCommand("/permissions allow Bash(npm test *)", session);
  assert.ok(session.rules.allow.includes("Bash(npm test *)"));
  await runSlashCommand("/permissions mode plan", session);
  assert.equal(session.permissionMode, "plan");
  await runSlashCommand("/vim", session);
  assert.equal(session.editor, "vim");
  assert.match(session.lines.join("\n"), /Vim mode on/);
  await runSlashCommand("/login", session);
  assert.match(session.lines.at(-1) ?? "", /GLUE_API_KEY/);
});

test("/model with no id opens the picker, and /effort reads and sets a level", async () => {
  const session = host();
  let opened = 0;
  session.openModelPicker = () => {
    opened += 1;
  };
  session.setEffort = (level) => {
    session.effort = level;
  };
  await runSlashCommand("/model", session);
  await runSlashCommand("/model  custom-id", session);
  assert.equal(opened, 1);
  assert.equal(session.model, "custom-id");
  assert.match(session.lines.at(-1) ?? "", /Model set to custom-id/);
  await runSlashCommand("/effort", session);
  assert.match(session.lines.at(-1) ?? "", /Effort: auto/);
  await runSlashCommand("/effort status", session);
  assert.match(session.lines.at(-1) ?? "", /Effort: auto/);
  await runSlashCommand("/effort HIGH", session);
  assert.equal(session.effort, "high");
  assert.match(session.lines.at(-1) ?? "", /Effort set to high/);
  await runSlashCommand("/effort auto", session);
  assert.equal(session.effort, "auto");
  assert.match(session.lines.at(-1) ?? "", /model default/);
  await runSlashCommand("/effort nope", session);
  assert.match(session.lines.at(-1) ?? "", /Usage: \/effort/);
  await runSlashCommand("/status", session);
  assert.match(session.lines.at(-1) ?? "", /Effort:\s+auto/);
});

test("bare /effort opens the picker when the host provides one", async () => {
  const session = host();
  let opened = 0;
  session.openEffortPicker = () => {
    opened += 1;
  };
  session.setEffort = (level) => {
    session.effort = level;
  };
  await runSlashCommand("/effort", session);
  assert.equal(opened, 1);
  assert.equal(session.lines.length, 0);
  await runSlashCommand("/effort status", session);
  assert.match(session.lines.at(-1) ?? "", /Effort: auto/);
  await runSlashCommand("/effort max", session);
  assert.equal(opened, 1);
  assert.equal(session.effort, "max");
  assert.match(session.lines.at(-1) ?? "", /Effort set to max/);
});

test("/effort ultracode toggles subagents and leaves the level alone", async () => {
  const session = host();
  session.effort = "high";
  session.setEffort = (level) => {
    session.effort = level;
  };
  session.setUltracode = (on) => {
    session.ultracode = on;
  };
  await runSlashCommand("/effort ultracode", session);
  assert.equal(session.ultracode, true);
  assert.equal(session.effort, "high");
  assert.match(session.lines.at(-1) ?? "", /Ultracode: dynamic workflows on every task/);
  assert.match(session.lines.at(-1) ?? "", /Effort stays high/);
  await runSlashCommand("/effort ultracode off", session);
  assert.equal(session.ultracode, false);
  assert.equal(session.effort, "high");
  assert.match(session.lines.at(-1) ?? "", /Effort stays high/);
  await runSlashCommand("/effort status", session);
  assert.match(session.lines.at(-1) ?? "", /Effort: high/);
  await runSlashCommand("/effort ultracode on", session);
  await runSlashCommand("/effort status", session);
  assert.match(session.lines.at(-1) ?? "", /high · ultracode/);
  await runSlashCommand("/effort xhigh", session);
  assert.equal(session.ultracode, true);
  assert.equal(session.effort, "xhigh");
});

test("/resume with no id opens the picker path, and /resume <id> passes the id", async () => {
  const session = host();
  assert.match(helpText(), /\/resume\s+Open the session picker, or resume an id/);
  await runSlashCommand("/resume", session);
  await runSlashCommand("/resume   sess-123", session);
  await runSlashCommand("/continue older", session);
  assert.deepEqual(session.resumed, [undefined, "sess-123", "older"]);
});

test("unavailable samples are one line and do not append another help dump", async () => {
  const session = host();
  const samples = ["/login", "/mcp", "/ide", "/hooks", "/voice", "/desktop", "/logout", "/upgrade", "/chrome"];
  for (const sample of samples) {
    const before = session.lines.length;
    await runSlashCommand(sample, session);
    const line = session.lines.at(-1) ?? "";
    assert.equal(session.lines.length, before + 1);
    assert.equal(line.includes("\n"), false);
    assert.equal(presentCommandOutput(line).helpPanel, false);
    assert.doesNotMatch(line, /Glue Cli commands/);
    assert.match(line, /不可用/);
  }
  assert.match(session.lines[0] ?? "", /GLUE_API_KEY/);
  const dumped = presentCommandOutput(helpText());
  assert.equal(dumped.helpPanel, true);
  assert.equal(dumped.line, null);
  assert.equal(presentCommandOutput(helpText()).line, null);
  assert.equal(resolveSubmittedSlash("/login", 5), "/login");
  assert.equal(resolveSubmittedSlash("/help", 3), "/help");
  assert.equal(resolveSubmittedSlash("/he", 0), "/help");
  assert.notEqual(resolveSubmittedSlash("/login /mcp /ide", 0), helpText());
  const named = unavailableLine({ name: "voice", summary: "Voice input", available: false, note: "Voice input is not in this build." });
  assert.equal(named.includes("\n"), false);
});

test("/goal, /auto, and /statusline update the host and stay in help", async () => {
  const session = host();
  const home = session.home ?? "";
  session.setGoal = (goal) => {
    session.goal = goal;
  };
  session.setApproval = (mode) => {
    session.approval = mode;
  };
  assert.match(helpText(), /\/goal\s+Show or set a persistent goal/);
  assert.match(helpText(), /\/auto\s+/);
  assert.match(helpText(), /\/statusline\s+/);
  assert.match(helpText(), /global ~\/\.glue/);
  assert.equal(isImmediateCommand("/goal"), true);
  assert.equal(isImmediateCommand("/auto"), true);
  assert.equal(isImmediateCommand("/statusline"), true);
  await runSlashCommand("/goal 把登录改成一次性验证码", session);
  assert.equal(session.goal, "把登录改成一次性验证码");
  assert.match(session.lines.at(-1) ?? "", /目标已设为/);
  await runSlashCommand("/goal", session);
  assert.match(session.lines.at(-1) ?? "", /一次性验证码/);
  await runSlashCommand("/goal clear", session);
  assert.equal(session.goal, "");
  await runSlashCommand("/auto on", session);
  assert.equal(session.approval, "auto");
  assert.match(session.lines.at(-1) ?? "", /自动确认/);
  await runSlashCommand("/auto off", session);
  assert.equal(session.approval, "manual");
  await runSlashCommand("/statusline 模型和用量", session);
  const afterModel = readStatusLineConfig(home);
  assert.ok(afterModel?.command);
  assert.match(readFileSync(glueStatuslineScriptPath(home), "utf8"), /display_name/);
  assert.equal(existsSync(path.join(session.workspace, ".agent", "ui.json")), false);
  assert.equal(existsSync(path.join(session.workspace, ".glue", "settings.json")), false);
  await runSlashCommand("/statusline", session);
  assert.match(readFileSync(glueSettingsPath(home), "utf8"), /statusLine/);
  await runSlashCommand("/statusline show", session);
  assert.match(session.lines.at(-1) ?? "", /statusline\.sh/);
  await runSlashCommand("/statusline 加当前使用模型，当前effort，token使用量，上下文窗口占用百分比，上下文窗口有多少，缓存命中率", session);
  const rich = readFileSync(glueStatuslineScriptPath(home), "utf8");
  assert.match(rich, /effort/);
  assert.match(rich, /formatTok/);
  assert.match(rich, /hit_ratio|cache/);
  await runSlashCommand("/config statusline=status", session);
  assert.match(session.lines.at(-1) ?? "", /Status line command/);
  await runSlashCommand("/statusline clear", session);
  assert.equal(readStatusLineConfig(home), null);
  assert.match(session.lines.at(-1) ?? "", /Removed the custom status line/);
  const names = filterCommands("go").map((command) => command.name);
  assert.deepEqual(names, ["goal"]);
  const login = filterCommands("log").map((command) => command.name);
  assert.ok(login.includes("login"));
  assert.ok(login.includes("logout"));
});
