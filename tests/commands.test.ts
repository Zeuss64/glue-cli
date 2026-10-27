import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { filterCommands, helpText, isImmediateCommand, runSlashCommand, type CommandHost } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { emptyRules } from "../src/permissions.js";

function host(): CommandHost & { lines: string[]; resumed: Array<string | undefined> } {
  const lines: string[] = [];
  const resumed: Array<string | undefined> = [];
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-cmd-"));
  const config = loadConfig({ cwd, env: {} });
  const value: CommandHost & { lines: string[]; resumed: Array<string | undefined> } = {
    workspace: cwd,
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
  assert.equal(session.effort, "max");
  assert.equal(opened, 1);
  assert.match(session.lines.at(-1) ?? "", /Effort set to max/);
});

test("/resume with no id opens the picker path, and /resume <id> passes the id", async () => {
  const session = host();
  assert.match(helpText(), /\/resume\s+Open the session picker, or resume an id/);
  await runSlashCommand("/resume", session);
  await runSlashCommand("/resume   sess-123", session);
  await runSlashCommand("/continue older", session);
  assert.deepEqual(session.resumed, [undefined, "sess-123", "older"]);
});
