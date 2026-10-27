import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { readUiSettings, writeUiSettings } from "../src/settings.js";
import { parseStatuslineRequest, parseStatuslineSpec } from "../src/statusline.js";
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
  assert.equal(parseStatuslineRequest("reset").kind, "reset");
  assert.equal(parseStatuslineRequest("nope").kind, "invalid");
  assert.deepEqual(parseStatuslineSpec(""), ["hint", "effort", "tokens"]);
  assert.ok(parseStatuslineSpec("设计").includes("goal"));
});

test("ui.json goal, approval, and statusline override project config and survive a rewrite", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-ui-"));
  const fileGoal = loadConfig({
    cwd,
    env: {},
    home: mkdtempSync(path.join(tmpdir(), "glue-home-")),
  });
  assert.equal(fileGoal.goal, "");
  assert.equal(fileGoal.approval, "manual");
  writeUiSettings(cwd, { goal: "修窗口", approval: "auto", statusline: "model,tokens" });
  const loaded = loadConfig({ cwd, env: {}, home: mkdtempSync(path.join(tmpdir(), "glue-home-")) });
  assert.equal(loaded.goal, "修窗口");
  assert.equal(loaded.approval, "auto");
  assert.equal(loaded.statusline, "model,tokens");
  const fromEnv = loadConfig({ cwd, env: { GLUE_APPROVAL: "manual", GLUE_GOAL: "env goal" } });
  assert.equal(fromEnv.approval, "manual");
  assert.equal(fromEnv.goal, "env goal");
  const round = readUiSettings(cwd);
  assert.equal(round.goal, "修窗口");
  assert.equal(round.approval, "auto");
});
