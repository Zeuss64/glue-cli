import assert from "node:assert/strict";
import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  decideResume,
  filterResumeItems,
  formatResumeAge,
  openResumePicker,
  reduceResumePicker,
  resumePickerView,
  type ResumeKey,
  type ResumeListItem,
} from "../src/resume.js";
import { createSession, listSessions, type SessionSnapshot } from "../src/session.js";

function key(partial: Partial<ResumeKey>): ResumeKey {
  return {
    input: "",
    ctrl: false,
    meta: false,
    return: false,
    escape: false,
    backspace: false,
    delete: false,
    up: false,
    down: false,
    pageUp: false,
    pageDown: false,
    ...partial,
  };
}

function snap(id: string, name: string, text: string, updatedAt = "2026-10-26T10:00:00Z"): SessionSnapshot {
  return {
    meta: {
      id,
      name,
      cwd: "/w",
      model: "m",
      profile: "default",
      permissionMode: "default",
      createdAt: updatedAt,
      updatedAt,
    },
    messages: text ? [{ role: "user", content: text }] : [],
    items: text ? [{ id: "u", type: "user", text }] : [],
    todos: [],
  };
}

test("bare /resume lists earlier resumable sessions and skips the current one", () => {
  const current = snap("current", "", "");
  const older = snap("older", "parser", "fix the parser");
  const empty = snap("empty", "", "");
  const decision = decideResume(undefined, [current, older, empty], current.meta.id);
  assert.equal(decision.action, "picker");
  if (decision.action !== "picker") return;
  assert.equal(decision.query, "");
  assert.deepEqual(
    decision.items.map((item) => item.id),
    ["older"],
  );
});

test("no earlier session is a message, not a picker", () => {
  const current = snap("current", "", "still here");
  const decision = decideResume(undefined, [current], current.meta.id);
  assert.deepEqual(decision, { action: "message", text: "No earlier sessions to resume.", level: "system" });
});

test("/resume <id> loads a unique id, name, or prefix immediately", () => {
  const sessions = [snap("20260101-120000-aaaa", "parser", "fix the parser"), snap("20260102-120000-bbbb", "", "add a test")];
  assert.deepEqual(decideResume("20260101-120000-aaaa", sessions), { action: "load", id: "20260101-120000-aaaa" });
  assert.deepEqual(decideResume("20260101-120000-aaaa.jsonl", sessions), { action: "load", id: "20260101-120000-aaaa" });
  assert.deepEqual(decideResume("Parser", sessions), { action: "load", id: "20260101-120000-aaaa" });
  assert.deepEqual(decideResume("20260101-120000-aa", sessions), { action: "load", id: "20260101-120000-aaaa" });
  const missing = decideResume("missing", sessions);
  assert.deepEqual(missing, { action: "message", text: "No session matches missing.", level: "error" });
});

test("an ambiguous prefix opens the picker instead of guessing", () => {
  const sessions = [snap("20260101-120000-aaaa", "", "one"), snap("20260101-120000-bbbb", "", "two")];
  const decision = decideResume("20260101-120000", sessions);
  assert.equal(decision.action, "picker");
  if (decision.action !== "picker") return;
  assert.equal(decision.query, "20260101-120000");
  assert.deepEqual(
    filterResumeItems(decision.items, decision.query).map((item) => item.id),
    ["20260101-120000-aaaa", "20260101-120000-bbbb"],
  );
});

test("picker keys filter, move, and select a session", () => {
  const items: ResumeListItem[] = [
    { id: "new", name: "", preview: "add a test", title: "add a test", updatedAt: "2026-10-26T11:00:00Z", resumable: true, tail: ["> add a test"] },
    { id: "old", name: "parser", preview: "fix the parser", title: "parser", updatedAt: "2026-10-26T09:00:00Z", resumable: true, tail: ["> fix the parser"] },
  ];
  let state = openResumePicker(items);
  let step = reduceResumePicker(state, key({ down: true }));
  assert.equal(step.effect, undefined);
  step = reduceResumePicker(step.state, key({ return: true }));
  assert.deepEqual(step.effect, { type: "select", id: "old" });

  state = openResumePicker(items);
  step = reduceResumePicker(state, key({ input: "parse" }));
  assert.deepEqual(
    filterResumeItems(step.state.all, step.state.query).map((item) => item.id),
    ["old"],
  );
  step = reduceResumePicker(step.state, key({ return: true }));
  assert.deepEqual(step.effect, { type: "select", id: "old" });

  step = reduceResumePicker(step.state, key({ backspace: true }));
  assert.equal(step.state.query, "pars");
  assert.equal(step.state.selected, 0);
  assert.deepEqual(reduceResumePicker(state, key({ escape: true })).effect, { type: "close" });
  assert.deepEqual(reduceResumePicker(state, key({ ctrl: true, input: "c" })).effect, { type: "close" });
  assert.equal(reduceResumePicker(openResumePicker([]), key({ return: true })).effect, undefined);
});

test("picker view windows the list and shows age plus preview", () => {
  const items: ResumeListItem[] = Array.from({ length: 10 }, (_, index) => ({
    id: `s${index}`,
    name: "",
    preview: `note ${index}`,
    title: `note ${index}`,
    updatedAt: "2026-10-26T10:00:00Z",
    resumable: true,
    tail: [`> note ${index}`],
  }));
  const view = resumePickerView(openResumePicker(items), new Date("2026-10-26T12:00:00Z"));
  assert.equal(view.matchCount, 10);
  assert.equal(view.rows.length, 8);
  assert.equal(view.rows[0]?.title, "note 0");
  assert.match(view.rows[0]?.meta ?? "", /2h ago · s0/);
  assert.deepEqual(view.preview, ["> note 0"]);
  assert.equal(formatResumeAge("2026-10-24T12:00:00Z", new Date("2026-10-26T12:00:00Z")), "2d ago");
  assert.equal(formatResumeAge("nope"), "nope");
});

test("sessions on disk keep id and name lookup", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-resume-"));
  const older = createSession(cwd, { cwd, model: "m", profile: "default", permissionMode: "default", name: "parser" });
  older.message({ role: "user", content: "fix the parser" });
  const current = createSession(cwd, { cwd, model: "m", profile: "default", permissionMode: "default" });
  const early = new Date("2020-01-01T00:00:00Z");
  const late = new Date("2024-01-01T00:00:00Z");
  utimesSync(older.file, early, early);
  utimesSync(current.file, late, late);
  const sessions = listSessions(cwd);
  const pick = decideResume(undefined, sessions, current.meta.id);
  assert.equal(pick.action, "picker");
  if (pick.action !== "picker") return;
  assert.deepEqual(
    pick.items.map((item) => item.id),
    [older.meta.id],
  );
  assert.equal(pick.items[0]?.title, "parser");
  const shortened = older.meta.id.slice(0, -1);
  const prefix = sessions.some((session) => session.meta.id !== older.meta.id && session.meta.id.startsWith(shortened))
    ? older.meta.id
    : shortened;
  assert.deepEqual(decideResume(prefix, sessions, current.meta.id), { action: "load", id: older.meta.id });
});
