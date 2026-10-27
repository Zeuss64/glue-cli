import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import {
  buildStatusLinePayload,
  clearStatusLineConfig,
  expandStatusCommand,
  formatStatusLineOutput,
  generateStatusLineScript,
  glueSettingsPath,
  glueStatuslineScriptPath,
  installStatusLine,
  parseStatuslineRequest,
  readGlueSettings,
  readStatusLineConfig,
  runStatusLineCommand,
} from "../src/statusline.js";
import { attachImeCursorSync, IME_PARK_RESTORE, imeCursorSequence, imeParkSequence, isImeCursorChunk, placeCursorSequence } from "../src/tui/screen.js";
import { imeAnchor, statusAreaRows } from "../src/tui/ime.js";
import { layoutColumns } from "../src/tui/viewport.js";

function fakeHome(): string {
  return mkdtempSync(path.join(tmpdir(), "glue-home-"));
}

function fakeProject(): string {
  return mkdtempSync(path.join(tmpdir(), "glue-proj-"));
}

test("/statusline writes ~/.glue/settings.json and a script, never the project dir", () => {
  const home = fakeHome();
  const project = fakeProject();
  mkdirSync(path.join(project, ".agent"), { recursive: true });
  mkdirSync(path.join(project, ".glue"), { recursive: true });
  const installed = installStatusLine(home, { fields: ["model", "context"], progressBar: true });
  assert.equal(installed.settingsPath, glueSettingsPath(home));
  assert.equal(installed.scriptPath, glueStatuslineScriptPath(home));
  assert.equal(existsSync(installed.settingsPath), true);
  assert.equal(existsSync(installed.scriptPath), true);
  const settings = JSON.parse(readFileSync(installed.settingsPath, "utf8")) as {
    statusLine: { type: string; command: string; padding: number; refreshInterval: null };
  };
  assert.equal(settings.statusLine.type, "command");
  assert.equal(settings.statusLine.command, "~/.glue/statusline.sh");
  assert.equal(settings.statusLine.padding, 0);
  assert.equal(settings.statusLine.refreshInterval, null);
  assert.match(readFileSync(installed.scriptPath, "utf8"), /display_name/);
  assert.equal(existsSync(path.join(project, ".glue", "settings.json")), false);
  assert.equal(existsSync(path.join(project, ".glue", "statusline.sh")), false);
  assert.equal(existsSync(path.join(project, ".agent", "ui.json")), false);
  assert.equal(existsSync(path.join(project, ".agent", "settings.json")), false);
  assert.equal(readStatusLineConfig(home)?.command, "~/.glue/statusline.sh");
});

test("generated statusline script reads stdin JSON and prints model + context bar", async () => {
  const home = fakeHome();
  const installed = installStatusLine(home, { fields: ["model", "context"], progressBar: true });
  const payload = buildStatusLinePayload({
    cwd: "/tmp/app",
    sessionId: "sess-1",
    sessionName: "demo",
    model: "gpt-4o-mini",
    effort: "high",
    usage: { input: 20000, output: 100, cacheRead: 5000 },
    contextWindow: 100000,
    version: "0.1.103",
  });
  assert.equal(payload.model.display_name, "gpt-4o-mini");
  assert.equal(payload.effort?.level, "high");
  assert.equal(payload.context_window.used_percentage, 20);
  assert.equal(payload.context_window.current_usage?.cache_read_input_tokens, 5000);
  assert.equal(payload.version, "0.1.103");
  const out = await runStatusLineCommand(installed.config.command, payload, { home, cwd: home });
  assert.match(out, /gpt-4o-mini/);
  assert.match(out, /20%/);
  assert.match(out, /[▓░]{10}/);
});

test("/statusline clear removes statusLine from ~/.glue/settings.json", () => {
  const home = fakeHome();
  installStatusLine(home);
  assert.ok(readGlueSettings(home).statusLine);
  clearStatusLineConfig(home);
  assert.equal(readGlueSettings(home).statusLine, undefined);
  assert.equal(readStatusLineConfig(home), null);
  assert.equal(existsSync(glueSettingsPath(home)), true);
});

test("statusline requests: empty default, natural language, clear/delete/remove", () => {
  assert.deepEqual(parseStatuslineRequest(""), { kind: "default", progressBar: true });
  assert.equal(parseStatuslineRequest("show").kind, "show");
  assert.equal(parseStatuslineRequest("clear").kind, "clear");
  assert.equal(parseStatuslineRequest("delete").kind, "clear");
  assert.equal(parseStatuslineRequest("remove").kind, "clear");
  assert.equal(parseStatuslineRequest("remove it").kind, "clear");
  assert.equal(parseStatuslineRequest("删除状态栏").kind, "clear");
  const designed = parseStatuslineRequest("设计");
  assert.equal(designed.kind, "designed");
  const asked = parseStatuslineRequest("show model name and context percentage with a progress bar");
  assert.equal(asked.kind, "set");
  if (asked.kind === "set") {
    assert.ok(asked.fields.includes("model"));
    assert.ok(asked.fields.includes("context"));
    assert.equal(asked.progressBar, true);
  }
});

