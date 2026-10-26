import assert from "node:assert/strict";
import test from "node:test";
import { diffLines } from "../src/diff.js";
import { applyEdit, EditError } from "../src/edit.js";

test("edit_file replaces one unique span", () => {
  const outcome = applyEdit("alpha\nbeta\ngamma\n", "beta", "BETA");
  assert.equal(outcome.content, "alpha\nBETA\ngamma\n");
  assert.equal(outcome.replacements, 1);
  assert.ok(outcome.diff.some((line) => line.kind === "del" && line.text === "beta"));
  assert.ok(outcome.diff.some((line) => line.kind === "add" && line.text === "BETA"));
});

test("edit_file rejects a missing, repeated, identical, or empty old_string", () => {
  assert.throws(() => applyEdit("alpha", "nope", "x"), /not found/);
  assert.throws(() => applyEdit("a a", "a", "b"), /matched 2 times/);
  assert.throws(() => applyEdit("same", "same", "same"), /identical/);
  assert.throws(() => applyEdit("same", "", "x"), /empty/);
  assert.ok(applyEdit("a a", "a", "b", true).content === "b b");
});

test("edit_file retries CRLF when the needle uses LF", () => {
  const outcome = applyEdit("alpha\r\nbeta\r\n", "beta", "BETA");
  assert.equal(outcome.content, "alpha\r\nBETA\r\n");
});

test("line diff marks an insertion", () => {
  const lines = diffLines("one\n", "one\ntwo\n");
  assert.deepEqual(
    lines.map((line) => line.kind),
    ["ctx", "add"],
  );
});

test("EditError is the failure type", () => {
  assert.throws(() => applyEdit("a", "b", "c"), EditError);
});
