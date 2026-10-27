import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptItem } from "../src/types.js";
import { displayWidth, visualLines } from "../src/tui/text.js";
import {
  clampScroll,
  contentColumns,
  contentRoom,
  fitTranscript,
  frameRows,
  frameSize,
  HINT_EARLIER,
  layoutTranscript,
  retainScroll,
  rowText,
  smallestRows,
  transcriptBudget,
  visibleTranscript,
} from "../src/tui/viewport.js";

test("fullscreen and a resized window share one frame and keep the tail of a long reply", () => {
  const windowed = frameSize([{ rows: 30, columns: 100 }]);
  const fullscreen = frameSize([{ rows: 55, columns: 140 }]);
  assert.deepEqual(windowed, { rows: 29, columns: 100 });
  assert.deepEqual(fullscreen, { rows: 54, columns: 140 });
  const shrunk = frameSize([
    { rows: 55, columns: 140 },
    { rows: 24, columns: 80 },
  ]);
  assert.deepEqual(shrunk, { rows: 23, columns: 80 });
  const toggling = frameSize([
    { rows: 0, columns: 0 },
    { rows: 40, columns: 120 },
  ]);
  assert.deepEqual(toggling, { rows: 39, columns: 120 });
  assert.deepEqual(frameSize([{}]), { rows: 23, columns: 80 });

  const text = Array.from({ length: 80 }, (_, index) => `line ${index}`).join("\n");
  const item: TranscriptItem = { id: "a", type: "assistant", text };
  for (const size of [windowed, fullscreen, shrunk]) {
    const budget = transcriptBudget(size.rows, 0);
    const fitted = fitTranscript([item], size.columns, budget);
    const shown = fitted[0]?.type === "assistant" ? fitted[0].text : "";
    assert.match(shown, /line 79/);
    assert.ok(visualLines(shown, size.columns) <= budget);
  }
});

test("the frame stays one row under the terminal so Ink does not erase scrollback", () => {
  assert.equal(frameRows(24), 23);
  assert.equal(frameRows(2), 1);
  assert.equal(frameRows(undefined), 23);
  assert.equal(frameRows(0), 23);
  assert.equal(transcriptBudget(23, 4), 13);
});

test("a long assistant message is tailed to the row budget", () => {
  const text = Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n");
  const item: TranscriptItem = { id: "a", type: "assistant", text };
  const fitted = fitTranscript([item], 80, 5);
  assert.equal(fitted.length, 1);
  const shown = fitted[0]?.type === "assistant" ? fitted[0].text : "";
  assert.ok(visualLines(shown, 80) <= 5);
  assert.match(shown, /line 99/);
  assert.match(shown, /^…/);
  const older: TranscriptItem = { id: "b", type: "assistant", text: "kept" };
  const windowed = visibleTranscript([older, item], 1, 80, 5);
  assert.equal(windowed.length, 1);
  assert.equal(windowed[0]?.id, "b");
});

test("wide lines and chrome shrink the transcript budget, and a tool row drops its diff", () => {
  assert.equal(smallestRows(40, undefined, 0, 24), 24);
  assert.equal(smallestRows(undefined, 1), undefined);
  assert.equal(frameRows(smallestRows(40, 24)), 23);
  assert.equal(transcriptBudget(10, 100), 1);
  assert.equal(visualLines("你".repeat(10), 10), 2);
  assert.equal(visualLines("a".repeat(10), 10), 1);

  const messages: TranscriptItem[] = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), type: "system", text: `m${n}` }));
  assert.deepEqual(fitTranscript(messages, 80, 3).map((item) => item.id), ["3", "4", "5"]);

  const wide: TranscriptItem = { id: "w", type: "assistant", text: "你".repeat(20) };
  const tailed = fitTranscript([wide], 10, 2);
  const shown = tailed[0]?.type === "assistant" ? tailed[0].text : "";
  assert.ok(visualLines(shown, 10) <= 2);

  const tool: TranscriptItem = {
    id: "t",
    type: "tool",
    name: "edit_file",
    target: "a.ts",
    status: "ok",
    summary: Array.from({ length: 30 }, (_, index) => `sum ${index}`).join("\n"),
    diff: [{ kind: "add", text: "added" }],
    detail: "full patch",
  };
  const clipped = fitTranscript([tool], 40, 4);
  assert.equal(clipped[0]?.type, "tool");
  if (clipped[0]?.type === "tool") {
    assert.equal(clipped[0].diff, undefined);
    assert.equal(clipped[0].detail, undefined);
    assert.match(clipped[0].summary ?? "", /sum 29/);
    assert.ok(visualLines(clipped[0].summary ?? "", 40) <= 3);
  }
});

