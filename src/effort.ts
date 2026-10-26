/** Session effort. `auto` means the provider default and is omitted from the request. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type NamedEffort = (typeof EFFORT_LEVELS)[number];
export type EffortLevel = NamedEffort | "auto";

/** Left/right order in the model picker, and the order `/effort` accepts. */
export const EFFORT_CYCLE: readonly EffortLevel[] = ["auto", ...EFFORT_LEVELS];

export function normalizeEffort(value: string | undefined | null): EffortLevel | undefined {
  if (!value?.trim()) return undefined;
  const name = value.trim().toLowerCase();
  if (name === "auto" || name === "default") return "auto";
  if ((EFFORT_LEVELS as readonly string[]).includes(name)) return name as NamedEffort;
  return undefined;
}

export function cycleEffort(current: EffortLevel, direction: -1 | 1): EffortLevel {
  const index = Math.max(0, EFFORT_CYCLE.indexOf(current));
  const next = (index + direction + EFFORT_CYCLE.length) % EFFORT_CYCLE.length;
  return EFFORT_CYCLE[next] ?? "auto";
}

/** Anthropic Messages `output_config`. Absent when effort is auto or unset. */
export function anthropicOutputConfig(level: string | undefined | null): { effort: NamedEffort } | undefined {
  const effort = normalizeEffort(level);
  if (!effort || effort === "auto") return undefined;
  return { effort };
}
