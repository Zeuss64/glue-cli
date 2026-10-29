import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runSlashCommand, type CommandHost } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { emptyRules } from "../src/permissions.js";
import {
  formatPluginList,
  installPlugin,
  listPlugins,
  loadPlugin,
  MarketplaceChoiceNeeded,
  parsePluginCommand,
  parsePluginSource,
  readMarketplacePlugins,
  readPluginManifest,
  removePlugin,
  type PluginRunner,
} from "../src/plugins.js";
import { discoverSkills } from "../src/skills.js";
import { MATTPOCOCK_SKILLS, writeMattPocockPlugin } from "./mattpocock-fixture.js";

test("mattpocock-like manifest installs 27 skills and /plugin parses scope, source, and unknown commands", async () => {
  assert.equal(MATTPOCOCK_SKILLS.length, 27);
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  let clones = 0;
  const run: PluginRunner = (_command, args) => {
    clones += 1;
    assert.equal(args[0], "clone");
    assert.equal(args[3], "https://github.com/mattpocock/skills.git");
    writeMattPocockPlugin(args[4] ?? "");
    return { status: 0, stderr: "" };
  };
  const session = host(workspace, home, run);

  await runSlashCommand("/plugin   install    mattpocock/skills    --scope   user", session);
  assert.equal(clones, 1);
  assert.match(session.lines.at(-1) ?? "", /已安装插件 mattpocock-skills（user），27 个技能。/);
  const installed = listPlugins({ home, workspace });
  assert.equal(installed.length, 1);
  assert.equal(installed[0]?.name, "mattpocock-skills");
  assert.equal(installed[0]?.scope, "user");
  assert.equal(installed[0]?.source, "mattpocock/skills");
  const manifest = readPluginManifest(installed[0]?.path ?? "");
  assert.equal(manifest.skills.length, 27);
  assert.equal(manifest.version, "1.3.1");
  assert.equal(manifest.author?.name, "Matt Pocock");
  assert.equal(manifest.license, "MIT");
  assert.deepEqual(manifest.keywords, ["engineering", "skills", "tdd"]);
  const skills = discoverSkills({ workspace, home }).filter((skill) => skill.plugin === "mattpocock-skills");
  assert.equal(skills.length, 27);
  assert.equal(skills.every((skill) => skill.id === `mattpocock-skills:${skill.name}`), true);
  assert.equal(skills.some((skill) => skill.name === "old-thing" || skill.name === "unlisted"), false);
  assert.equal(skills.some((skill) => skill.id === "mattpocock-skills:tdd"), true);
  await runSlashCommand("/plugin", session);
  assert.match(session.lines.at(-1) ?? "", /27 skills/);

  clones = 0;
  await runSlashCommand("/plugin mattpocock/skills", session);
  await runSlashCommand("/plugin update", session);
  assert.equal(clones, 0);
  assert.match(session.lines.at(-2) ?? "", /未知的插件命令/);
  assert.match(session.lines.at(-1) ?? "", /未知的插件命令/);
  assert.equal(listPlugins({ home, workspace }).length, 1);

  await runSlashCommand("/plugin install octo/", session);
  assert.match(session.lines.at(-1) ?? "", /owner\/repo/);
  await runSlashCommand("/plugin install https://github.com/octo/notes/tree/main", session);
  assert.match(session.lines.at(-1) ?? "", /不要带额外路径/);
  await runSlashCommand("/plugin install https://example.com/octo/notes", session);
  assert.match(session.lines.at(-1) ?? "", /GitHub/);
  assert.equal(parsePluginSource("https://github.com/octo/notes.git").kind, "git");
  assert.equal(parsePluginSource("git@github.com:octo/notes.git").source, "octo/notes");
  const scoped = parsePluginCommand("  install   octo/notes   --scope=project ");
  assert.equal(scoped.action, "install");
  if (scoped.action === "install") assert.equal(scoped.scope, "project");
  assert.throws(() => parsePluginCommand("install octo/notes --scope global"), /user 或 project/);

  await runSlashCommand("/plugin remove mattpocock/skills", session);
  assert.match(session.lines.at(-1) ?? "", /已移除插件 mattpocock-skills/);
  assert.equal(listPlugins({ home, workspace }).length, 0);
  assert.equal(existsSync(path.join(home, ".glue", "plugins", "skills")), false);
});