test("scroll is a line window, so the start of a long reply stays reachable", () => {
  assert.equal(contentColumns(80), 79);
  assert.equal(contentColumns(1), 1);
  const text = Array.from({ length: 30 }, (_, index) => `line ${index}`).join("\n");
  const older: TranscriptItem = { id: "old", type: "system", text: "older-msg" };
  const item: TranscriptItem = { id: "a", type: "assistant", text };
  const bottom = layoutTranscript([older, item], 80, 6, 0);
  const bottomText = bottom.rows.map(rowText).join("\n");
  assert.match(bottomText, /line 29/);
  assert.match(bottomText, new RegExp(HINT_EARLIER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(bottom.rows.length <= 6, true);
  assert.equal(bottom.scroll, 0);

  const middle = layoutTranscript([older, item], 80, 6, 10);
  const middleText = middle.rows.map(rowText).join("\n");
  assert.match(middleText, /line 1[0-9]/);
  assert.doesNotMatch(middleText, /line 29/);
  assert.match(middleText, /pgdn/);
  assert.equal(middle.rows.length <= 6, true);

  const top = layoutTranscript([older, item], 80, 6, 10_000);
  const topText = top.rows.map(rowText).join("\n");
  assert.match(topText, /older-msg/);
  assert.match(topText, /line 0/);
  assert.match(topText, /pgdn/);
  assert.ok(top.scroll < 10_000);

  const grown = layoutTranscript([older, item, { id: "s", type: "system", text: "extra-line" }], 80, 6, middle.scroll, false, bottom.total);
  assert.ok(grown.scroll > middle.scroll);
  assert.equal(retainScroll(0, bottom.total, grown.total, contentRoom(grown.total, 6)), 0);
  assert.equal(clampScroll(-3, 10, 4), 0);
});

test("a user gap is inside the row budget, and wide lines stay within the columns", () => {
  const users: TranscriptItem[] = [
    { id: "u1", type: "user", text: "hi" },
    { id: "a1", type: "assistant", text: "hello" },
    { id: "u2", type: "user", text: "next" },
    { id: "a2", type: "assistant", text: "there" },
  ];
  const laid = layoutTranscript(users, 40, 4, 0);
  assert.ok(laid.rows.length <= 4);
  assert.match(laid.rows.map(rowText).join("\n"), /> next|> there|hello|hi/);

  const wide = layoutTranscript([{ id: "w", type: "assistant", text: "你".repeat(20) }], contentColumns(10), 8, 0);
  assert.ok(wide.rows.length <= 8);
  for (const row of wide.rows) assert.ok(displayWidth(rowText(row)) <= contentColumns(10));

  const tool = layoutTranscript(
    [
      {
        id: "t",
        type: "tool",
        name: "edit_file",
        target: "a.ts",
        status: "ok",
        summary: "updated",
        diff: [{ kind: "add", text: "added" }],
      },
    ],
    80,
    10,
    0,
  );
  const toolText = tool.rows.map(rowText).join("\n");
  assert.match(toolText, /⏺ Edit\(a\.ts\)/);
  assert.match(toolText, /⎿/);
  assert.match(toolText, /\+ added/);
});
