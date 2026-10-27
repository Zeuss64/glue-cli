import assert from "node:assert/strict";
import { createElement } from "react";
import { Box } from "ink";
import { render } from "ink-testing-library";
import test from "node:test";
import { stripAnsi } from "../src/statusline.js";
import { slashRowLines, slashRowTone } from "../src/tui/complete.js";
import { CommandHelp, CustomStatusLine, EffortPicker, ModelPicker, PermissionDialog, PromptBox, ResumePicker, ScrollMeter, SlashMenu, StatusBar, ToolBlock, TranscriptView, transcriptTone } from "../src/tui/components.js";
import { displayWidth } from "../src/tui/text.js";
import { THEMES } from "../src/tui/theme.js";
import { layoutColumns } from "../src/tui/viewport.js";

const theme = THEMES.ansi;

test("status bar and permission dialog use the Glue labels", () => {
  const status = render(
    createElement(StatusBar, { theme, mode: "acceptEdits", usage: { input: 10, output: 2 } }),
  );
  assert.match(status.lastFrame() ?? "", /accept edits on/);
  assert.match(status.lastFrame() ?? "", /12 tok/);
  status.unmount();

  const effortStatus = render(
    createElement(StatusBar, { theme, mode: "default", usage: { input: 0, output: 0 }, effort: "high" }),
  );
  assert.match(effortStatus.lastFrame() ?? "", /effort high/);
  effortStatus.unmount();

  const compact = render(
    createElement(StatusBar, { theme, mode: "default", usage: { input: 10, output: 2 }, compact: true }),
  );
  assert.doesNotMatch(compact.lastFrame() ?? "", /12 tok/);
  assert.match(compact.lastFrame() ?? "", /manual mode on/);
  compact.unmount();

  const custom = render(createElement(CustomStatusLine, { theme, lines: ["gpt-4o-mini ▓░░░░░░░░░ 8%"] }));
  assert.match(custom.lastFrame() ?? "", /gpt-4o-mini/);
  assert.match(custom.lastFrame() ?? "", /8%/);
  custom.unmount();

  const blank = render(createElement(CustomStatusLine, { theme, lines: ["", "   ", "\t"] }));
  assert.equal(stripAnsi(blank.lastFrame() ?? "").trim(), "");
  blank.unmount();

  const columns = 40;
  const width = layoutColumns(columns);
  const prompt = render(
    createElement(Box, { width, flexDirection: "column" }, createElement(PromptBox, { theme, text: "hi", cursor: 2 })),
  );
  const borderLines = stripAnsi(prompt.lastFrame() ?? "")
    .split("\n")
    .filter((line) => displayWidth(line) > 0);
  assert.ok(borderLines.some((line) => line.includes("╰")));
  for (const line of borderLines) {
    assert.ok(displayWidth(line) <= width);
    assert.ok(displayWidth(line) < columns);
  }
  prompt.unmount();

  const placeholder = "Ask Glue to change this project";
  const idle = render(
    createElement(Box, { width: 72, flexDirection: "column" }, createElement(PromptBox, { theme, text: "", cursor: 0, placeholder })),
  );
  const idleFrame = stripAnsi(idle.lastFrame() ?? "");
  const caretLine = idleFrame.split("\n").find((line) => line.includes(">")) ?? "";
  assert.match(caretLine, />/);
  assert.match(caretLine, /Ask Glue to change this project/);
  assert.ok(caretLine.indexOf("Ask") > caretLine.indexOf(">"));
  assert.ok(caretLine.indexOf("Ask") - caretLine.indexOf(">") > 4);
  idle.unmount();

  const composing = render(
    createElement(Box, { width: 72, flexDirection: "column" }, createElement(PromptBox, { theme, text: "", cursor: 0, placeholder, preedit: "xiao" })),
  );
  const composingFrame = stripAnsi(composing.lastFrame() ?? "");
  assert.match(composingFrame, /xiao/);
  assert.equal(composingFrame.split("xiao").length - 1, 1);
  assert.doesNotMatch(composingFrame, /Ask Glue/);
  composing.unmount();

  const typed = render(
    createElement(Box, { width: 72, flexDirection: "column" }, createElement(PromptBox, { theme, text: "hi", cursor: 2, placeholder })),
  );
  assert.doesNotMatch(stripAnsi(typed.lastFrame() ?? ""), /Ask Glue/);
  typed.unmount();

  const dialog = render(
    createElement(PermissionDialog, {
      theme,
      selected: 0,
      prompt: {
        tool: "edit_file",
        title: "Edit",
        target: "src/app.ts",
        detail: "src/app.ts",
        allowLabel: "Yes, and don't ask again for src/app.ts",
      },
    }),
  );
  const frame = dialog.lastFrame() ?? "";
  assert.match(frame, /Do you want to proceed/);
  assert.match(frame, /tell Glue what to do differently/);
  dialog.unmount();
});

