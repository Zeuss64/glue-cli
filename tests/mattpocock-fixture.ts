import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Promoted skill directories from mattpocock/skills `.claude-plugin/plugin.json` (27). */
export const MATTPOCOCK_SKILLS = [
  "skills/engineering/ask-matt",
  "skills/engineering/diagnosing-bugs",
  "skills/engineering/grill-with-docs",
  "skills/engineering/triage",
  "skills/engineering/improve-codebase-architecture",
  "skills/engineering/setup-matt-pocock-skills",
  "skills/engineering/tdd",
  "skills/engineering/to-spec",
  "skills/engineering/to-tickets",
  "skills/engineering/wayfinder",
  "skills/engineering/implement",
  "skills/engineering/implement-spec",
  "skills/engineering/prototype",
  "skills/engineering/research",
  "skills/engineering/domain-modeling",
  "skills/engineering/codebase-design",
  "skills/engineering/code-review",
  "skills/engineering/pr",
  "skills/engineering/retro",
  "skills/engineering/wizard",
  "skills/productivity/grill-me",
  "skills/productivity/grilling",
  "skills/productivity/handoff",
  "skills/productivity/teach",
  "skills/productivity/to-questionnaire",
  "skills/productivity/wait-what",
  "skills/productivity/writing-for-agents",
] as const;

export function writeMattPocockPlugin(root: string): void {
  mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "mattpocock-skills",
        version: "1.3.1",
        description: "Matt Pocock's agent skills for real engineering.",
        author: { name: "Matt Pocock", url: "https://www.aihero.dev" },
        homepage: "https://www.aihero.dev/s/skills-newsletter",
        repository: "https://github.com/mattpocock/skills",
        license: "MIT",
        keywords: ["engineering", "skills", "tdd"],
        skills: MATTPOCOCK_SKILLS.map((rel) => `./${rel}`),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify(
      {
        name: "mattpocock",
        plugins: [{ name: "mattpocock-skills", source: "./", description: "Promoted skills." }],
      },
      null,
      2,
    ),
  );
  for (const rel of MATTPOCOCK_SKILLS) writeSkill(root, rel, path.basename(rel));
  writeSkill(root, "skills/deprecated/old-thing", "old-thing");
  writeSkill(root, "skills/engineering/unlisted", "unlisted");
}

function writeSkill(root: string, rel: string, name: string): void {
  const dir = path.join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n\nUse ${name}.\n`);
}
