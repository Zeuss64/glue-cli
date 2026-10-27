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
  assert.match(status.lastFrame() ?? "", /tokens:10\/2/);
  assert.match(status.lastFrame() ?? "", /shift\+tab to cycle/);
  status.unmount();

  const effortStatus = render(
    createElement(StatusBar, {
      theme,
      mode: "default",
      usage: { input: 0, output: 0 },
      effort: "high",
      model: "glue-lite",
      cwd: "D:/work",
      contextWindow: 128000,
    }),
  );
  const effortFrame = stripAnsi(effortStatus.lastFrame() ?? "");
  assert.match(effortFrame, /D:\/work/);
  assert.match(effortFrame, /\[glue-lite \(128K context\)\]/);
  assert.match(effortFrame, /effort:high/);
  assert.match(effortFrame, /tokens:0\/0/);
  assert.match(effortFrame, /ctx:0% \(0\/128K\)/);
  assert.match(effortFrame, /cache:-/);
  assert.match(effortFrame, /◎ high · \/effort/);
  effortStatus.unmount();

  const compact = render(
    createElement(StatusBar, { theme, mode: "default", usage: { input: 10, output: 2 }, compact: true }),
  );
  assert.doesNotMatch(compact.lastFrame() ?? "", /tokens:/);
  assert.match(compact.lastFrame() ?? "", /manual mode on/);
  assert.match(compact.lastFrame() ?? "", /◎/);
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
  assert.match(modelFrame, /Select model/);
  assert.match(modelFrame, /1\/1 · solo/);
  assert.match(modelFrame, /❯\s+solo/);
  assert.match(modelFrame, /Enter to select/);
  assert.match(modelFrame, /Esc to cancel/);
  assert.match(modelFrame, /◎ Auto effort/);
  assert.match(modelFrame, /←\/→ to adjust/);
  models.unmount();

  const auto = render(
    createElement(StatusBar, { theme, mode: "default", usage: { input: 0, output: 0 }, approval: "auto", effort: "max" }),
  );
  assert.match(auto.lastFrame() ?? "", /auto mode on/);
  assert.match(auto.lastFrame() ?? "", /effort:max/);
  assert.match(auto.lastFrame() ?? "", /shift\+tab/);
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
      levels: ["low", "medium", "high", "xhigh", "max"],
      selected: 2,
    }),
  );
  const pickerFrame = stripAnsi(effort.lastFrame() ?? "");
  assert.match(pickerFrame, /Effort/);
  assert.match(pickerFrame, /Faster/);
  assert.match(pickerFrame, /Smarter/);
  assert.match(pickerFrame, /high/);
  assert.match(pickerFrame, /Ultracode off/);
  assert.match(pickerFrame, /Tab to toggle/);
  assert.match(pickerFrame, /Deeper thinking/);
  assert.match(pickerFrame, /←\/→ to adjust/);
  assert.match(pickerFrame, /Enter to confirm/);
  assert.match(pickerFrame, /Esc to cancel/);
  assert.doesNotMatch(pickerFrame, /s for this session only/);
  const pickerLines = pickerFrame.split("\n");
  const labelLine = pickerLines.find((line) => line.includes("medium") && line.includes("xhigh")) ?? "";
  const trackLine = pickerLines.find((line) => line.includes("▲")) ?? "";
  const highAt = labelLine.indexOf("high");
  const knobAt = trackLine.indexOf("▲");
  assert.ok(highAt >= 0 && knobAt >= highAt && knobAt < highAt + "high".length);
  effort.unmount();

  const ultra = render(
    createElement(EffortPicker, {
      theme,
      levels: ["low", "medium", "high", "xhigh", "max"],
      selected: 4,
      ultracode: true,
    }),
  );
  const ultraFrame = stripAnsi(ultra.lastFrame() ?? "");
  assert.match(ultraFrame, /Ultracode on/);
  assert.match(ultraFrame, /dynamic workflows on every task/);
  assert.match(ultraFrame, /May use excessive tokens/);
  assert.doesNotMatch(ultraFrame.split("\n").find((line) => line.includes("xhigh")) ?? "", /ultracode/);
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
    }),
  );
  const frame = view.lastFrame() ?? "";
  const flat = frame.replace(/\s+/g, " ");
  assert.match(flat, /lite/);
  assert.match(flat, /128K context/);
  assert.match(flat, /effort:max/);
  assert.match(flat, /tokens:1000\/0/);
  assert.match(flat, /ctx:1% \(1K\/128K\)/);
  assert.match(flat, /cache:25%/);
  assert.match(flat, /manual mode on/);
  assert.match(flat, /◎ max · \/effort/);
  view.unmount();
  const quiet = render(
    createElement(StatusBar, {
      theme,
      mode: "default",
      usage: { input: 0, output: 0 },
      contextWindow: 128000,
    }),
  );
  assert.match(quiet.lastFrame() ?? "", /cache:-/);
  assert.match(quiet.lastFrame() ?? "", /tokens:0\/0/);
  quiet.unmount();
});