test("/plugin install --scope project, load --scope user, and remove by name or source", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const library = mkdtempSync(path.join(tmpdir(), "glue-lib-"));
  mkdirSync(path.join(library, ".glue-plugin"), { recursive: true });
  writeFileSync(path.join(library, ".glue-plugin", "plugin.json"), JSON.stringify({ name: "Pack", skills: ["./skills/review", "./skills/review"] }));
  const review = path.join(library, "skills", "review");
  mkdirSync(review, { recursive: true });
  writeFileSync(path.join(review, "SKILL.md"), "---\ndescription: Review a diff\n---\n\nReport bugs first.\n");
  const empty = path.join(library, "skills", "empty");
  mkdirSync(empty, { recursive: true });
  writeFileSync(path.join(empty, "SKILL.md"), "");

  const session = host(workspace, home, (_command, args) => {
    const dest = args[4] ?? "";
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, "SKILL.md"), "---\nname: notes\ndescription: Notes\n---\n\nKeep notes.\n");
    return { status: 0, stderr: "" };
  });

  await runSlashCommand("/plugin    load     " + library + "    --scope   user", session);
  assert.match(session.lines.at(-1) ?? "", /已加载插件 pack（user），1 个技能。/);
  assert.match(formatPluginList(listPlugins({ home, workspace })), /pack\s+user\s+1 skill/);
  assert.equal(existsSync(path.join(workspace, ".agent", "plugins.json")), false);

  await runSlashCommand("/plugin install octo/notes --scope project", session);
  assert.match(session.lines.at(-1) ?? "", /已安装插件 notes（project），1 个技能。/);
  const project = listPlugins({ home, workspace }).find((plugin) => plugin.name === "notes");
  assert.equal(project?.scope, "project");
  assert.match(project?.path ?? "", /\.agent[\\/]plugins[\\/]notes$/);
  const registry = JSON.parse(readFileSync(path.join(workspace, ".agent", "plugins.json"), "utf8")) as { plugins: Array<{ source: string }> };
  assert.equal(registry.plugins.some((plugin) => plugin.source === "octo/notes"), true);

  await runSlashCommand("/plugin remove octo/notes", session);
  assert.equal(existsSync(project?.path ?? ""), false);
  assert.equal(listPlugins({ home, workspace }).some((plugin) => plugin.name === "notes"), false);
  assert.equal(existsSync(path.join(library, "skills", "review", "SKILL.md")), true);
  await runSlashCommand("/plugin remove pack", session);
  assert.equal(listPlugins({ home, workspace }).length, 0);
});

test("a single-plugin marketplace.json installs that plugin, not the whole repository", () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const repo = mkdtempSync(path.join(tmpdir(), "glue-market-"));
  mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "demo", plugins: [{ name: "pack", source: "./pkg" }] }),
  );
  mkdirSync(path.join(repo, "pkg", ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(repo, "pkg", ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "pack", skills: ["./skills/alpha"] }),
  );
  mkdirSync(path.join(repo, "pkg", "skills", "alpha"), { recursive: true });
  writeFileSync(path.join(repo, "pkg", "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha\n---\n\nAlpha.\n");
  mkdirSync(path.join(repo, "skills", "decoy"), { recursive: true });
  writeFileSync(path.join(repo, "skills", "decoy", "SKILL.md"), "---\nname: decoy\ndescription: Decoy\n---\n\nDecoy.\n");

  const loaded = loadPlugin(repo, { workspace });
  assert.equal(loaded.name, "pack");
  assert.equal(loaded.path, path.resolve(repo, "pkg"));
  const loadedSkills = discoverSkills({ workspace, home }).map((skill) => skill.id);
  assert.deepEqual(loadedSkills, ["pack:alpha"]);

  const installed = installPlugin(repo, { home, workspace });
  assert.equal(installed.name, "pack");
  assert.equal(installed.scope, "user");
  assert.equal(existsSync(path.join(installed.path, "skills", "decoy", "SKILL.md")), false);
  assert.equal(discoverSkills({ workspace, home }).some((skill) => skill.name === "decoy"), false);
  removePlugin(repo, { home, workspace });
  assert.equal(existsSync(installed.path), false);
  assert.equal(existsSync(path.join(repo, "skills", "decoy", "SKILL.md")), true);
});

test("a marketplace with several plugins is not auto-installed", () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const repo = mkdtempSync(path.join(tmpdir(), "glue-multi-"));
  mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "multi",
      plugins: [
        { name: "one", source: "./one" },
        { name: "two", source: "./two" },
      ],
    }),
  );
  writeFileSync(path.join(repo, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "repo-root", description: "The clone itself" }));
  mkdirSync(path.join(repo, "skills", "root-skill"), { recursive: true });
  writeFileSync(path.join(repo, "skills", "root-skill", "SKILL.md"), "---\nname: root-skill\ndescription: Root\n---\n\nRoot.\n");
  const loaded = loadPlugin(repo, { workspace, home });
  assert.equal(loaded.name, "repo-root");
  assert.equal(loaded.path, path.resolve(repo));
  assert.deepEqual(discoverSkills({ workspace, home }).map((skill) => skill.id), ["repo-root:root-skill"]);
});

