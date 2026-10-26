import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultGlobalConfigToml,
  ensureGlobalConfig,
  ensureGlobalConfigForSession,
  globalConfigPath,
  loadConfig,
  redactKey,
} from "../src/config.js";

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

test("protocol is explicit first, then inferred from the base URL", () => {
  const cwd = workspace();
  assert.equal(loadConfig({ cwd, env: {}, baseURL: "https://api.anthropic.com" }).protocol, "anthropic");
  assert.equal(loadConfig({ cwd, env: {}, baseURL: "https://example.com/v1/messages" }).protocol, "anthropic");
  assert.equal(loadConfig({ cwd, env: {}, baseURL: "https://example.com/v1/chat/completions" }).protocol, "openai");
  assert.equal(loadConfig({ cwd, env: {}, baseURL: "https://example.com/v1" }).protocol, "openai");
  assert.equal(
    loadConfig({ cwd, env: { GLUE_PROTOCOL: "openai" }, baseURL: "https://api.anthropic.com" }).protocol,
    "openai",
  );
  assert.equal(
    loadConfig({ cwd, env: { GLUE_PROTOCOL: "openai" }, baseURL: "https://example.com/v1", protocol: "anthropic" }).protocol,
    "anthropic",
  );
  assert.throws(() => loadConfig({ cwd, env: { GLUE_PROTOCOL: "grpc" } }), /openai or anthropic/);
});

test("a session creates ~/.glue/config.toml once, with defaults and no API key", () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const file = globalConfigPath(home);
  assert.equal(existsSync(file), false);

  const created = ensureGlobalConfig(home);
  assert.equal(created.created, true);
  assert.equal(created.path, file);
  const text = readFileSync(file, "utf8");
  assert.equal(text, defaultGlobalConfigToml());
  assert.match(text, /model = "gpt-4o-mini"/);
  assert.match(text, /base_url = "https:\/\/api\.openai\.com\/v1"/);
  assert.match(text, /permission_mode = "default"/);
  assert.match(text, /\[shell\]\s+enabled = false/);
  assert.doesNotMatch(text, /^\s*(api_key|apiKey)\s*=/im);
  assert.doesNotMatch(text, /secret-key-9999|sk-/);

  const loaded = loadConfig({
    cwd: home,
    home,
    env: { GLUE_API_KEY: "secret-key-9999", GLUE_MODEL: "from-env" },
  });
  assert.equal(loaded.model, "from-env");
  assert.equal(loaded.apiKey, "secret-key-9999");
  assert.equal(loaded.apiKeySource, "GLUE_API_KEY");
  assert.equal(loaded.baseURL, "https://api.openai.com/v1");
  assert.equal(loaded.permissionMode, "default");
  assert.equal(loaded.profile, "default");
  assert.equal(loaded.shellEnabled, false);
  assert.doesNotMatch(readFileSync(file, "utf8"), /secret-key-9999/);

  const fromFile = loadConfig({ cwd: home, home, env: {} });
  assert.equal(fromFile.model, "gpt-4o-mini");
  assert.equal(fromFile.apiKey, undefined);

  const custom = 'model = "keep-me"\napi_key = "do-not-touch"\n';
  writeFileSync(file, custom);
  const again = ensureGlobalConfig(home);
  assert.equal(again.created, false);
  assert.equal(readFileSync(file, "utf8"), custom);

  writeFileSync(file, "");
  assert.equal(ensureGlobalConfig(home).created, false);
  assert.equal(readFileSync(file, "utf8"), "");
});

test("project config still overrides the generated user file", () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const cwd = workspace({
    ".agent/config.toml": `
model = "from-project"
base_url = "https://project.example/v1"
`,
  });
  ensureGlobalConfig(home);
  const config = loadConfig({ cwd, home, env: {} });
  assert.equal(config.model, "from-project");
  assert.equal(config.baseURL, "https://project.example/v1");
  assert.equal(config.shellEnabled, false);
  assert.equal(config.apiKey, undefined);
});

test("a failed user-config write does not throw from the session hook", () => {
  const home = path.join(mkdtempSync(path.join(tmpdir(), "glue-home-")), "not-a-directory");
  writeFileSync(home, "file");
  assert.throws(() => ensureGlobalConfig(home));
  assert.doesNotThrow(() => ensureGlobalConfigForSession(home));
  assert.equal(existsSync(path.join(home, ".glue", "config.toml")), false);
});

test("redactKey hides all but the last four characters", () => {
  assert.equal(redactKey(undefined), "missing");
  assert.equal(redactKey("short"), "set");
  assert.equal(redactKey("glue-key-1234"), "set (…1234)");
});
