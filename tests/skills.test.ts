import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { helpText, isImmediateCommand, runSlashCommand, type CommandHost } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { emptyRules } from "../src/permissions.js";
import { installPlugin, loadPlugin, parsePluginSource } from "../src/plugins.js";
import { buildSystemPrompt } from "../src/prompt.js";
import { discoverSkills, parseSkillMarkdown, resolveSkill, type ActiveSkill } from "../src/skills.js";

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
