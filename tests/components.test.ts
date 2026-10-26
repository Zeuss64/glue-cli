import assert from "node:assert/strict";
import { createElement } from "react";
import { render } from "ink-testing-library";
import test from "node:test";
import { ModelPicker, PermissionDialog, ResumePicker, StatusBar, ToolBlock } from "../src/tui/components.js";
import { THEMES } from "../src/tui/theme.js";

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
});