test("manifest paths that escape the plugin root are ignored", () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const library = mkdtempSync(path.join(tmpdir(), "glue-escape-"));
  const outside = mkdtempSync(path.join(tmpdir(), "glue-outside-"));
  mkdirSync(path.join(outside, "secret"), { recursive: true });
  writeFileSync(path.join(outside, "secret", "SKILL.md"), "---\nname: secret\ndescription: Secret\n---\n\nSecret.\n");
  mkdirSync(path.join(library, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(library, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "boxed",
      skills: ["../secret", "/etc/passwd", "skills/../../secret", "./skills/kept", path.join(outside, "secret")],
    }),
  );
  mkdirSync(path.join(library, "skills", "kept"), { recursive: true });
  writeFileSync(path.join(library, "skills", "kept", "SKILL.md"), "---\nname: kept\ndescription: Kept\n---\n\nKept.\n");
  mkdirSync(path.join(library, "skills", "linked"), { recursive: true });
  symlinkSync(path.join(outside, "secret"), path.join(library, "skills", "linked", "escape"), "dir");
  const linkedManifest = JSON.parse(readFileSync(path.join(library, ".claude-plugin", "plugin.json"), "utf8")) as { skills: string[] };
  linkedManifest.skills.push("./skills/linked/escape");
  writeFileSync(path.join(library, ".claude-plugin", "plugin.json"), JSON.stringify(linkedManifest));

  const loaded = loadPlugin(library, { workspace });
  assert.equal(loaded.name, "boxed");
  assert.deepEqual(discoverSkills({ workspace, home }).map((skill) => skill.id), ["boxed:kept"]);
});

test("a marketplace with several plugins asks for one, and plugin@marketplace installs it", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const outside = mkdtempSync(path.join(tmpdir(), "glue-secret-"));
  mkdirSync(path.join(outside, "secret"), { recursive: true });
  writeFileSync(path.join(outside, "secret", "SKILL.md"), "---\nname: secret\ndescription: Secret\n---\n\nSecret.\n");
  const repo = mkdtempSync(path.join(tmpdir(), "glue-multi-"));
  writeMultiMarket(repo, outside);

  const listed = readMarketplacePlugins(repo) ?? [];
  assert.deepEqual(listed.map((plugin) => plugin.name), ["one", "two"]);
  assert.deepEqual(listed.map((plugin) => plugin.relative), ["plugins/one", "plugins/two"]);

  assert.throws(
    () => installPlugin(repo, { home, workspace }),
    (error: unknown) => error instanceof MarketplaceChoiceNeeded && error.plugins.map((plugin) => plugin.name).join(",") === "one,two",
  );
  assert.equal(listPlugins({ home, workspace }).length, 0);

  const session = host(workspace, home, () => ({ status: 0, stderr: "" }));
  await runSlashCommand(`/plugin install ${repo}`, session);
  assert.match(session.lines.at(-1) ?? "", /多个插件/);
  assert.match(session.lines.at(-1) ?? "", /one/);
  assert.match(session.lines.at(-1) ?? "", /two/);
  assert.doesNotMatch(session.lines.at(-1) ?? "", /evil|secret|remote|link/);

  let choice: { source: string; scope: string; plugins: Array<{ name: string; description: string }> } | undefined;
  session.openPluginPicker = (next) => {
    choice = next;
  };
  await runSlashCommand(`/plugin install ${repo} --scope project`, session);
  assert.equal(choice?.source, repo);
  assert.equal(choice?.scope, "project");
  assert.deepEqual(choice?.plugins.map((plugin) => plugin.name), ["one", "two"]);
  assert.equal(choice?.plugins[0]?.description, "First");
  assert.equal(listPlugins({ home, workspace }).length, 0);

  const installed = installPlugin(`two@${repo}`, { home, workspace, scope: "project" });
  assert.equal(installed.name, "two");
  assert.equal(installed.scope, "project");
  assert.deepEqual(discoverSkills({ workspace, home }).map((skill) => skill.id), ["two:two"]);
  assert.equal(existsSync(path.join(installed.path, "skills", "two", "SKILL.md")), true);
  assert.equal(existsSync(path.join(installed.path, "secret", "SKILL.md")), false);

  let clones = 0;
  const git = host(workspace, home, (_command, args) => {
    clones += 1;
    assert.equal(args[0], "clone");
    assert.equal(args[3], "https://github.com/octo/market.git");
    writeMultiMarket(args[4] ?? "", outside);
    return { status: 0, stderr: "" };
  });
  let gitChoice: { source: string; scope: string; plugins: Array<{ name: string }> } | undefined;
  git.openPluginPicker = (next) => {
    gitChoice = next;
  };
  await runSlashCommand("/plugin install octo/market --scope project", git);
  assert.equal(clones, 1);
  assert.equal(gitChoice?.source, "octo/market");
  assert.equal(gitChoice?.scope, "project");
  assert.deepEqual(gitChoice?.plugins.map((plugin) => plugin.name), ["one", "two"]);
  await runSlashCommand("/plugin install missing@octo/market --scope project", git);
  assert.match(git.lines.at(-1) ?? "", /没有插件 missing/);
  await runSlashCommand("/plugin install one@octo/market --scope project", git);
  assert.equal(clones, 3);
  const fromGit = listPlugins({ home, workspace }).find((plugin) => plugin.source === "octo/market");
  assert.equal(fromGit?.name, "one");
  assert.equal(fromGit?.scope, "project");
  assert.equal(discoverSkills({ workspace, home }).some((skill) => skill.id === "one:one"), true);
  assert.equal(discoverSkills({ workspace, home }).some((skill) => skill.name === "secret"), false);
});

