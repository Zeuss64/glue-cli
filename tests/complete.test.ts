import assert from "node:assert/strict";
import test from "node:test";
import { completionSpec, filterSkillArgs, filterSlashEntries, resolveSubmittedSlash } from "../src/commands.js";
import type { Skill } from "../src/skills.js";
import { cyclePluginRemove, cycleSkillArg, cycleSlash, slashTabIndex } from "../src/tui/complete.js";

function skill(partial: Pick<Skill, "id" | "name" | "description" | "source"> & Partial<Skill>): Skill {
  return {
    body: "body",
    path: "SKILL.md",
    userInvocable: true,
    disableModelInvocation: false,
    argumentHint: "",
    ...partial,
  };
}

test("/td Tab completes the skill, and a command wins a shared name", () => {
  const tdd = skill({
    id: "mattpocock-skills:tdd",
    name: "tdd",
    description: "Test driven",
    source: "plugin",
    plugin: "mattpocock-skills",
  });
  const hit = cycleSlash("td", 0, [tdd]);
  assert.equal(hit?.text, "/tdd ");
  assert.equal(hit?.ambiguous, false);
  assert.equal(resolveSubmittedSlash("/td", 0, [tdd]), "/tdd");

  const review = skill({
    id: "pack:review",
    name: "review",
    description: "Plugin review",
    source: "plugin",
    plugin: "pack",
    argumentHint: "<diff>",
  });
  const collided = filterSlashEntries("review", [review]);
  assert.deepEqual(
    collided.map((entry) => `${entry.kind}:${entry.name}`),
    ["command:review"],
  );
  assert.equal(cycleSlash("review", 0, [review])?.text, "/review ");
  assert.equal(resolveSubmittedSlash("/review", 1, [review]), "/review");
  const byId = filterSlashEntries("pack:re", [review]);
  assert.equal(byId[0]?.name, "pack:review");
  assert.equal(byId[0]?.kind, "skill");
  assert.equal(byId[0]?.summary, "(plugin:pack) Plugin review <diff>");
  const menu = filterSlashEntries("", [review, tdd]);
  assert.equal(menu.some((entry) => entry.kind === "skill" && entry.name === "review"), false);
  assert.equal(menu.some((entry) => entry.name === "pack:review"), true);
  assert.equal(menu.some((entry) => entry.kind === "skill" && entry.name === "tdd"), true);

  const hidden = skill({ id: "secret", name: "secret", description: "nope", source: "personal", userInvocable: false });
  assert.equal(filterSlashEntries("se", [hidden]).some((entry) => entry.kind === "skill"), false);
  assert.equal(filterSlashEntries("", [hidden]).some((entry) => entry.name === "secret"), false);
});

test("/skill gr Tab cycles, and the highlight stays on the row Tab will fill", () => {
  const skills = [
    skill({ id: "grill-me", name: "grill-me", description: "Grill", source: "project" }),
    skill({ id: "grep", name: "grep", description: "Search", source: "personal" }),
    skill({ id: "other", name: "other", description: "Nope", source: "personal" }),
  ];
  const first = cycleSkillArg("gr", 0, skills);
  const second = cycleSkillArg("gr", 1, skills);
  const wrapped = cycleSkillArg("gr", 2, skills);
  assert.equal(first?.ambiguous, true);
  assert.notEqual(first?.text, second?.text);
  assert.match(first?.text ?? "", /^\/skill /);
  assert.match(second?.text ?? "", /^\/skill /);
  assert.equal(wrapped?.text, first?.text);
  const listed = filterSkillArgs("gr", skills);
  assert.deepEqual(
    listed.map((entry) => entry.name),
    ["grill-me", "grep"],
  );
  const selected = listed.findIndex((entry) => entry.name === "grep");
  assert.ok(selected > 0);
  const accepted = cycleSkillArg("gr", slashTabIndex({ cycling: false, cycleIndex: 0, selectedIndex: selected }), skills);
  assert.equal(accepted?.index, selected);
  assert.equal(accepted?.names[accepted.index], "grep");
  assert.equal(accepted?.text, "/skill grep");
  assert.equal(resolveSubmittedSlash("/skill gr", selected, skills), "/skill grep");

  const slashSkills = [
    skill({ id: "tdd", name: "tdd", description: "A", source: "personal" }),
    skill({ id: "tdd-extra", name: "tdd-extra", description: "B", source: "project" }),
  ];
  const slashListed = filterSlashEntries("td", slashSkills);
  const slashSelected = slashListed.findIndex((entry) => entry.name === "tdd-extra");
  assert.ok(slashSelected > 0);
  const slashTab = cycleSlash("td", slashTabIndex({ cycling: false, cycleIndex: 0, selectedIndex: slashSelected }), slashSkills);
  assert.equal(slashTab?.index, slashSelected);
  assert.equal(slashTab?.names[slashTab.index], slashListed[slashSelected]?.name);
  assert.equal(slashTab?.text, `/${slashListed[slashSelected]?.name}`);
});

test("/skill and /plugin remove only complete after the separating space", () => {
  assert.equal(completionSpec("/skill")?.kind, "slash");
  assert.equal(completionSpec("/skill ")?.kind, "skill");
  assert.equal(completionSpec("/skill ")?.query, "");
  assert.equal(completionSpec("/skills gr")?.kind, "skill");
  assert.equal(completionSpec("/skill gr extra"), null);
  assert.equal(completionSpec("/plugin remove"), null);
  assert.equal(completionSpec("/plugin remove ")?.kind, "plugin-remove");
  assert.equal(completionSpec("/plugin rm pa")?.query, "pa");
  const plugins = [
    { name: "pack", scope: "project", source: "/tmp/pack" },
    { name: "notes", scope: "user", source: "octo/notes" },
  ];
  assert.equal(cyclePluginRemove("pa", 0, plugins)?.text, "/plugin remove pack ");
  assert.equal(cyclePluginRemove("", 1, plugins)?.ambiguous, true);
  assert.equal(resolveSubmittedSlash("/plugin remove pa", 0, [], plugins), "/plugin remove pack");
});
