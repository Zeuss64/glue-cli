import { filterCommands } from "../commands.js";
import { displayWidth, graphemes } from "./text.js";

export interface SlashCycle {
  /** Query the user had typed before Tab started cycling. */
  prefix: string;
  index: number;
  lastName: string;
}

/**
 * Prefix-complete a slash command.
 * One match accepts it (trailing space). Several matches cycle, and the slash
 * menu highlights the same row. The original prefix is kept so the second Tab
 * does not treat the filled-in name as a new unique query.
 */
export function cycleSlash(prefix: string, index: number): {
  text: string;
  index: number;
  names: string[];
  ambiguous: boolean;
} | null {
  const matches = filterCommands(prefix);
  if (!matches.length) return null;
  const count = matches.length;
  const wrapped = ((index % count) + count) % count;
  const chosen = matches[wrapped];
  if (!chosen) return null;
  const ambiguous = count > 1;
  return {
    text: ambiguous ? `/${chosen.name}` : `/${chosen.name} `,
    index: wrapped,
    names: matches.map((command) => command.name),
    ambiguous,
  };
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

function fitWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  const budget = Math.max(1, width - 1);
  let out = "";
  let used = 0;
  for (const part of graphemes(text)) {
    const size = displayWidth(part.segment);
    if (used + size > budget) break;
    out += part.segment;
    used += size;
  }
  return `${out}…`;
}
