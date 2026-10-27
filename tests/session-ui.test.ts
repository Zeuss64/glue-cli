import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { readUiSettings, writeUiSettings } from "../src/settings.js";
import { cacheHitPercent, formatStatusLeft, parseStatuslineRequest, parseStatuslineSpec } from "../src/statusline.js";
import { cycleSlash } from "../src/tui/complete.js";
import { imeAnchor } from "../src/tui/ime.js";
import { RESIZE_REFLOW_SEQUENCE, RESTORE_TERMINAL_SEQUENCE, placeCursorSequence } from "../src/tui/screen.js";

test("resize reflow and exit restore erase the visible frame without wiping scrollback", () => {
  assert.match(RESIZE_REFLOW_SEQUENCE, /\x1b\[2J/);
  assert.match(RESIZE_REFLOW_SEQUENCE, /\x1b\[H/);
  assert.doesNotMatch(RESIZE_REFLOW_SEQUENCE, /\x1b\[3J/);
  assert.doesNotMatch(RESIZE_REFLOW_SEQUENCE, /\x1b\[\?1049h/);
  assert.match(RESTORE_TERMINAL_SEQUENCE, /\x1b\[\?1049l/);
  assert.match(RESTORE_TERMINAL_SEQUENCE, /\x1b\[2J/);
  assert.match(RESTORE_TERMINAL_SEQUENCE, /\x1b\[\?25h/);
  assert.doesNotMatch(RESTORE_TERMINAL_SEQUENCE, /\x1b\[3J/);
  assert.equal(placeCursorSequence(27, 5), "\x1b[27;5H");
});

test("the IME anchor sits on the caret inside the input border", () => {
  const empty = imeAnchor({ frameRows: 29, frameCols: 100, text: "", cursor: 0 });
  assert.deepEqual(empty, { row: 27, column: 5 });
  const typed = imeAnchor({ frameRows: 29, frameCols: 100, text: "ab", cursor: 2 });
  assert.equal(typed.row, 27);
  assert.equal(typed.column, 7);
  const han = imeAnchor({ frameRows: 29, frameCols: 80, text: "你", cursor: 1 });
  assert.equal(han.column, 7);
});

test("tab cycles ambiguous slash prefixes and accepts a unique one", () => {
  const first = cycleSlash("c", 0);
  assert.ok(first);
  assert.equal(first?.ambiguous, true);
  assert.equal(first?.text.startsWith("/"), true);
  assert.equal(first?.text.endsWith(" "), false);
  const second = cycleSlash("c", (first?.index ?? 0) + 1);
  assert.notEqual(second?.text, first?.text);
  const help = cycleSlash("he", 0);
  assert.equal(help?.ambiguous, false);
  assert.equal(help?.text, "/help ");
  const goal = cycleSlash("goal", 0);
  assert.equal(goal?.text, "/goal ");
  const bare = cycleSlash("", 0);
  assert.ok(bare && bare.names.includes("goal"));
  assert.ok(bare && bare.names.includes("auto"));
  assert.ok(bare && bare.names.includes("statusline"));
});

test("statusline requests understand Chinese and English field names", () => {
  const asked = parseStatuslineRequest("显示模型和用量");
  assert.equal(asked.kind, "set");
  if (asked.kind === "set") assert.deepEqual(asked.fields, ["model", "tokens"]);
  assert.equal(parseStatuslineRequest("设计").kind, "designed");
  assert.equal(parseStatuslineRequest("reset").kind, "default");
  assert.equal(parseStatuslineRequest("nope").kind, "default");
  assert.equal(parseStatuslineRequest("clear").kind, "clear");
  assert.deepEqual(parseStatuslineSpec(""), ["hint", "effort", "tokens"]);
  assert.ok(parseStatuslineSpec("设计").includes("goal"));
  const designed = parseStatuslineRequest("加当前使用模型，当前effort，token使用量，上下文窗口占用百分比，上下文窗口有多少，缓存命中率");
  assert.equal(designed.kind, "set");
  if (designed.kind === "set") {
    assert.deepEqual(designed.fields, ["model", "effort", "tokens", "context", "contextSize", "cache"]);
    assert.equal(designed.progressBar, true);
  }
  assert.deepEqual(parseStatuslineRequest("context window size"), { kind: "set", fields: ["contextSize"], progressBar: false });
  assert.deepEqual(parseStatuslineSpec("model,effort,tokens,context,contextSize,cache"), ["model", "effort", "tokens", "context", "contextSize", "cache"]);
  const shown = formatStatusLeft(["model", "effort", "tokens", "context", "contextSize", "cache"], {
    model: "sensenova-6.8-flash-lite",
    effort: "max",
    usage: { input: 1000, output: 0, cacheRead: 250 },
    contextWindow: 128000,
  });
  assert.match(shown, /sensenova-6\.8-flash-lite/);
  assert.match(shown, /effort max/);
  assert.match(shown, /1\.0k tok/);
  assert.match(shown, /ctx 1%/);
  assert.match(shown, /window 128\.0k/);
  assert.match(shown, /cache 25%/);
  const hidden = formatStatusLeft(["tokens", "cache", "context", "contextSize"], {
    usage: { input: 0, output: 0 },
    contextWindow: 128000,
  });
  assert.doesNotMatch(hidden, /tok/);
  assert.doesNotMatch(hidden, /cache/);
  assert.match(hidden, /ctx 0%/);
  assert.match(hidden, /window 128\.0k/);
  assert.equal(cacheHitPercent({ input: 100, output: 0, cacheRead: 300 }), 75);
  assert.equal(cacheHitPercent({ input: 10, output: 1 }), undefined);
});

test("ui.json goal and approval override project config; statusline stays in ~/.glue", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-ui-"));
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const fileGoal = loadConfig({
    cwd,
    env: {},
    home,
  });
  assert.equal(fileGoal.goal, "");
  assert.equal(fileGoal.approval, "manual");
  assert.equal(fileGoal.statusLine, null);
  writeUiSettings(cwd, { goal: "修窗口", approval: "auto" });
  const loaded = loadConfig({ cwd, env: {}, home });
  assert.equal(loaded.goal, "修窗口");
  assert.equal(loaded.approval, "auto");
  assert.equal(loaded.statusLine, null);
  const fromEnv = loadConfig({ cwd, env: { GLUE_APPROVAL: "manual", GLUE_GOAL: "env goal" }, home });
  assert.equal(fromEnv.approval, "manual");
  assert.equal(fromEnv.goal, "env goal");
  const round = readUiSettings(cwd);
  assert.equal(round.goal, "修窗口");
  assert.equal(round.approval, "auto");
  assert.equal("statusline" in JSON.parse(readFileSync(path.join(cwd, ".agent", "ui.json"), "utf8")), false);
});