test("tool rows use the circle and corner glyphs", () => {
  const view = render(
    createElement(ToolBlock, {
      theme,
      expanded: false,
      item: {
        id: "1",
        type: "tool",
        name: "edit_file",
        target: "src/app.ts",
        status: "ok",
        summary: "Updated src/app.ts with 1 addition and 1 removal",
      },
    }),
  );
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /⏺ Edit\(src\/app\.ts\)/);
  assert.match(frame, /⎿/);
  view.unmount();
});

test("resume picker lists a session and the keys that select it", () => {
  const view = render(
    createElement(ResumePicker, {
      theme,
      selected: 0,
      query: "parse",
      matchCount: 1,
      preview: ["> fix the parser"],
      rows: [{ id: "20261026-120000-ab12", title: "fix the parser", meta: "2h ago · 20261026-120000-ab12" }],
    }),
  );
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /Resume session/);
  assert.match(frame, /fix the parser/);
  assert.match(frame, /filter: parse/);
  assert.match(frame, /enter resume/);
  assert.match(frame, /esc cancel/);
  view.unmount();

  const models = render(
    createElement(ModelPicker, {
      theme,
      rows: ["solo"],
      selected: 0,
      position: "1/1 · solo",
      effort: "auto",
    }),
  );
  const modelFrame = models.lastFrame() ?? "";
  assert.match(modelFrame, /1\/1 · solo/);
  assert.match(modelFrame, /❯\s+solo/);
  assert.match(modelFrame, /enter select/);
  assert.match(modelFrame, /esc cancel/);
  assert.match(modelFrame, /effort auto/);
  models.unmount();

  const auto = render(
    createElement(StatusBar, { theme, mode: "default", usage: { input: 0, output: 0 }, approval: "auto", effort: "max" }),
  );
  assert.match(auto.lastFrame() ?? "", /auto mode on/);
  assert.match(auto.lastFrame() ?? "", /effort max/);
  auto.unmount();

  const meter = render(createElement(ScrollMeter, { theme, label: "▴ 1–10/40  ·  滚轮或 PgUp 看更早 · PgDn 到底" }));
  assert.match(meter.lastFrame() ?? "", /1–10\/40/);
  assert.match(meter.lastFrame() ?? "", /滚轮或 PgUp/);
  meter.unmount();

  const help = render(
    createElement(CommandHelp, {
      theme,
      offset: 0,
      windowSize: 2,
      lines: ["Glue Cli commands", "/help show", "/login hidden"],
    }),
  );
  const helpFrame = help.lastFrame() ?? "";
  assert.match(helpFrame, /Glue Cli commands/);
  assert.match(helpFrame, /\/help show/);
  assert.doesNotMatch(helpFrame, /\/login hidden/);
  assert.match(helpFrame, /不可用命令只提示一行/);
  help.unmount();

  const effort = render(
    createElement(EffortPicker, {
      theme,
      levels: ["low", "medium", "high", "xhigh", "max", "ultracode", "auto"],
      selected: 2,
    }),
  );
  const effortFrame = effort.lastFrame() ?? "";
  assert.match(effortFrame, /Effort/);
  assert.match(effortFrame, /Faster/);
  assert.match(effortFrame, /Smarter/);
  assert.match(effortFrame, /\[high\]/);
  assert.match(effortFrame, /low/);
  assert.match(effortFrame, /ultracode/);
  assert.match(effortFrame, /auto/);
  assert.match(effortFrame, /●/);
  assert.match(effortFrame, /Deeper thinking/);
  assert.match(effortFrame, /tab UltraCode/);
  assert.match(effortFrame, /enter set/);
  assert.match(effortFrame, /esc cancel/);
  effort.unmount();

  const ultra = render(
    createElement(EffortPicker, {
      theme,
      levels: ["low", "medium", "high", "xhigh", "max", "ultracode", "auto"],
      selected: 5,
    }),
  );
  const ultraFrame = ultra.lastFrame() ?? "";
  assert.match(ultraFrame, /\[ultracode\]/);
  assert.match(ultraFrame, /max thinking \+ subagent dispatch/);
  assert.match(ultraFrame, /May use many tokens/);
  ultra.unmount();
});

