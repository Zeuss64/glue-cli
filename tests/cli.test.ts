import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "src", "cli.ts");
const tsxLoader = path.join(root, "node_modules", "tsx", "dist", "loader.mjs");

function run(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, cli, ...args], {
      cwd,
      env: { ...process.env, ...env, NO_COLOR: "1" },
    });
    child.stdin.end();
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out\n${stdout}\n${stderr}`));
    }, 20_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function mock(): Promise<{ port: number; stop: () => void }> {
  const child = spawn(process.execPath, [path.join(root, "scripts", "mock-openai.mjs")], {
    env: { ...process.env, PORT: "0" },
  });
  const port = await new Promise<number>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`mock did not listen\n${buf}`)), 5_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      const match = /LISTENING (\d+)/.exec(buf);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`mock exited ${code}: ${buf}`));
    });
  });
  return {
    port,
    stop() {
      child.kill();
    },
  };
}

test("help, version, doctor, and a print run with no prompt leave ~/.glue/config.toml missing", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-cli-"));
  const env = { HOME: home };
  for (const args of [["--help"], ["--version"], ["doctor"], ["-p"]]) {
    const result = await run(args, env, cwd);
    if (args[0] === "-p") assert.notEqual(result.code, 0);
    else assert.equal(result.code, 0, result.stderr);
  }
  assert.equal(existsSync(path.join(home, ".glue", "config.toml")), false);
});

test("glue --version and --help", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-cli-"));
  const version = await run(["--version"], {}, cwd);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^glue 0\.1\.0/);
  const help = await run(["--help"], {}, cwd);
  assert.match(help.stdout, /Glue Cli/);
});

test("print mode writes through the mock only when edits are accepted", async () => {
  const server = await mock();
  const cwd = mkdtempSync(path.join(tmpdir(), "glue-print-"));
  const env = {
    HOME: cwd,
    GLUE_API_KEY: "test-key-1234",
    GLUE_BASE_URL: `http://127.0.0.1:${server.port}/v1`,
    GLUE_MODEL: "mock",
  };
  try {
    const denied = await run(["-p", "create hello.txt", "--cwd", cwd], env, cwd);
    assert.equal(denied.code, 0, denied.stderr);
    assert.equal(existsSync(path.join(cwd, "hello.txt")), false);
    assert.match(denied.stdout, /Denied|Needs approval/);

    const userConfig = path.join(cwd, ".glue", "config.toml");
    const created = readFileSync(userConfig, "utf8");
    assert.match(created, /model = "gpt-4o-mini"/);
    assert.match(created, /enabled = false/);
    assert.doesNotMatch(created, /test-key-1234|api_key\s*=/i);

    const custom = 'model = "keep-me"\napi_key = "do-not-touch"\n';
    writeFileSync(userConfig, custom);

    const allowed = await run(["-p", "create hello.txt", "--cwd", cwd, "--permission-mode", "acceptEdits"], env, cwd);
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.match(allowed.stdout, /Write\(hello\.txt\)/);
    assert.match(allowed.stdout, /Created hello\.txt/);
    assert.equal(readFileSync(path.join(cwd, "hello.txt"), "utf8"), "hello from glue\n");
    assert.equal(readFileSync(userConfig, "utf8"), custom);
  } finally {
    server.stop();
  }
});
