import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptItem } from "../src/types.js";
import { visualLines } from "../src/tui/text.js";
import {
  fitTranscript,
  frameRows,
  frameSize,
  layoutColumns,
  moveScroll,
  pageLines,
  reconcileSize,
  scrollHint,
  smallestRows,
  transcriptBudget,
  transcriptLineCount,
  transcriptWindow,
  visibleTranscript,
  type SizeMemory,
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
  assert.equal(layoutColumns(100), 99);
  assert.equal(layoutColumns(2), 1);
  assert.equal(layoutColumns(undefined), 79);
  assert.equal(layoutColumns(0), 79);
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
});

test("scroll is by visual lines, so a long reply and the messages above it stay reachable", () => {
  const text = Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n");
  const item: TranscriptItem = { id: "a", type: "assistant", text };
  const older: TranscriptItem = { id: "b", type: "assistant", text: "kept" };
  const user: TranscriptItem = { id: "u", type: "user", text: "hi" };
  assert.equal(transcriptLineCount([user], 80), 2);

  const tail = transcriptWindow([older, item], 0, 80, 5);
  assert.equal(tail.below, 0);
  assert.ok(tail.above > 0);
  assert.equal(tail.items.length, 1);
  assert.equal(tail.items[0]?.id, "a");
  const tailText = tail.items[0]?.type === "assistant" ? tail.items[0].text : "";
  assert.match(tailText, /line 99/);
  assert.doesNotMatch(tailText, /line 0/);
  assert.equal(scrollHint(tail.above, tail.below), "… wheel or pgup for earlier");

  const middle = transcriptWindow([older, item], 55, 80, 5);
  const middleText = middle.items[0]?.type === "assistant" ? middle.items[0].text : "";
  assert.match(middleText, /line 40/);
  assert.match(middleText, /line 44/);
  assert.doesNotMatch(middleText, /line 39/);
  assert.doesNotMatch(middleText, /line 45/);
  assert.equal(scrollHint(middle.above, middle.below), "… wheel or pgup for earlier · pgdn for latest");

  const top = transcriptWindow([older, item], 96, 80, 5);
  assert.equal(top.above, 0);
  assert.equal(top.items[0]?.id, "b");
  const head = top.items[1]?.type === "assistant" ? top.items[1].text : "";
  assert.match(head, /line 0/);
  assert.equal(scrollHint(top.above, top.below), "… pgdn for latest");
  assert.deepEqual(visibleTranscript([older, item], 96, 80, 5).map((entry) => entry.id), top.items.map((entry) => entry.id));

  assert.equal(moveScroll(0, 3, top.total, 5), 3);
  assert.equal(moveScroll(94, 10, top.total, 5), 96);
  assert.equal(moveScroll(2, -3, top.total, 5), 0);
  assert.equal(pageLines(5), 4);

  const wide = "你".repeat(20);
  const sliced = transcriptWindow([{ id: "w", type: "assistant", text: wide }], 1, 10, 2);
  const shown = sliced.items[0]?.type === "assistant" ? sliced.items[0].text : "";
  assert.equal(visualLines(shown, 10), 2);
  assert.equal(shown, "你".repeat(10));

  const summary = Array.from({ length: 30 }, (_, index) => `sum ${index}`).join("\n");
  const tool: TranscriptItem = {
    id: "t",
    type: "tool",
    name: "edit_file",
    target: "a.ts",
    status: "ok",
    summary,
    diff: [{ kind: "add", text: "added" }],
    detail: "full patch",
  };
  const toolTail = transcriptWindow([tool], 0, 40, 4);
  assert.equal(toolTail.items[0]?.type, "tool");
  if (toolTail.items[0]?.type === "tool") {
    assert.match(toolTail.items[0].summary ?? "", /sum 29/);
    assert.deepEqual(toolTail.items[0].diff, [{ kind: "add", text: "added" }]);
    assert.equal(toolTail.items[0].detail, undefined);
    assert.equal(toolTail.items[0].showHeader, false);
  }

  const partialUser = transcriptWindow([{ id: "u", type: "user", text: "one\ntwo\nthree\nfour" }], 2, 80, 2);
  assert.equal(partialUser.items[0]?.type, "user");
  if (partialUser.items[0]?.type === "user") {
    assert.equal(partialUser.items[0].gap, false);
    assert.equal(partialUser.items[0].text, "one\ntwo");
  }
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

test("a changed stdout wins so fullscreen can grow and a shrink is not stuck large", () => {
  const memory: SizeMemory = { rows: 30, columns: 80, inkRows: 30, inkColumns: 80, procRows: 30, procColumns: 80 };
  const grown = reconcileSize(memory, { rows: 30, columns: 80 }, { rows: 55, columns: 140 });
  assert.equal(grown.resized, true);
  assert.equal(grown.rows, 55);
  assert.equal(grown.columns, 140);
  const stuck = reconcileSize(grown.memory, { rows: 30, columns: 80 }, { rows: 55, columns: 140 });
  assert.equal(stuck.resized, false);
  assert.equal(stuck.rows, 55);

  const shrunk = reconcileSize(grown.memory, { rows: 55, columns: 140 }, { rows: 24, columns: 80 });
  assert.equal(shrunk.resized, true);
  assert.equal(shrunk.rows, 24);
  assert.equal(shrunk.columns, 80);
  const held = reconcileSize(shrunk.memory, { rows: 55, columns: 140 }, { rows: 24, columns: 80 });
  assert.equal(held.resized, false);
  assert.equal(held.rows, 24);
});

test("line scroll keeps earlier transcript lines and labels the in-app window", () => {
  const text = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
  const item: TranscriptItem = { id: "a", type: "system", text };
  const bottom = transcriptWindow([item], 0, 80, 5);
  assert.match(bottom.items[0]?.type === "system" ? bottom.items[0].text : "", /line 19/);
  assert.equal(bottom.total, 20);
  assert.equal(bottom.below, 0);
  const earlier = transcriptWindow([item], 10, 80, 5);
  const shown = earlier.items[0]?.type === "system" ? earlier.items[0].text : "";
  assert.match(shown, /line 5/);
  assert.doesNotMatch(shown, /line 19/);
  assert.equal(scrollHint(earlier.above, earlier.below), "… wheel or pgup for earlier · pgdn for latest");
  assert.equal(scrollHint(0, 0), "");
});
