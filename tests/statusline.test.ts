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
import { attachImeCursorSync, imeCursorSequence, isImeCursorChunk, placeCursorSequence } from "../src/tui/screen.js";
import { imeAnchor } from "../src/tui/ime.js";

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

test("IME cursor is rewritten after every stdout paint, not only editor changes", async () => {
  const writes: string[] = [];
  const stdout = {
    write(chunk: string) {
      writes.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    },
  };
  const detach = attachImeCursorSync(stdout, () => ({ row: 12, column: 5 }));
  await Promise.resolve();
  assert.match(writes.join(""), /\x1b\[12;5H/);
  assert.match(writes.join(""), /\x1b\[\?25h/);
  writes.length = 0;
  stdout.write("ink-frame\n");
  await Promise.resolve();
  assert.match(writes.join(""), /ink-frame/);
  assert.match(writes.join(""), /\x1b\[12;5H\x1b\[\?25h/);
  assert.equal(isImeCursorChunk(imeCursorSequence(12, 5)), true);
  assert.equal(isImeCursorChunk("ink-frame\n"), false);
  detach();
});

test("IME anchor sits on the caret and moves up when the status area is taller", () => {
  const empty = imeAnchor({ frameRows: 29, frameCols: 100, text: "", cursor: 0 });
  assert.deepEqual(empty, { row: 27, column: 5 });
  const custom = imeAnchor({ frameRows: 29, frameCols: 100, text: "", cursor: 0, statusRows: 3 });
  assert.equal(custom.row, 25);
  assert.equal(custom.column, 5);
  assert.equal(placeCursorSequence(27, 5), "\x1b[27;5H");
});
