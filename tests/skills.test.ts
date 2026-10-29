import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { filterSlashEntries, helpText, isImmediateCommand, runSlashCommand, type CommandHost } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { emptyRules } from "../src/permissions.js";
import { installPlugin, loadPlugin, parsePluginSource } from "../src/plugins.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { discoverSkills, formatSkillList, parseSkillMarkdown, resolveSkill, skillCatalogEntries, skillsFromPlugin, type ActiveSkill, type Skill } from "../src/skills.js";
import { displayWidth } from "../src/tui/text.js";
import { MATTPOCOCK_SKILLS, writeMattPocockPlugin } from "./mattpocock-fixture.js";

type SkillHost = CommandHost & { lines: string[]; activeSkill: ActiveSkill | null };

function activeSkillId(session: { activeSkill?: ActiveSkill | null }): string | undefined {
  return session.activeSkill?.id;
}

function writeSkill(dir: string, name: string, body: string): void {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "SKILL.md"), body);
}

test("SKILL.md frontmatter becomes a skill, and a project skill overrides a personal one", () => {
  const parsed = parseSkillMarkdown(
    "---\nname: Ship\ndescription: Prepare a small release note\n---\n\nWrite a short release note.\n",
    "ignored",
  );
  assert.equal(parsed?.name, "ship");
  assert.equal(parsed?.userInvocable, true);
  assert.equal(parsed?.disableModelInvocation, false);
  assert.equal(parsed?.argumentHint, "");
  assert.match(parsed?.description ?? "", /release note/);
  assert.match(parsed?.body ?? "", /Write a short release note/);

  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  writeSkill(path.join(home, ".glue", "skills"), "ship", "---\ndescription: personal\n---\n\nPersonal body.\n");
  writeSkill(path.join(workspace, ".glue", "skills"), "ship", "---\ndescription: project\n---\n\nProject body.\n");
  writeSkill(path.join(workspace, ".agent", "skills"), "lint", "Check the diff before answering.\n");
  const skills = discoverSkills({ workspace, home });
  const ship = resolveSkill(skills, "ship");
  assert.ok(ship && ship !== "ambiguous");
  assert.equal(ship.source, "project");
  assert.match(ship.body, /Project body/);
  const lint = resolveSkill(skills, "lint");
  assert.ok(lint && lint !== "ambiguous");
  assert.equal(lint.description.length > 0, true);
});

test("/skill loads a skill and /plugin load and install persist the library", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const library = mkdtempSync(path.join(tmpdir(), "glue-lib-"));
  mkdirSync(path.join(library, ".glue-plugin"), { recursive: true });
  writeFileSync(path.join(library, ".glue-plugin", "plugin.json"), JSON.stringify({ name: "Pack", description: "Review helpers" }));
  writeSkill(path.join(library, "skills"), "review", "---\ndescription: Review a diff\n---\n\nReport bugs first.\n");
  const loaded = loadPlugin(library, { workspace });
  assert.equal(loaded.name, "pack");
  assert.equal(loaded.scope, "project");
  const fromDisk = discoverSkills({ workspace, home });
  const review = resolveSkill(fromDisk, "pack:review");
  assert.ok(review && review !== "ambiguous");
  assert.equal(resolveSkill(fromDisk, "review") && resolveSkill(fromDisk, "review") !== "ambiguous", true);

  const turns: string[] = [];
  const session = host(workspace, home, turns);
  assert.match(helpText(), /\/skill\s+/);
  assert.match(helpText(), /\/plugin\s+/);
  assert.doesNotMatch(helpText(), /Unavailable here:.*\/plugin/);
  assert.equal(isImmediateCommand("/plugin"), true);
  await runSlashCommand("/skill", session);
  assert.match(session.lines.at(-1) ?? "", /pack:review/);
  await runSlashCommand("/skill review look at the diff", session);
  assert.equal(activeSkillId(session), "pack:review");
  assert.equal(turns.at(-1), "look at the diff");
  assert.match(session.lines.at(-1) ?? "", /已加载技能 pack:review/);
  await runSlashCommand("/skill review", session);
  assert.equal(turns.at(-1), 'Follow the active skill "pack:review".');
  const prompt = buildSystemPrompt({
    workspace,
    profile: "default",
    permissionMode: "default",
    shellEnabled: false,
    outputStyle: "normal",
    skillCatalog: [{ id: "pack:review", description: "Review a diff" }],
    activeSkill: { id: "pack:review", body: "Report bugs first." },
  });
  assert.match(prompt, /Active skill: pack:review/);
  assert.match(prompt, /Report bugs first/);
  const beforeReview = turns.length;
  await runSlashCommand("/review", session);
  assert.match(turns.at(-1) ?? "", /Review the current git diff/);
  assert.equal(turns.length, beforeReview + 1);
  assert.equal(activeSkillId(session), "pack:review");
  await runSlashCommand("/skill clear", session);
  assert.equal(session.activeSkill === null, true);

  const installed = installPlugin("octo/notes", {
    home,
    workspace,
    run(_command, args) {
      assert.equal(args[0], "clone");
      assert.equal(args[3], "https://github.com/octo/notes.git");
      const dest = args[4] ?? "";
      mkdirSync(dest, { recursive: true });
      writeSkill(path.join(dest, "skills"), "notes", "---\ndescription: Notes\n---\n\nKeep notes.\n");
      return { status: 0, stderr: "" };
    },
  });
  assert.equal(installed.name, "notes");
  assert.match(installed.path, /\.glue[\\/]plugins[\\/]notes$/);
  const after = discoverSkills({ workspace, home });
  assert.ok(after.some((skill) => skill.id === "notes:notes"));
  await runSlashCommand("/notes keep this", session);
  assert.equal(activeSkillId(session), "notes:notes");
  assert.equal(turns.at(-1), "keep this");
  await runSlashCommand("/plugin", session);
  assert.match(session.lines.at(-1) ?? "", /notes/);
  assert.match(session.lines.at(-1) ?? "", /pack/);
  await runSlashCommand("/plugin remove pack", session);
  assert.equal(discoverSkills({ workspace, home }).some((skill) => skill.id === "pack:review"), false);
  assert.equal(existsSync(path.join(library, "skills", "review", "SKILL.md")), true);
  await runSlashCommand("/plugin remove notes", session);
  assert.equal(existsSync(installed.path), false);
  assert.equal(parsePluginSource("https://github.com/octo/notes").kind, "git");
  assert.throws(() => parsePluginSource("https://example.com/octo/notes"), /GitHub/);
});

