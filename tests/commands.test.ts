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
  const listed = session.lines.at(-1) ?? "";
  assert.match(listed, /Model: gpt-4o-mini/);
  assert.match(listed, /\/model <name>/);
  assert.match(listed, /Up and down move/);
  let opened = false;
  session.openModelPicker = () => {
    opened = true;
    return true;
  };
  const before = session.lines.length;
  await runSlashCommand("/model", session);
  assert.equal(opened, true);
  assert.equal(session.lines.length, before);
  await runSlashCommand("/model deepseek-chat", session);
  assert.equal(session.model, "deepseek-chat");
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

test("/resume with no id opens the picker path, and /resume <id> passes the id", async () => {
  const session = host();
  assert.match(helpText(), /\/resume\s+Open the session picker, or resume an id/);
  await runSlashCommand("/resume", session);
  await runSlashCommand("/resume   sess-123", session);
  await runSlashCommand("/continue older", session);
  assert.deepEqual(session.resumed, [undefined, "sess-123", "older"]);
});