test("inline command and path expansion never touch the project directory", async () => {
  const home = fakeHome();
  const project = fakeProject();
  const expanded = expandStatusCommand("node ~/.glue/statusline.sh", home);
  assert.equal(expanded.includes("~"), false);
  assert.ok(expanded.startsWith("node "));
  assert.ok(expanded.includes(path.join(home, ".glue")));
  const out = await runStatusLineCommand(
    `node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const d=JSON.parse(s);process.stdout.write(d.model.display_name)})"`,
    { model: { id: "x", display_name: "Flash" }, context_window: { used_percentage: 3 } },
    { home, cwd: project },
  );
  assert.equal(out, "Flash");
  assert.equal(existsSync(path.join(project, ".glue", "settings.json")), false);
  assert.equal(existsSync(path.join(project, ".agent", "ui.json")), false);
});

test("status line output is clipped to the terminal width", () => {
  const lines = formatStatusLineOutput("abcdefghij\n\nsecond", 6, 1);
  assert.equal(lines[0]?.startsWith(" "), true);
  assert.ok((lines[0]?.length ?? 0) <= 6);
  assert.ok(lines.length <= 4);
});

test("generated script source parses stdin and does not hard-code a project path", () => {
  const source = generateStatusLineScript(["model", "effort", "tokens", "context", "cache"], { progressBar: true });
  assert.match(source, /^#!\/usr\/bin\/env node/m);
  assert.match(source, /process\.stdin/);
  assert.doesNotMatch(source, /\.agent/);
  assert.doesNotMatch(source, /process\.cwd\(\)/);
});

test("loadConfig reads statusLine from ~/.glue/settings.json and ignores project ui.json leftovers", () => {
  const home = fakeHome();
  const project = fakeProject();
  mkdirSync(path.join(project, ".agent"), { recursive: true });
  writeFileSync(path.join(project, ".agent", "ui.json"), `${JSON.stringify({ statusline: "model,tokens" }, null, 2)}\n`);
  installStatusLine(home, { fields: ["model"] });
  const loaded = loadConfig({ cwd: project, env: {}, home });
  assert.equal(loaded.statusLine?.command, "~/.glue/statusline.sh");
  assert.equal(existsSync(path.join(project, ".glue", "statusline.sh")), false);
});

test("IME cursor is parked after every paint and restored before the next one", async () => {
  const writes: string[] = [];
  const stdout = {
    write(chunk: string) {
      writes.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    },
  };
  const detach = attachImeCursorSync(stdout, () => ({ row: 12, column: 5 }));
  await Promise.resolve();
  const parked = writes.join("");
  assert.equal(parked, imeParkSequence(12, 5));
  assert.match(parked, /\x1b\[12;5H/);
  assert.match(parked, /\x1b\[\?25l/);
  assert.doesNotMatch(parked, /\x1b\[\?25h/);
  writes.length = 0;
  stdout.write("ink-frame\n");
  await Promise.resolve();
  const repaint = writes.join("");
  assert.ok(repaint.startsWith(IME_PARK_RESTORE + "ink-frame\n"), repaint);
  assert.match(repaint, /\x1b7\x1b\[12;5H\x1b\[\?25l/);
  assert.doesNotMatch(repaint, /\x1b\[\?25h/);
  assert.equal(isImeCursorChunk(imeCursorSequence(12, 5)), true);
  assert.equal(isImeCursorChunk(imeParkSequence(12, 5)), true);
  assert.equal(isImeCursorChunk("ink-frame\n"), false);
  assert.equal(isImeCursorChunk(IME_PARK_RESTORE), false);
  detach();
  assert.ok(writes.at(-1)?.startsWith("\x1b8"), "detach restores the cursor for the next erase");
});

test("a null IME anchor hides the hardware cursor instead of leaving it at the bottom", async () => {
  const writes: string[] = [];
  const stdout = {
    write(chunk: string) {
      writes.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    },
  };
  const detach = attachImeCursorSync(stdout, () => null);
  await Promise.resolve();
  assert.equal(writes.join(""), "\x1b[?25l");
  assert.doesNotMatch(writes.join(""), /\x1b\[\?25h/);
  detach();
});

test("IME anchor sits on the caret and moves up only for visible status rows", () => {
  const empty = imeAnchor({ frameRows: 29, frameCols: 100, text: "", cursor: 0 });
  assert.deepEqual(empty, { row: 26, column: 5 });
  const custom = imeAnchor({ frameRows: 29, frameCols: 100, text: "", cursor: 0, statusRows: statusAreaRows(["model 20%", " "]) });
  assert.equal(statusAreaRows(["model 20%", " ", "\t"]), 2);
  assert.equal(statusAreaRows(["", "   "]), 2);
  assert.equal(custom.row, 26);
  assert.equal(custom.column, 5);
  assert.equal(placeCursorSequence(27, 5), "\x1b[27;5H");
  assert.equal(layoutColumns(100), 99);
  assert.equal(layoutColumns(undefined), 79);
});

test("blank or color-only statusline stdout does not reserve a row", () => {
  const blanks = ["", " ", "\n\n", "\t", "   \n  ", "\x1b[38;5;173m\x1b[0m", "\x1b[48;5;173m \x1b[0m", "\x1b[38;2;217;119;87m\x1b[0m"];
  for (const raw of blanks) assert.deepEqual(formatStatusLineOutput(raw, 80), [], JSON.stringify(raw));
  const shown = formatStatusLineOutput("\x1b[38;5;173mmodel 8%\x1b[0m\n\n", 80);
  assert.deepEqual(shown, ["model 8%"]);
  assert.equal(statusAreaRows(shown), 2);
  assert.equal(statusAreaRows(formatStatusLineOutput("", 80)), 2);
});
