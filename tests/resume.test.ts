import assert from "node:assert/strict";
import { mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  decideResume,
  filterResumeItems,
  firstUserMessageText,
  formatResumeAge,
  openResumePicker,
  reduceResumePicker,
  RESUME_LABEL_COLUMNS,
  resumePickerView,
  sessionListItem,
  sessionResumeTitle,
  type ResumeKey,
  type ResumeListItem,
} from "../src/resume.js";
import { createSession, findSessionFile, listResumeSessions, listSessions, loadSession, type SessionSnapshot } from "../src/session.js";
import { displayWidth } from "../src/tui/text.js";

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
  assert.equal(view.hiddenAbove, 0);
  assert.equal(view.hiddenBelow, 2);
  assert.equal(view.rows[0]?.title, "note 0");
  assert.match(view.rows[0]?.meta ?? "", /2h ago · s0/);
  assert.deepEqual(view.preview, ["> note 0"]);
  const scrolled = resumePickerView(reduceResumePicker(openResumePicker(items), key({ down: true, input: "" })).state, new Date("2026-10-26T12:00:00Z"));
  const further = resumePickerView(
    Array.from({ length: 5 }, () => key({ down: true })).reduce((state, press) => reduceResumePicker(state, press).state, openResumePicker(items)),
    new Date("2026-10-26T12:00:00Z"),
  );
  assert.equal(scrolled.rows[0]?.title, "note 0");
  assert.equal(further.hiddenAbove, 2);
  assert.equal(further.hiddenBelow, 0);
  assert.equal(formatResumeAge("2026-10-24T12:00:00Z", new Date("2026-10-26T12:00:00Z")), "2d ago");
  assert.equal(formatResumeAge("nope"), "nope");
});

test("the default resume label is the first user message on one line", () => {
  const long = `fix the parser\nand keep going ${"x".repeat(200)} lateword`;
  const session = snap("id", "", long);
  session.messages = [
    { role: "user", content: `${long}\n\n<attached path="a.ts">\nsecret body\n</attached>` },
    { role: "user", content: "second question that must not be the label" },
  ];
  session.items = [
    { id: "u", type: "user", text: long },
    { id: "a", type: "assistant", text: "done" },
    { id: "u2", type: "user", text: "second question that must not be the label" },
  ];
  assert.equal(firstUserMessageText(session).startsWith("fix the parser and keep going"), true);
  assert.equal(firstUserMessageText(session).includes("\n"), false);
  assert.doesNotMatch(firstUserMessageText(session), /secret body|second question/);
  const item = sessionListItem(session);
  assert.equal(item.name, "");
  assert.equal(item.title, sessionResumeTitle(session));
  assert.equal(item.title.endsWith("…"), true);
  assert.ok(displayWidth(item.title) <= RESUME_LABEL_COLUMNS);
  assert.equal(item.title.includes("\n"), false);
  assert.doesNotMatch(item.title, /secret body|second question|lateword/);
  assert.match(item.preview, /lateword/);
  assert.equal(filterResumeItems([item], "lateword").length, 1);
  const wide = sessionListItem(snap("wide", "", "你".repeat(80)));
  assert.ok(displayWidth(wide.title) <= RESUME_LABEL_COLUMNS);
  assert.equal(wide.title.endsWith("…"), true);
});

