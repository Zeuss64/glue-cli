import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "install-global.mjs");

function run(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("package.json exposes the glue bin and install:global", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    bin: { glue: string };
    scripts: Record<string, string>;
  };
  assert.equal(pkg.bin.glue, "./dist/cli.js");
  assert.match(pkg.scripts["install:global"], /scripts\/install-global\.mjs/);
  assert.match(readFileSync(path.join(root, "src", "cli.ts"), "utf8"), /^#!\/usr\/bin\/env node/);
});

test("Windows global bin is the npm prefix, Unix adds bin", () => {
  const win = run(["--explain", "--platform", "win32", "--prefix", "D:\\Tools\\npm"]);
  assert.equal(win.code, 0, win.stderr);
  assert.match(win.stdout, /^bin: D:\\Tools\\npm$/m);
  assert.doesNotMatch(win.stdout, /D:\\Tools\\npm\\bin/);
  assert.doesNotMatch(win.stdout, /C:/);
  assert.match(win.stdout, /does not copy anything onto a fixed drive or into Program Files/);
  assert.match(win.stdout, /npm prefix -g/);
  assert.match(win.stdout, /%USERPROFILE%\\npm-global/);
  assert.match(win.stdout, /SetEnvironmentVariable\('Path'/);

  const unix = run(["--explain", "--platform", "linux", "--prefix", "/opt/node"]);
  assert.equal(unix.code, 0, unix.stderr);
  assert.match(unix.stdout, /^bin: \/opt\/node\/bin$/m);
  assert.match(unix.stdout, /\$HOME\/\.local/);
  assert.match(unix.stdout, /npm prefix -g/);

  assert.equal(run(["--print-npm", "--platform", "win32"]).stdout.trim(), "npm.cmd");
  assert.equal(run(["--print-npm", "--platform", "linux"]).stdout.trim(), "npm");
  const empty = run(["--explain", "--platform", "linux", "--prefix", " "]);
  assert.notEqual(empty.code, 0);
  assert.match(empty.stderr, /empty path/);
});

test("dry-run describes npm install -g and does not install", () => {
  const dry = run(["--dry-run"]);
  assert.equal(dry.code, 0, dry.stderr);
  assert.match(dry.stdout, /npm install -g \./);
  assert.match(dry.stdout, /^bin: \S/m);
});

test("README documents install:global, npm link, and a user Path", () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /npm run install:global/);
  assert.match(readme, /npm install -g \./);
  assert.match(readme, /npm link/);
  assert.match(readme, /npm unlink -g glue-cli/);
  assert.match(readme, /npm uninstall -g glue-cli/);
  assert.match(readme, /npm prefix -g/);
  assert.match(readme, /%USERPROFILE%\\npm-global/);
  assert.match(readme, /SetEnvironmentVariable\('Path', "\$user;\$prefix", 'User'\)/);
  assert.match(readme, /\$HOME\/\.local/);
  assert.doesNotMatch(readme, /C:\\/);
});
