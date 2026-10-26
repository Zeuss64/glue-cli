import assert from "node:assert/strict";
import test from "node:test";
import { cliHelp, parseArgs } from "../src/args.js";

test("parseArgs reads print mode, permissions, and positionals", () => {
  const args = parseArgs([
    "-p",
    "--model",
    "deepseek-chat",
    "--base-url",
    "https://api.deepseek.com/v1",
    "--permission-mode",
    "acceptEdits",
    "--allowed-tools",
    "Bash(npm test *)",
    "--add-dir",
    "../other",
    "--",
    "explain the parser",
  ]);
  assert.equal(args.print, true);
  assert.equal(args.model, "deepseek-chat");
  assert.equal(args.baseURL, "https://api.deepseek.com/v1");
  assert.equal(args.permissionMode, "acceptEdits");
  assert.deepEqual(args.allowedTools, ["Bash(npm test *)"]);
  assert.deepEqual(args.addDir, ["../other"]);
  assert.equal(args.prompt, "explain the parser");
});

test("version, help, and unknown flags", () => {
  assert.equal(parseArgs(["-v"]).version, true);
  assert.equal(parseArgs(["--version"]).version, true);
  assert.equal(parseArgs(["run", "do the thing"]).print, true);
  assert.equal(parseArgs(["run", "do the thing"]).prompt, "do the thing");
  assert.match(cliHelp(), /Glue Cli/);
  assert.match(cliHelp(), /glue -p/);
  assert.match(cliHelp(), /\/resume <id> resumes that session/);
  assert.throws(() => parseArgs(["--nope"]));
  assert.throws(() => parseArgs(["--model"]));
  const skip = parseArgs(["--yes"]);
  assert.equal(skip.dangerouslySkip, true);
  assert.equal(skip.allowBypass, true);
  assert.equal(skip.permissionMode, "bypassPermissions");
});