test("a relative marketplace source without a dot-slash installs that plugin", () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const repo = mkdtempSync(path.join(tmpdir(), "glue-rel-"));
  mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ name: "demo", plugins: [{ name: "pack", source: "pkg", description: "Pack" }] }),
  );
  mkdirSync(path.join(repo, "pkg", ".claude-plugin"), { recursive: true });
  writeFileSync(path.join(repo, "pkg", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "pack" }));
  mkdirSync(path.join(repo, "pkg", "skills", "alpha"), { recursive: true });
  writeFileSync(path.join(repo, "pkg", "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha\n---\n\nAlpha.\n");
  mkdirSync(path.join(repo, "skills", "decoy"), { recursive: true });
  writeFileSync(path.join(repo, "skills", "decoy", "SKILL.md"), "---\nname: decoy\ndescription: Decoy\n---\n\nDecoy.\n");
  const installed = installPlugin(repo, { home, workspace });
  assert.equal(installed.name, "pack");
  assert.equal(discoverSkills({ workspace, home }).some((skill) => skill.name === "decoy"), false);
  assert.equal(discoverSkills({ workspace, home }).some((skill) => skill.id === "pack:alpha"), true);
});

function writeMultiMarket(repo: string, outside: string): void {
  mkdirSync(path.join(repo, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(repo, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "multi",
      plugins: [
        { name: "one", source: "./plugins/one", description: "First" },
        { name: "Two", source: { path: "plugins/two" }, description: "Second" },
        { name: "evil", source: "../secret" },
        { name: "abs", source: outside },
        { name: "dotdot", source: "plugins/../../secret" },
        { name: "remote", source: { source: "github", repo: "octo/remote" } },
        { name: "link", source: "./plugins/link" },
      ],
    }),
  );
  writeMarketPlugin(path.join(repo, "plugins", "one"), "one");
  writeMarketPlugin(path.join(repo, "plugins", "two"), "two");
  mkdirSync(path.join(repo, "plugins"), { recursive: true });
  try {
    symlinkSync(outside, path.join(repo, "plugins", "link"), "dir");
  } catch {
    /* a second clone of the same fixture may already have the link */
  }
}

function writeMarketPlugin(root: string, name: string): void {
  mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name }));
  mkdirSync(path.join(root, "skills", name), { recursive: true });
  writeFileSync(path.join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n\n${name} body.\n`);
}

function host(workspace: string, home: string, pluginRun: PluginRunner): CommandHost & { lines: string[] } {
  const lines: string[] = [];
  const config = loadConfig({ cwd: workspace, env: {}, home });
  const value: CommandHost & { lines: string[] } = {
    workspace,
    home,
    config,
    model: config.model,
    permissionMode: "default",
    profile: "default",
    themeName: "dark",
    editor: "normal",
    outputStyle: "normal",
    shellEnabled: false,
    usage: { input: 0, output: 0 },
    contextWindow: 128000,
    sessionName: "",
    sessionId: "test",
    rules: emptyRules(),
    tasks: [],
    lines,
    pluginRun,
    push(text) {
      lines.push(text);
    },
    setModel() {},
    setMode() {},
    setProfile() {},
    setTheme() {},
    setAccent() {},
    setEditor() {},
    setOutputStyle() {},
    setShell() {},
    setSessionName() {},
    addRule() {},
    clear() {},
    exit() {},
    async runTurn() {},
    async compact() {},
    async btw() {},
    async recap() {},
    async resume() {},
    rewind() {},
    branch() {},
    addDir() {},
    cd() {},
    killTask() {},
    copyLast() {},
    exportSession() {},
    showMemory() {},
    showDiff() {},
  };
  return value;
}
