import assert from "node:assert/strict";
import test from "node:test";
import {
  bashAllowRule,
  decidePermission,
  emptyRules,
  matchCommand,
  modeLabel,
  nextMode,
  normalizeMode,
} from "../src/permissions.js";

const base = { rules: emptyRules(), shellEnabled: true as boolean | undefined };

test("permission decisions follow mode, rules, and read-only bash", () => {
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "default", relPath: "src/a.ts" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "acceptEdits", relPath: "src/a.ts" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "plan", relPath: "src/a.ts" }), "deny");
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "dontAsk", relPath: "src/a.ts" }), "deny");
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "bypassPermissions", relPath: "src/a.ts" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "read_file", mode: "default", relPath: "src/a.ts" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "ls -la" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "rm -rf tmp" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "acceptEdits", command: "mkdir out" }), "allow");
  assert.equal(
    decidePermission({ ...base, tool: "run_shell", mode: "bypassPermissions", command: "rm -rf tmp", shellEnabled: false }),
    "deny",
  );

  const denied = emptyRules();
  denied.deny.push("Edit(src/a.ts)");
  assert.equal(
    decidePermission({ tool: "edit_file", mode: "bypassPermissions", rules: denied, relPath: "src/a.ts", shellEnabled: true }),
    "deny",
  );
  const allowed = emptyRules();
  allowed.allow.push("Edit(src/a.ts)");
  assert.equal(
    decidePermission({ tool: "edit_file", mode: "default", rules: allowed, relPath: "src/a.ts", shellEnabled: true }),
    "allow",
  );
  assert.equal(
    decidePermission({ ...base, tool: "write_file", mode: "default", relPath: ".git/config", protectedPath: true }),
    "deny",
  );
});

test("bash prefix rules and mode labels match the public wording", () => {
  assert.equal(bashAllowRule("git status --short"), "Bash(git status *)");
  assert.equal(matchCommand("git status *", "git status"), true);
  assert.equal(matchCommand("git status *", "git status --short"), true);
  assert.equal(matchCommand("git status *", "git stash"), false);
  assert.equal(matchCommand("git status", "git status --short"), false);
  assert.equal(normalizeMode("manual"), "default");
  assert.equal(normalizeMode("accept-edits"), "acceptEdits");
  assert.throws(() => normalizeMode("yolo"));
  assert.equal(nextMode("default", false), "acceptEdits");
  assert.equal(nextMode("acceptEdits", false), "plan");
  assert.equal(nextMode("plan", false), "default");
  assert.equal(nextMode("plan", true), "bypassPermissions");
  assert.equal(modeLabel("default"), "⏸ manual mode on");
  assert.equal(modeLabel("acceptEdits"), "⏵⏵ accept edits on");
  assert.equal(modeLabel("plan"), "⏸ plan mode on");
  assert.equal(modeLabel("bypassPermissions"), "⏵⏵ bypass permissions on");
});