test("a custom name wins over the first user message", () => {
  const named = sessionListItem(snap("id", "  ship the picker  ", "fix the parser and write the tests"));
  assert.equal(named.name, "ship the picker");
  assert.equal(named.title, "ship the picker");
  assert.match(named.preview, /fix the parser/);
  const blank = sessionListItem(snap("id", "   ", "hello there"));
  assert.equal(blank.name, "");
  assert.equal(blank.title, "hello there");
  const attached = snap("id", "", "");
  attached.messages = [{ role: "user", content: "hello world\n\n<attached path=\"a.ts\">\nBIG\n</attached>" }];
  attached.items = [];
  assert.equal(sessionListItem(attached).title, "hello world");
  const typed = snap("id", "", "");
  typed.items = [{ id: "u", type: "user", text: "! ls" }];
  typed.messages = [{ role: "user", content: "I ran this command in the terminal:\n\n$ ls\n\nfile.ts" }];
  assert.equal(sessionResumeTitle(typed), "! ls");
  const view = resumePickerView(
    openResumePicker([named, blank]),
    new Date("2026-10-26T12:00:00Z"),
  );
  assert.equal(view.rows[0]?.title, "ship the picker");
  assert.match(view.rows[0]?.meta ?? "", /fix the parser/);
  assert.equal(view.rows[1]?.title, "hello there");
  assert.doesNotMatch(view.rows[1]?.meta ?? "", /hello there/);
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

test("rename persists on the session name, and the next resume list prefers it", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-resume-name-"));
  const log = createSession(cwd, { cwd, model: "m", profile: "default", permissionMode: "default" });
  log.item({ id: "u", type: "user", text: "fix the parser\nand keep it one line" });
  log.message({ role: "user", content: "fix the parser\nand keep it one line\n\n<attached path=\"a.ts\">\nsecret\n</attached>" });
  log.item({ id: "a", type: "assistant", text: "parser updated" });
  log.message({ role: "user", content: "second question" });
  log.item({ id: "u2", type: "user", text: "second question" });

  const before = listResumeSessions(cwd);
  assert.equal(before.length, 1);
  const unlabeled = sessionListItem(before[0] as SessionSnapshot);
  assert.equal(unlabeled.name, "");
  assert.equal(unlabeled.title, "fix the parser and keep it one line");
  const open = decideResume(undefined, before);
  assert.equal(open.action, "picker");
  if (open.action !== "picker") return;
  assert.equal(open.items[0]?.title, "fix the parser and keep it one line");
  const unlabeledView = resumePickerView(openResumePicker(open.items), new Date("2026-10-26T12:00:00Z"));
  assert.equal(unlabeledView.rows[0]?.title, "fix the parser and keep it one line");
  assert.ok(unlabeledView.preview.some((line) => line.includes("fix the parser and keep it one line")));
  assert.ok(unlabeledView.preview.some((line) => line.includes("parser updated")));

  log.updateMeta({ name: "parser work" });
  const full = loadSession(log.file);
  assert.equal(full.meta.name, "parser work");
  assert.equal(full.messages.filter((message) => message.role === "user").length, 2);

  const after = listResumeSessions(cwd);
  const labeled = sessionListItem(after[0] as SessionSnapshot);
  assert.equal(labeled.name, "parser work");
  assert.equal(labeled.title, "parser work");
  assert.match(labeled.preview, /fix the parser/);
  assert.doesNotMatch(labeled.title, /secret|second question/);
  const renamed = decideResume(undefined, after);
  assert.equal(renamed.action, "picker");
  if (renamed.action !== "picker") return;
  const view = resumePickerView(openResumePicker(renamed.items), new Date("2026-10-26T12:00:00Z"));
  assert.equal(view.rows[0]?.title, "parser work");
  assert.match(view.rows[0]?.meta ?? "", /fix the parser/);
  assert.deepEqual(decideResume("parser work", after), { action: "load", id: log.meta.id });
});

test("the resume list still includes sessions past the first 30 files", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-resume-many-"));
  let oldestId = "";
  let oldestFile = "";
  for (let index = 0; index < 35; index += 1) {
    const log = createSession(cwd, {
      cwd,
      model: "m",
      profile: "default",
      permissionMode: "default",
      name: index === 0 ? "ancient label" : "",
    });
    log.message({ role: "user", content: `task ${index}` });
    const when = new Date(Date.UTC(2020, 0, 1, 0, index));
    utimesSync(log.file, when, when);
    if (index === 0) {
      oldestId = log.meta.id;
      oldestFile = log.file;
    }
  }
  assert.equal(listSessions(cwd).length, 30);
  const listed = listResumeSessions(cwd);
  assert.equal(listed.length, 35);
  const decision = decideResume(undefined, listed);
  assert.equal(decision.action, "picker");
  if (decision.action !== "picker") return;
  const titles = decision.items.map((item) => item.title);
  assert.ok(titles.includes("task 34"));
  assert.ok(titles.includes("ancient label"));
  assert.equal(decision.items.find((item) => item.id === oldestId)?.title, "ancient label");
  assert.equal(findSessionFile(cwd, "ancient label"), oldestFile);
});
