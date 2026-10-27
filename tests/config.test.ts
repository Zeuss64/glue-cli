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
  loadSessionConfig,
  redactKey,
} from "../src/config.js";
import { SUGGESTED_MODELS, modelChoices } from "../src/tui/model-picker.js";

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

test("models and effort load from config, and GLUE_EFFORT wins", () => {
  const cwd = workspace({
    ".agent/config.toml": `
models = ["claude-sonnet-4-5", "gpt-4o"]
effort = "high"
`,
  });
  const loaded = loadConfig({ cwd, env: {} });
  assert.deepEqual(loaded.models, ["claude-sonnet-4-5", "gpt-4o"]);
  assert.equal(loaded.effort, "high");
  const csv = workspace({ ".agent/config.json": `{ "models": "a, b", "effort": "nope" }` });
  const loose = loadConfig({ cwd: csv, env: {} });
  assert.deepEqual(loose.models, ["a", "b"]);
  assert.equal(loose.effort, "auto");
  assert.equal(loadConfig({ cwd, env: { GLUE_EFFORT: "max" } }).effort, "max");
  assert.equal(loadConfig({ cwd, env: {} }).effort, "high");
});

test("one base url lists every models entry, and an empty models list is only model", () => {
  const cwd = workspace({
    ".agent/config.toml": `
model = "sensenova-6.8-flash-lite"
base_url = "https://api.example.test/v1"
models = ["sensenova-6.8-flash-lite", "sensenova-6.8-flash"]
`,
  });
  const loaded = loadConfig({ cwd, env: {} });
  assert.equal(loaded.model, "sensenova-6.8-flash-lite");
  assert.deepEqual(modelChoices(loaded.model, loaded.models), ["sensenova-6.8-flash-lite", "sensenova-6.8-flash"]);
  for (const id of SUGGESTED_MODELS) assert.equal(modelChoices(loaded.model, loaded.models).includes(id), false);
  const only = loadConfig({
    cwd: workspace({ ".agent/config.toml": `model = "only-custom"\nbase_url = "https://api.example.test/v1"\n` }),
    env: {},
  });
  assert.deepEqual(only.models, []);
  assert.deepEqual(modelChoices(only.model, only.models), ["only-custom"]);
});

test("the user config path is under the home directory on Unix and Windows", () => {
  assert.equal(globalConfigPath("/home/ada", path.posix.join), "/home/ada/.glue/config.toml");
  assert.equal(globalConfigPath("C:\\Users\\ada", path.win32.join), "C:\\Users\\ada\\.glue\\config.toml");
});

test("the first session writes placeholders, then later sessions reuse the file", () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const file = globalConfigPath(home);
  const firstProject = workspace();
  assert.equal(existsSync(file), false);

  const loaded = loadSessionConfig({
    cwd: firstProject,
    home,
    env: {
      GLUE_API_KEY: "secret-key-9999",
      GLUE_MODEL: "from-env",
      GLUE_BASE_URL: "https://env.example/v1",
      GLUE_PROTOCOL: "openai",
    },
  });
  assert.equal(loaded.model, "from-env");
  assert.equal(loaded.baseURL, "https://env.example/v1");
  assert.equal(loaded.apiKey, "secret-key-9999");
  assert.equal(loaded.apiKeySource, "GLUE_API_KEY");
  const text = readFileSync(file, "utf8");
  assert.equal(text, defaultGlobalConfigToml());
  assert.match(text, /model = "gpt-4o-mini"/);
  assert.match(text, /base_url = "https:\/\/api\.openai\.com\/v1"/);
  assert.match(text, /# protocol = "openai"/);
  assert.match(text, /# api_key = ""/);
  assert.match(text, /permission_mode = "default"/);
  assert.match(text, /\[shell\]\s+enabled = false/);
  assert.doesNotMatch(text, /^\s*(api_key|apiKey)\s*=/im);
  assert.doesNotMatch(text, /secret-key-9999|from-env|env\.example/);

  const fromFile = loadConfig({ cwd: firstProject, home, env: {} });
  assert.equal(fromFile.model, "gpt-4o-mini");
  assert.equal(fromFile.baseURL, "https://api.openai.com/v1");
  assert.equal(fromFile.protocol, "openai");
  assert.equal(fromFile.apiKey, undefined);

  const saved = [
    'model = "kept-model"',
    'base_url = "https://api.anthropic.com"',
    'protocol = "anthropic"',
    'api_key = "local-key-1234"',
    "",
  ].join("\n");
  writeFileSync(file, saved);
  const secondProject = workspace();
  const again = loadSessionConfig({ cwd: secondProject, home, env: {} });
  assert.equal(again.model, "kept-model");
  assert.equal(again.baseURL, "https://api.anthropic.com");
  assert.equal(again.protocol, "anthropic");
  assert.equal(again.apiKey, "local-key-1234");
  assert.equal(again.apiKeySource, "config file");
  assert.equal(readFileSync(file, "utf8"), saved);

  writeFileSync(file, 'api_key = ""\nmodel = "gpt-4o-mini"\nbase_url = "https://api.openai.com/v1"\n');
  assert.equal(loadConfig({ cwd: secondProject, home, env: {} }).apiKey, undefined);

  const fromEnv = loadSessionConfig({
    cwd: secondProject,
    home,
    env: { GLUE_API_KEY: "env-key-1234" },
  });
  assert.equal(fromEnv.apiKey, "env-key-1234");
  assert.equal(fromEnv.apiKeySource, "GLUE_API_KEY");
  assert.equal(fromEnv.model, "gpt-4o-mini");
  assert.doesNotMatch(readFileSync(file, "utf8"), /env-key-1234/);

  const custom = 'model = "keep-me"\napi_key = "do-not-touch"\n';
  writeFileSync(file, custom);
  assert.equal(ensureGlobalConfig(home).created, false);
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
