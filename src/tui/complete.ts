import { filterPluginNames, filterSkillArgs, filterSlashEntries } from "../commands.js";
import type { Skill } from "../skills.js";
import { displayWidth, fitWidth } from "./text.js";

export { fitWidth };

export interface SlashCycle {
  kind: "slash" | "skill" | "plugin-remove";
  /** Query the user had typed before Tab started cycling. */
  prefix: string;
  index: number;
  lastName: string;
  /** Exact prompt text last written by Tab. */
  lastText: string;
}

export interface SlashFill {
  text: string;
  index: number;
  names: string[];
  ambiguous: boolean;
}

/**
 * Which match Tab should fill.
 * Arrow movement owns the highlight: Tab accepts that row, not the shortest prefix.
 * Repeated Tab with no new arrow movement still cycles from the last accepted row.
 */
export function slashTabIndex(opts: { cycling: boolean; cycleIndex: number; selectedIndex: number }): number {
  if (opts.cycling) return opts.cycleIndex;
  if (!Number.isFinite(opts.selectedIndex)) return 0;
  return Math.floor(opts.selectedIndex);
}

/**
 * Prefix-complete a slash command.
 * One match accepts it (trailing space). Several matches cycle, and the slash
 * menu highlights the same row. The original prefix is kept so the second Tab
 * does not treat the filled-in name as a new unique query.
 */
export function cycleSlash(prefix: string, index: number, skills: readonly Skill[] = []): SlashFill | null {
  return cycleEntries(filterSlashEntries(prefix, skills), index, (name, ambiguous) => (ambiguous ? `/${name}` : `/${name} `));
}

/** Tab after `/skill ` fills `/skill <id>` and cycles when several ids match. */
export function cycleSkillArg(prefix: string, index: number, skills: readonly Skill[]): SlashFill | null {
  return cycleEntries(filterSkillArgs(prefix, skills), index, (name, ambiguous) => (ambiguous ? `/skill ${name}` : `/skill ${name} `));
}

/** Tab after `/plugin remove ` fills an installed plugin name. */
export function cyclePluginRemove(prefix: string, index: number, plugins: readonly { name: string }[]): SlashFill | null {
  return cycleEntries(filterPluginNames(prefix, plugins), index, (name, ambiguous) => (ambiguous ? `/plugin remove ${name}` : `/plugin remove ${name} `));
}

export function cycleEntries(
  matches: readonly { name: string }[],
  index: number,
  fill: (name: string, ambiguous: boolean) => string,
): SlashFill | null {
  if (!matches.length) return null;
  const count = matches.length;
  const wrapped = ((index % count) + count) % count;
  const chosen = matches[wrapped];
  if (!chosen) return null;
  const ambiguous = count > 1;
  return {
    text: fill(chosen.name, ambiguous),
    index: wrapped,
    names: matches.map((item) => item.name),
    ambiguous,
  };
}

/** Window a menu the way the slash list does: keep the highlight in view, at most `size` rows. */
export function visibleSlash<T>(rows: T[], index: number, size = 6): { rows: T[]; selected: number } {
  if (!rows.length) return { rows: [], selected: 0 };
  const clamped = Math.max(0, Math.min(index, rows.length - 1));
  const start = Math.max(0, Math.min(Math.max(0, clamped - 1), Math.max(0, rows.length - size)));
  return { rows: rows.slice(start, start + size), selected: clamped - start };
}

/** Selected rows use one tone for the command and the whole description. */
export function slashRowTone(selected: boolean): "accent" | "muted" {
  return selected ? "accent" : "muted";
}

/**
 * Lay out one suggestion without breaking a word.
 * A wide terminal keeps `command + description` on one line. A narrow one
 * puts the description underneath, still in the same tone, and only splits
 * on spaces. Ink's hard wrap would otherwise cut "statusline" mid-word and
 * the color change would read as "statusge".
 */
export function slashRowLines(selected: boolean, name: string, summary: string, columns: number): string[] {
  const width = Math.max(4, columns);
  const marker = selected ? "❯ " : "  ";
  const padded = `${marker}/${name.padEnd(16)}${summary}`;
  if (displayWidth(padded) <= width) return [padded];
  const command = fitWidth(`${marker}/${name}`, width);
  return [command, ...wrapWords(summary, width)];
}

function wrapWords(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const piece = displayWidth(word) > width ? fitWidth(word, width) : word;
    const next = current ? `${current} ${piece}` : piece;
    if (current && displayWidth(next) > width) {
      lines.push(current);
      current = piece;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

