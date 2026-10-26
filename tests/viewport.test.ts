import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptItem } from "../src/types.js";
import { visualLines } from "../src/tui/text.js";
import { fitTranscript, frameRows, transcriptBudget, visibleTranscript } from "../src/tui/viewport.js";

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