test("a mattpocock-like plugin exposes the 27 manifest skills, not nested extras", () => {
  assert.equal(MATTPOCOCK_SKILLS.length, 27);
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const library = mkdtempSync(path.join(tmpdir(), "glue-matt-"));
  writeMattPocockPlugin(library);
  const loaded = loadPlugin(library, { workspace });
  assert.equal(loaded.name, "mattpocock-skills");
  const skills = discoverSkills({ workspace, home });
  assert.equal(skills.length, 27);
  assert.equal(skills.every((skill) => skill.source === "plugin" && skill.id.startsWith("mattpocock-skills:")), true);
  assert.equal(skills.some((skill) => skill.name === "old-thing" || skill.name === "unlisted"), false);
  assert.equal(skillsFromPlugin(loaded).length, 27);
  const tdd = resolveSkill(skills, "mattpocock-skills:tdd");
  assert.ok(tdd && tdd !== "ambiguous");
  assert.equal(tdd.name, "tdd");
  assert.match(tdd.body, /Use tdd/);
});

test("nested plugin skills are found by a depth-3 fallback when the manifest lists no paths", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const library = mkdtempSync(path.join(tmpdir(), "glue-nested-"));
  mkdirSync(path.join(library, ".claude-plugin"), { recursive: true });
  writeFileSync(path.join(library, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "nested", description: "Buckets" }));
  writeNested(library, ["a", "b", "c"], "deep");
  writeNested(library, ["w", "x", "y", "z"], "too-deep");
  writeNested(library, ["productivity", "grill-me"], "grill-me");
  writeNested(library, ["flat"], "flat");
  const loaded = loadPlugin(library, { workspace });
  const ids = skillsFromPlugin(loaded).map((skill) => skill.id).sort();
  assert.deepEqual(ids, ["nested:deep", "nested:flat", "nested:grill-me"]);
});

test("a manifest skill path may be one directory or a SKILL.md file", () => {
  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  const library = mkdtempSync(path.join(tmpdir(), "glue-paths-"));
  mkdirSync(path.join(library, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(library, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "paths", skills: "./extra/only" }),
  );
  mkdirSync(path.join(library, "extra", "only"), { recursive: true });
  writeFileSync(path.join(library, "extra", "only", "SKILL.md"), "---\nname: only\ndescription: Only\n---\n\nOnly.\n");
  const filePlugin = mkdtempSync(path.join(tmpdir(), "glue-file-"));
  mkdirSync(path.join(filePlugin, ".claude-plugin"), { recursive: true });
  writeFileSync(path.join(filePlugin, "SKILL.md"), "---\nname: file\ndescription: File\n---\n\nFile body.\n");
  writeFileSync(path.join(filePlugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "fileplug", skills: ["./SKILL.md"] }));
  loadPlugin(library, { workspace });
  loadPlugin(filePlugin, { workspace });
  const ids = discoverSkills({ workspace, home }).map((skill) => skill.id).sort();
  assert.deepEqual(ids, ["fileplug:file", "paths:only"]);
});

