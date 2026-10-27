import { filterCommands } from "../commands.js";

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