test("user lines are bold and a different color slot from the assistant body", () => {
  assert.deepEqual(transcriptTone("user"), { bold: true, slot: "user" });
  assert.deepEqual(transcriptTone("assistant"), { bold: false, slot: "text" });
  assert.notEqual(THEMES.dark.user, THEMES.dark.text);
  assert.notEqual(THEMES.light.user, THEMES.light.text);
  assert.notEqual(THEMES.ansi.user, THEMES.ansi.text);
  const view = render(
    createElement(TranscriptView, {
      theme: THEMES.dark,
      expanded: false,
      items: [
        { id: "u", type: "user", text: "wht exact work" },
        { id: "a", type: "assistant", text: "Here's the honest version" },
      ],
    }),
  );
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /> wht exact work/);
  assert.match(frame, /Here's the honest version/);
  view.unmount();
});

test("a selected slash row keeps one color across the command and the full description", () => {
  assert.equal(slashRowTone(true), "accent");
  assert.equal(slashRowTone(false), "muted");
  const summary = "Session status for this session";
  const wide = slashRowLines(true, "statusline", summary, 100);
  assert.equal(wide.length, 1);
  assert.match(wide[0] ?? "", /\/statusline\s+Session status for this session/);
  assert.equal((wide[0] ?? "").includes("statusge"), false);
  const narrow = slashRowLines(true, "statusline", summary, 16);
  const painted = narrow.join("\n");
  assert.equal(painted.includes("statusge"), false);
  assert.doesNotMatch(painted, /statu\ns/);
  assert.doesNotMatch(painted, /status\nl/);
  assert.match(narrow.join(" "), /Session status for this session/);
  const view = render(
    createElement(SlashMenu, {
      theme: THEMES.dark,
      selected: 0,
      columns: 20,
      rows: [
        { name: "statusline", summary },
        { name: "status", summary: "Session status" },
      ],
    }),
  );
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /statusline/);
  assert.match(frame.replace(/\s+/g, " "), /Session status for this session/);
  assert.doesNotMatch(frame, /statusge/);
  assert.doesNotMatch(frame, /statu\nsline/);
  view.unmount();
});

test("status bar shows context percent, window size, and cache hit when the data exists", () => {
  const view = render(
    createElement(StatusBar, {
      theme,
      mode: "default",
      approval: "manual",
      effort: "max",
      model: "lite",
      usage: { input: 1000, output: 0, cacheRead: 250 },
      contextWindow: 128000,
      fields: ["model", "effort", "tokens", "context", "contextSize", "cache"],
    }),
  );
  const frame = view.lastFrame() ?? "";
  const flat = frame.replace(/\s+/g, " ");
  assert.match(flat, /lite/);
  assert.match(flat, /effort max/);
  assert.match(flat, /1\.0k tok/);
  assert.match(flat, /ctx 1%/);
  assert.match(flat, /window 128\.0k/);
  assert.match(flat, /cache 25%/);
  assert.match(flat, /manual mode on/);
  view.unmount();
  const quiet = render(
    createElement(StatusBar, {
      theme,
      mode: "default",
      usage: { input: 0, output: 0 },
      contextWindow: 128000,
      fields: ["tokens", "cache"],
    }),
  );
  assert.doesNotMatch(quiet.lastFrame() ?? "", /cache/);
  assert.doesNotMatch(quiet.lastFrame() ?? "", /tok/);
  quiet.unmount();
});
