import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isProtectedRel, Sandbox, SandboxError } from "../src/sandbox.js";

test("sandbox allows workspace files and rejects escapes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "glue-sb-"));
  const outside = mkdtempSync(path.join(tmpdir(), "glue-out-"));
  writeFileSync(path.join(root, "ok.txt"), "yes\n");
  writeFileSync(path.join(outside, "secret.txt"), "nope\n");
  symlinkSync(outside, path.join(root, "escape"));
  symlinkSync(path.join(root, "ok.txt"), path.join(root, "inner"));
  symlinkSync(path.join(outside, "missing"), path.join(root, "broken"));
  mkdirSync(path.join(root, ".git"), { recursive: true });
  writeFileSync(path.join(root, ".git", "config"), "[core]\n");
  mkdirSync(path.join(root, ".agent", "sessions"), { recursive: true });
  writeFileSync(path.join(root, ".agent", "sessions", "a.jsonl"), "{}\n");

  const sandbox = new Sandbox([root]);
  const ok = sandbox.resolve("ok.txt");
  assert.equal(sandbox.relative(ok), "ok.txt");
  assert.equal(sandbox.resolve("inner"), ok);
  assert.equal(sandbox.relative(sandbox.resolve("nested/new.txt")).replace(/\\/g, "/"), "nested/new.txt");

  assert.throws(() => sandbox.resolve("escape/secret.txt"), SandboxError);
  assert.throws(() => sandbox.resolve(path.join(outside, "secret.txt")), SandboxError);
  assert.throws(() => sandbox.resolve("../secret.txt"), SandboxError);
  assert.throws(() => sandbox.resolve("ok.txt\0"), SandboxError);
  assert.throws(() => sandbox.resolve("broken"), SandboxError);
  assert.equal(sandbox.isProtected(sandbox.resolve(".git/config")), true);
  assert.equal(sandbox.isProtected(sandbox.resolve(".agent/sessions/a.jsonl")), true);
  assert.equal(isProtectedRel(".git/hooks/pre-commit"), true);
  assert.equal(isProtectedRel("src/app.ts"), false);
});
