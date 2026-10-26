import assert from "node:assert/strict";
import { createElement } from "react";
import { Box, Text } from "ink";
import { render } from "ink-testing-library";
import test from "node:test";
import { ModelPicker, PermissionDialog, PromptBox, ResumePicker, StatusBar, ToolBlock } from "../src/tui/components.js";
import { modelChoices } from "../src/tui/model-picker.js";
import { THEMES } from "../src/tui/theme.js";

const theme = THEMES.ansi;

test("status bar and permission dialog use the Glue labels", () => {
  const status = render(
    createElement(StatusBar, { theme, mode: "acceptEdits", usage: { input: 10, output: 2 } }),
  );
  assert.match(status.lastFrame() ?? "", /accept edits on/);
  assert.match(status.lastFrame() ?? "", /12 tok/);
  status.unmount();

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
});

test("model picker shows the highlight and the position counter", () => {
  const choices = modelChoices("gpt-4o-mini", "openai");
  const view = render(createElement(ModelPicker, { theme, choices, selected: 1 }));
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /Select model/);
  assert.match(frame, /enter switch/);
  assert.match(frame, /❯/);
  assert.match(frame, new RegExp(`2/${choices.length}`));
  assert.match(frame, /gpt-4o/);
  view.unmount();
});

test("prompt draws the character under the caret", () => {
  const view = render(createElement(PromptBox, { theme, text: "你好", cursor: 1, anchor: 0, placeholder: "ask" }));
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /你/);
  assert.match(frame, /好/);
  view.unmount();

  const empty = render(createElement(PromptBox, { theme, text: "", cursor: 0, placeholder: "ask" }));
  assert.match(empty.lastFrame() ?? "", /ask/);
  empty.unmount();

  const current = modelChoices("gpt-4o-mini", "openai");
  const first = render(createElement(ModelPicker, { theme, choices: current, selected: 0 }));
  const firstFrame = first.lastFrame() ?? "";
  assert.match(firstFrame, new RegExp(`1/${current.length}`));
  assert.match(firstFrame, /gpt-4o-mini\s+current/);
  first.unmount();
});

test("a fixed frame keeps the prompt when the transcript is long", () => {
  const lines = Array.from({ length: 80 }, (_, index) => `line ${index}`).join("\n");
  const view = render(
    createElement(
      Box,
      { flexDirection: "column", height: 12, width: 40, overflow: "hidden" },
      createElement(
        Box,
        { flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" },
        createElement(Text, null, lines),
      ),
      createElement(Box, { flexShrink: 0, borderStyle: "round" }, createElement(Text, null, "PROMPT")),
    ),
  );
  const frame = view.lastFrame() ?? "";
  assert.match(frame, /PROMPT/);
  assert.ok(frame.split("\n").length <= 12, frame);
  view.unmount();
});
