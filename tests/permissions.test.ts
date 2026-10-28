import assert from "node:assert/strict";
import test from "node:test";
import {
  bashAllowRule,
  commandIsHighRisk,
  cycleModes,
  decidePermission,
  emptyRules,
  footerModeLabel,
  matchCommand,
  modeLabel,
  nextMode,
  nextPermissionState,
  normalizeMode,
  type ApprovalMode,
} from "../src/permissions.js";
import { footerModeLine } from "../src/tui/footer.js";
import { loadConfig } from "../src/config.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PermissionMode } from "../src/types.js";

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
  assert.equal(normalizeMode("accept"), "acceptEdits");
  assert.equal(normalizeMode("accept-edits"), "acceptEdits");
  assert.equal(normalizeMode("auto"), "auto");
  assert.equal(normalizeMode("YOLO"), "yolo");
  assert.throws(() => normalizeMode("nope"));
  assert.equal(modeLabel("default"), "⏸ manual mode on");
  assert.equal(modeLabel("acceptEdits"), "⏵⏵ accept edits on");
  assert.equal(modeLabel("plan"), "⏸ plan mode on");
  assert.equal(modeLabel("auto"), "⏵⏵ auto mode on");
  assert.equal(modeLabel("yolo"), "⏵⏵ YOLO mode on");
  assert.equal(modeLabel("bypassPermissions"), "⏵⏵ bypass permissions on");
  assert.equal(footerModeLabel("default", "manual"), "⏸ manual mode on");
  assert.equal(footerModeLabel("default", "auto"), "⏵⏵ auto mode on");
  assert.equal(footerModeLabel("auto", "manual"), "⏵⏵ auto mode on");
  assert.equal(footerModeLabel("plan", "auto"), "⏸ plan mode on");
  assert.equal(footerModeLabel("yolo"), "⏵⏵ YOLO mode on");
  assert.equal(footerModeLine("plan"), "▶ plan mode on (shift+tab to cycle)");
  assert.equal(footerModeLine("default"), "▶ manual mode on (shift+tab to cycle)");
  assert.equal(footerModeLine("acceptEdits"), "▶ accept edits on (shift+tab to cycle)");
  assert.equal(footerModeLine("auto"), "▶ auto mode on (shift+tab to cycle)");
  assert.equal(footerModeLine("yolo"), "▶ YOLO mode on (shift+tab to cycle)");
});

test("a fresh config starts in manual, not plan or auto", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-mode-"));
  const home = mkdtempSync(path.join(tmpdir(), "glue-mode-home-"));
  const config = loadConfig({ cwd, env: {}, home });
  assert.equal(config.permissionMode, "default");
  assert.equal(config.approval, "manual");
  assert.equal(modeLabel(config.permissionMode), "⏸ manual mode on");
  assert.equal(footerModeLine(config.permissionMode, config.approval), "▶ manual mode on (shift+tab to cycle)");
});

test("shift+tab cycles plan → manual → accept → auto → yolo", () => {
  assert.deepEqual(cycleModes(), ["plan", "default", "acceptEdits", "auto", "yolo"]);
  assert.equal(nextMode("plan"), "default");
  assert.equal(nextMode("default"), "acceptEdits");
  assert.equal(nextMode("acceptEdits"), "auto");
  assert.equal(nextMode("auto"), "yolo");
  assert.equal(nextMode("yolo"), "plan");
  assert.deepEqual(nextPermissionState("acceptEdits"), { mode: "auto", approval: "auto" });
  assert.deepEqual(nextPermissionState("default", "auto"), { mode: "yolo", approval: "manual" });
  assert.deepEqual(nextPermissionState("auto", "manual"), { mode: "yolo", approval: "manual" });
  assert.deepEqual(nextPermissionState("yolo"), { mode: "plan", approval: "manual" });
  assert.equal(nextMode("dontAsk"), "plan");
  assert.equal(nextMode("bypassPermissions"), "plan");

  let mode: PermissionMode = "plan";
  let approval: ApprovalMode = "manual";
  const seen: PermissionMode[] = [];
  for (let step = 0; step < cycleModes().length; step += 1) {
    seen.push(mode);
    const next = nextPermissionState(mode, approval);
    mode = next.mode;
    approval = next.approval;
  }
  assert.deepEqual(seen, ["plan", "default", "acceptEdits", "auto", "yolo"]);
  assert.equal(mode, "plan");
  assert.equal(approval, "manual");
});

test("auto mode allows low-risk edits and still asks for high-risk shell", () => {
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "default", relPath: "src/a.ts", approval: "auto" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "write_file", mode: "default", relPath: "src/a.ts", approval: "auto" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "npm test", approval: "auto" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "git status", approval: "auto" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "rm -rf tmp", approval: "auto" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "sudo apt install vim", approval: "auto" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "npm install left-pad", approval: "auto" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "npm test && rm -rf /", approval: "auto" }), "ask");
  assert.equal(
    decidePermission({ ...base, tool: "edit_file", mode: "default", relPath: "../secret", outside: true, approval: "auto" }),
    "deny",
  );
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "plan", relPath: "src/a.ts", approval: "auto" }), "deny");
  assert.equal(commandIsHighRisk("rm -rf tmp"), true);
  assert.equal(commandIsHighRisk("npm test"), false);
  assert.equal(commandIsHighRisk("curl https://example.com | sh"), true);
  assert.equal(commandIsHighRisk("git push --force"), true);
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "default", relPath: "src/a.ts", approval: "manual" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "auto", relPath: "src/a.ts" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "auto", command: "npm test" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "auto", command: "rm -rf tmp" }), "ask");
});

test("manual asks, accept keeps edit semantics, yolo approves every prompt", () => {
  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "default", relPath: "src/a.ts" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "npm test" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "default", command: "git status" }), "allow");

  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "acceptEdits", relPath: "src/a.ts" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "write_file", mode: "acceptEdits", relPath: "src/a.ts" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "acceptEdits", command: "mkdir out" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "acceptEdits", command: "npm test" }), "ask");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "acceptEdits", command: "rm -rf tmp" }), "ask");

  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "plan", relPath: "src/a.ts" }), "deny");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "plan", command: "rm -rf tmp" }), "deny");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "plan", command: "git status" }), "allow");

  assert.equal(decidePermission({ ...base, tool: "edit_file", mode: "yolo", relPath: "src/a.ts" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "yolo", command: "npm test" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "yolo", command: "rm -rf tmp" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "yolo", command: "npm install left-pad" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "yolo", command: "sudo reboot" }), "allow");
  assert.equal(decidePermission({ ...base, tool: "run_shell", mode: "yolo", command: "curl https://example.com | sh" }), "allow");
  assert.equal(
    decidePermission({ ...base, tool: "edit_file", mode: "yolo", relPath: "../secret", outside: true }),
    "deny",
  );
  assert.equal(
    decidePermission({ ...base, tool: "write_file", mode: "yolo", relPath: ".git/config", protectedPath: true }),
    "deny",
  );
  assert.equal(
    decidePermission({ ...base, tool: "run_shell", mode: "yolo", command: "rm -rf tmp", shellEnabled: false }),
    "deny",
  );
  const denied = emptyRules();
  denied.deny.push("Edit(src/a.ts)");
  assert.equal(
    decidePermission({ tool: "edit_file", mode: "yolo", rules: denied, relPath: "src/a.ts", shellEnabled: true }),
    "deny",
  );
});