test("user-invocable hides a skill from the slash menu and disable-model-invocation drops it from the prompt catalog", async () => {
  const parsed = parseSkillMarkdown(
    '---\nname: Hidden\ndescription: "line one\\nstill one value"\nuser-invocable: false\ndisable-model-invocation: "true"\nargument-hint: "[file]"\n---\n\nHidden body.\n',
    "ignored",
  );
  assert.equal(parsed?.name, "hidden");
  assert.equal(parsed?.userInvocable, false);
  assert.equal(parsed?.disableModelInvocation, true);
  assert.equal(parsed?.argumentHint, "[file]");

  const home = mkdtempSync(path.join(tmpdir(), "glue-home-"));
  const workspace = mkdtempSync(path.join(tmpdir(), "glue-work-"));
  writeSkill(path.join(workspace, ".glue", "skills"), "hidden", "---\nname: hidden\ndescription: model only\nuser-invocable: false\n---\n\nHidden body.\n");
  writeSkill(
    path.join(workspace, ".glue", "skills"),
    "quiet",
    "---\nname: quiet\ndescription: user types it\ndisable-model-invocation: true\nargument-hint: <path>\n---\n\nQuiet body.\n",
  );
  writeSkill(path.join(workspace, ".glue", "skills"), "shown", "---\ndescription: shown skill\n---\n\nShown body.\n");
  const skills = discoverSkills({ workspace, home });
  const hidden = resolveSkill(skills, "hidden");
  assert.ok(hidden && hidden !== "ambiguous");
  assert.equal(hidden.userInvocable, false);
  const quiet = resolveSkill(skills, "quiet");
  assert.ok(quiet && quiet !== "ambiguous");
  assert.equal(quiet.disableModelInvocation, true);
  assert.equal(quiet.argumentHint, "<path>");
  const catalog = skillCatalogEntries(skills).map((entry) => entry.id);
  assert.equal(catalog.includes("quiet"), false);
  assert.equal(catalog.includes("hidden"), true);
  assert.equal(catalog.includes("shown"), true);
  const menu = filterSlashEntries("", skills);
  assert.equal(menu.some((entry) => entry.kind === "skill" && entry.name === "hidden"), false);
  const quietRow = menu.find((entry) => entry.name === "quiet");
  assert.ok(quietRow);
  assert.match(quietRow.summary, /<path>$/);

  const turns: string[] = [];
  const session = host(workspace, home, turns);
  await runSlashCommand("/hidden", session);
  assert.match(session.lines.at(-1) ?? "", /Unknown command/);
  await runSlashCommand("/skill hidden go", session);
  assert.equal(activeSkillId(session), "hidden");
  assert.equal(turns.at(-1), "go");
  let opened = 0;
  session.openSkillPicker = () => {
    opened += 1;
  };
  const before = session.lines.length;
  await runSlashCommand("/skill", session);
  assert.equal(opened, 1);
  assert.equal(session.lines.length, before);
});

test("formatSkillList collapses a description to one line and truncates by display width", () => {
  const wide: Skill = {
    id: "wide",
    name: "wide",
    description: `alpha\nbeta ${"查".repeat(40)}END`,
    body: "body",
    source: "personal",
    path: "SKILL.md",
    userInvocable: true,
    disableModelInvocation: false,
    argumentHint: "",
  };
  const text = formatSkillList([wide], 48);
  const line = text.split("\n").find((item) => item.includes("wide")) ?? "";
  assert.equal(line.includes("\n"), false);
  assert.match(line, /alpha beta/);
  assert.match(line, /personal/);
  assert.match(line, /…/);
  assert.doesNotMatch(line, /END/);
  assert.ok(displayWidth(line) <= 48);
});

function writeNested(root: string, parts: string[], name: string): void {
  const dir = path.join(root, "skills", ...parts);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n\n${name} body.\n`);
}

function host(workspace: string, home: string, turns: string[]): SkillHost {
  const lines: string[] = [];
  const config = loadConfig({ cwd: workspace, env: {}, home });
  const value: SkillHost = {
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
    activeSkill: null,
    push(text) {
      lines.push(text);
    },
    setActiveSkill(skill) {
      value.activeSkill = skill;
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
    async runTurn(text) {
      turns.push(text);
    },
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
