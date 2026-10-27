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
  const status = render(createElement(StatusBar, { theme, mode: "acceptEdits" }));
  const statusFrame = stripAnsi(status.lastFrame() ?? "");
  assert.match(statusFrame, /accept edits on/);
  assert.match(statusFrame, /shift\+tab to cycle/);
  assert.doesNotMatch(statusFrame, /tokens:/);
  assert.doesNotMatch(statusFrame, /effort:/);
  assert.doesNotMatch(statusFrame, /ctx:/);
  status.unmount();

  const effortStatus = render(createElement(StatusBar, { theme, mode: "default" }));
  const effortFrame = stripAnsi(effortStatus.lastFrame() ?? "");
  assert.match(effortFrame, /manual mode on/);
  assert.doesNotMatch(effortFrame, /D:\/work/);
  assert.doesNotMatch(effortFrame, /effort:/);
  assert.doesNotMatch(effortFrame, /tokens:/);
  assert.doesNotMatch(effortFrame, /ctx:/);
  assert.doesNotMatch(effortFrame, /cache:/);
  assert.doesNotMatch(effortFrame, /◎/);
  effortStatus.unmount();

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
      rows: ["solo", "other"],
      selected: 1,
      current: "solo",
      start: 0,
      effort: "low",
    }),
  );
  const modelLines = stripAnsi(models.lastFrame() ?? "").split("\n");
  const soloLine = modelLines.find((line) => line.includes("solo")) ?? "";
  const otherLine = modelLines.find((line) => line.includes("other")) ?? "";
  const effortAt = modelLines.findIndex((line) => line.includes("Low effort"));
  const hintAt = modelLines.findIndex((line) => line.includes("Enter to select"));
  const soloAt = modelLines.findIndex((line) => line.includes("solo"));
  assert.match(modelLines.join("\n"), /Select model/);
  assert.match(modelLines.join("\n"), /configured ids/);
  assert.match(soloLine, /1\. solo ✓/);
  assert.match(otherLine, /> 2\. other/);
  assert.equal(soloLine.indexOf("Current session model"), otherLine.indexOf("Configured id"));
  const otherAt = modelLines.findIndex((line) => line.includes("other"));
  assert.ok(otherAt > soloAt);
  assert.equal((modelLines[otherAt + 1] ?? "").trim(), "");
  assert.equal(effortAt, otherAt + 2);
  assert.equal((modelLines[effortAt + 1] ?? "").trim(), "");
  assert.equal(hintAt, effortAt + 2);
  assert.doesNotMatch(modelLines[effortAt] ?? "", /Enter to select/);
  assert.match(modelLines[effortAt] ?? "", /←\/→ to adjust/);
  assert.match(modelLines[hintAt] ?? "", /Esc to cancel/);
  models.unmount();

  const auto = render(createElement(StatusBar, { theme, mode: "default", approval: "auto" }));
  const autoFrame = stripAnsi(auto.lastFrame() ?? "");
  assert.match(autoFrame, /auto mode on/);
  assert.doesNotMatch(autoFrame, /effort:max/);
  assert.match(autoFrame, /shift\+tab/);
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
  const labelAt = pickerLines.findIndex((line) => line.includes("medium") && line.includes("xhigh"));
  const trackAt = pickerLines.findIndex((line) => line.includes("▲"));
  const labelLine = pickerLines[labelAt] ?? "";
  const trackLine = pickerLines[trackAt] ?? "";
  const highAt = labelLine.indexOf("high");
  const knobAt = trackLine.indexOf("▲");
  assert.ok(trackAt >= 0 && labelAt > trackAt);
  assert.match(trackLine, /Faster/);
  assert.match(trackLine, /Smarter/);
  assert.equal(trackLine.split("▲").length - 1, 1);
  assert.doesNotMatch(labelLine, /─/);
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

test("the built-in footer is the mode line and does not print the dense status fields", () => {
  const view = render(createElement(StatusBar, { theme, mode: "default", approval: "manual", session: "sess" }));
  const flat = stripAnsi(view.lastFrame() ?? "").replace(/\s+/g, " ");
  assert.match(flat, /manual mode on/);
  assert.match(flat, /shift\+tab to cycle/);
  assert.match(flat, /sess/);
  assert.doesNotMatch(flat, /tokens:/);
  assert.doesNotMatch(flat, /effort:/);
  assert.doesNotMatch(flat, /ctx:/);
  assert.doesNotMatch(flat, /cache:/);
  assert.doesNotMatch(flat, /◎/);
  view.unmount();
});
