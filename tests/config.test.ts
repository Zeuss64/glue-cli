import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig, redactKey } from "../src/config.js";

function workspace(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "glue-cfg-"));
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return dir;
}

test("config precedence is cli, then GLUE_, AGENT_, OPENAI_, then the project file", () => {
  const cwd = workspace({
    ".agent/config.toml": `
model = "from-file"
base_url = "https://file.example/v1"
permission_mode = "plan"
profile = "from-file"
api_key = "file-key-123456"
`,
  });
  const fromFile = loadConfig({ cwd, env: {} });
  assert.equal(fromFile.model, "from-file");
  assert.equal(fromFile.baseURL, "https://file.example/v1");
  assert.equal(fromFile.permissionMode, "plan");
  assert.equal(fromFile.apiKeySource, "config file");

  const openai = loadConfig({
    cwd,
    env: { OPENAI_MODEL: "openai-model", OPENAI_API_KEY: "openai-key-1234", OPENAI_BASE_URL: "https://openai.example/v1/" },
  });
  assert.equal(openai.model, "openai-model");
  assert.equal(openai.baseURL, "https://openai.example/v1");
  assert.equal(openai.apiKeySource, "OPENAI_API_KEY");

  const agent = loadConfig({
    cwd,
    env: {
      OPENAI_MODEL: "openai-model",
      AGENT_MODEL: "agent-model",
      OPENAI_API_KEY: "openai-key-1234",
      AGENT_API_KEY: "agent-key-1234",
      AGENT_BASE_URL: "https://agent.example/v1",
    },
  });
  assert.equal(agent.model, "agent-model");
  assert.equal(agent.apiKey, "agent-key-1234");
  assert.equal(agent.baseURL, "https://agent.example/v1");

  const glue = loadConfig({
    cwd,
    env: {
      AGENT_MODEL: "agent-model",
      GLUE_MODEL: "glue-model",
      AGENT_API_KEY: "agent-key-1234",
      GLUE_API_KEY: "glue-key-1234",
      GLUE_BASE_URL: "https://glue.example/v1",
      GLUE_PERMISSION_MODE: "acceptEdits",
      GLUE_PROFILE: "cpld",
      GLUE_SHELL: "1",
    },
  });
  assert.equal(glue.model, "glue-model");
  assert.equal(glue.apiKeySource, "GLUE_API_KEY");
  assert.equal(glue.permissionMode, "acceptEdits");
  assert.equal(glue.profile, "cpld");
  assert.equal(glue.shellEnabled, true);

  const cli = loadConfig({
    cwd,
    env: { GLUE_MODEL: "glue-model", GLUE_BASE_URL: "https://glue.example/v1", GLUE_PERMISSION_MODE: "plan" },
    model: "cli-model",
    baseURL: "https://cli.example/v1",
    permissionMode: "dontAsk",
    profile: "default",
    allowedTools: ["Bash(npm test *)"],
  });
  assert.equal(cli.model, "cli-model");
  assert.equal(cli.baseURL, "https://cli.example/v1");
  assert.equal(cli.permissionMode, "dontAsk");
  assert.equal(cli.profile, "default");
  assert.ok(cli.permissions.allow.includes("Bash(npm test *)"));
});

test("shell.allow entries become Bash prefix rules", () => {
  const cwd = workspace({
    "agent.config.json": JSON.stringify({ shell: { enabled: true, allow: ["git status"] }, theme: "light" }),
  });
  const config = loadConfig({ cwd, env: {} });
  assert.equal(config.shellEnabled, true);
  assert.equal(config.theme, "light");
  assert.ok(config.permissions.allow.includes("Bash(git status *)"));
});

test("redactKey hides all but the last four characters", () => {
  assert.equal(redactKey(undefined), "missing");
  assert.equal(redactKey("short"), "set");
  assert.equal(redactKey("glue-key-1234"), "set (…1234)");
});
