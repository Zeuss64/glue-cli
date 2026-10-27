import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "install-global.mjs");

type LaunchSpec = { command: string; args: string[]; shell: boolean };
type SpawnOptions = { shell?: boolean; cwd?: string; stdio?: string; encoding?: string };
type SpawnResult = {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
  error?: Error;
};
type Installer = {
  GLOBAL_INSTALL_ARGS: string[];
  npmLaunchSpec: (npmArgs: string[], options?: Record<string, unknown>) => LaunchSpec;
  runNpm: (
    npmArgs: string[],
    options?: Record<string, unknown>,
    launch?: Record<string, unknown>,
    spawn?: (command: string, args: string[], options: SpawnOptions) => SpawnResult,
  ) => SpawnResult;
  queryNpmPrefix: (
    platform?: string,
    env?: NodeJS.ProcessEnv,
    spawn?: (command: string, args: string[], options: SpawnOptions) => SpawnResult,
  ) => string;
};

const installer = (await import(pathToFileURL(script).href)) as Installer;

function run(args: string[], extraEnv?: Record<string, string>): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function assertCmdIsShelled(spec: LaunchSpec) {
  const command = spec.command.toLowerCase();
  if (command.endsWith(".cmd") || command.endsWith(".bat")) {
    assert.equal(spec.shell, true, `${spec.command} must be spawned with shell: true`);
  }
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

  const direct = run(["--dry-run"], { npm_execpath: "", npm_node_execpath: "" });
  assert.equal(direct.code, 0, direct.stderr);
  assert.match(direct.stdout, /npm install -g \./);
  assert.match(direct.stdout, /^bin: \S/m);
});

test("Windows npm.cmd is never spawned without a shell", () => {
  const { npmLaunchSpec, runNpm, queryNpmPrefix, GLOBAL_INSTALL_ARGS } = installer;
  const programFiles = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const nodeExe = "C:\\Program Files\\nodejs\\node.exe";

  const viaNpmRun = npmLaunchSpec(GLOBAL_INSTALL_ARGS, {
    platform: "win32",
    env: { npm_execpath: programFiles, npm_node_execpath: nodeExe },
    nodeBin: nodeExe,
    fileExists: () => true,
  });
  assert.equal(viaNpmRun.command, nodeExe);
  assert.equal(viaNpmRun.shell, false);
  assert.deepEqual(viaNpmRun.args, [programFiles, ...GLOBAL_INSTALL_ARGS]);
  assertCmdIsShelled(viaNpmRun);

  for (const ext of ["cmd", "bat", "ps1", "CMD"]) {
    const shim = npmLaunchSpec(["prefix", "-g"], {
      platform: "win32",
      env: { npm_execpath: `C:\\Program Files\\nodejs\\npm.${ext}` },
      fileExists: () => true,
    });
    assert.equal(shim.command, "npm.cmd", ext);
    assert.equal(shim.shell, true, ext);
    assert.deepEqual(shim.args, ["prefix", "-g"]);
    assertCmdIsShelled(shim);
  }

  const missingJs = npmLaunchSpec(GLOBAL_INSTALL_ARGS, {
    platform: "win32",
    env: { npm_execpath: "C:\\missing\\npm-cli.js" },
    fileExists: () => false,
  });
  assert.equal(missingJs.command, "npm.cmd");
  assert.equal(missingJs.shell, true);
  assert.deepEqual(missingJs.args, [...GLOBAL_INSTALL_ARGS]);

  const calls: Array<{ command: string; args: string[]; options: SpawnOptions }> = [];
  const spawn = (command: string, args: string[], options: SpawnOptions): SpawnResult => {
    calls.push({ command, args, options });
    return { status: 0, stdout: "D:\\Tools\\npm\n", stderr: "" };
  };
  const prefix = queryNpmPrefix("win32", { npm_execpath: "" }, spawn);
  assert.equal(prefix, "D:\\Tools\\npm");
  assert.equal(calls[0]?.command, "npm.cmd");
  assert.equal(calls[0]?.options.shell, true);
  assert.deepEqual(calls[0]?.args, ["prefix", "-g"]);

  const install = runNpm(
    GLOBAL_INSTALL_ARGS,
    { cwd: "D:\\Glue\\glue-cli", stdio: "inherit" },
    { platform: "win32", env: {}, fileExists: () => false },
    spawn,
  );
  assert.equal(install.status, 0);
  assert.equal(calls[1]?.command, "npm.cmd");
  assert.equal(calls[1]?.options.shell, true);
  assert.equal(calls[1]?.options.cwd, "D:\\Glue\\glue-cli");
  assert.equal(calls[1]?.options.stdio, "inherit");
  assert.deepEqual(calls[1]?.args, ["install", "-g", ".", "--no-fund", "--no-audit"]);
  assert.throws(
    () => queryNpmPrefix("win32", {}, () => ({ status: null, error: new Error("spawnSync npm.cmd EINVAL") })),
    /spawnSync npm\.cmd EINVAL/,
  );

  const unix = npmLaunchSpec(["prefix", "-g"], { platform: "linux", env: {}, fileExists: () => false });
  assert.deepEqual(unix, { command: "npm", args: ["prefix", "-g"], shell: false });
});

test("Windows npm_execpath launch runs node on the JS entry, including paths with spaces", () => {
  const { runNpm, GLOBAL_INSTALL_ARGS } = installer;
  const dir = mkdtempSync(path.join(tmpdir(), "glue npm "));
  const cli = path.join(dir, "npm-cli.js");
  writeFileSync(cli, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  try {
    const result = runNpm(GLOBAL_INSTALL_ARGS, { encoding: "utf8" }, {
      platform: "win32",
      env: { npm_execpath: cli },
      nodeBin: process.execPath,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr ?? "");
    assert.deepEqual(JSON.parse(String(result.stdout)), GLOBAL_INSTALL_ARGS);
    assert.match(cli, / /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
