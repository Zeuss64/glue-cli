/** Session effort. `auto` means the provider default and is omitted from the request. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type NamedEffort = (typeof EFFORT_LEVELS)[number];
export type EffortLevel = NamedEffort | "auto";

/**
 * UltraCode is not an API effort value. It pins the request to `max` and
 * allows the session to dispatch subagents.
 */
export const ULTRACODE = "ultracode" as const;
export type EffortChoice = EffortLevel | typeof ULTRACODE;

/** Left/right order in the model picker. UltraCode stays on the `/effort` slider. */
export const EFFORT_CYCLE: readonly EffortLevel[] = ["auto", ...EFFORT_LEVELS];

export interface EffortSelection {
  /** Value sent as Anthropic `output_config.effort`. `auto` omits it. */
  effort: EffortLevel;
  /** When true, the session may spawn subagents and the API effort is `max`. */
  ultracode: boolean;
}

export function normalizeEffort(value: string | undefined | null): EffortLevel | undefined {
  if (!value?.trim()) return undefined;
  const name = value.trim().toLowerCase();
  if (name === "auto" || name === "default") return "auto";
  if ((EFFORT_LEVELS as readonly string[]).includes(name)) return name as NamedEffort;
  return undefined;
}

export function isUltracodeToken(value: string | undefined | null): boolean {
  return value?.trim().toLowerCase() === ULTRACODE;
}

/** Picker stop or `/effort ultracode` → API `max` plus subagent dispatch. */
export function applyEffortChoice(choice: EffortChoice): EffortSelection {
  if (choice === ULTRACODE) return { effort: "max", ultracode: true };
  return { effort: choice, ultracode: false };
}

export function effortStatusLabel(effort: EffortLevel | undefined, ultracode?: boolean): string {
  if (ultracode) return "ultracode · max + subagents";
  return effort ?? "auto";
}

export function effortSetMessage(selection: EffortSelection): string {
  if (selection.ultracode) return "UltraCode on · max thinking + subagents.";
  if (selection.effort === "auto") return "Effort reset to auto (model default).";
  return `Effort set to ${selection.effort}.`;
}

/** One line under the slider for the highlighted stop. */
export function effortBlurb(choice: string | undefined): string {
  switch (choice) {
    case "low":
      return "Faster. Least thinking, for small edits.";
    case "medium":
      return "Balanced thinking and token use.";
    case "high":
      return "Deeper thinking for hard coding tasks.";
    case "xhigh":
      return "Long-horizon work. More thinking and tool use.";
    case "max":
      return "Top-tier thinking. No token cap.";
    case "ultracode":
      return "UltraCode · max thinking + subagent dispatch.";
    case "auto":
      return "Model default. Effort is omitted from the request.";
    default:
      return "";
  }
}

export type EffortCommand =
  | { kind: "picker" }
  | { kind: "status" }
  | { kind: "set"; effort: EffortLevel; ultracode: boolean }
  | { kind: "ultracode-off" }
  | { kind: "invalid" };

/** `/effort`, `/effort <level>`, `/effort ultracode`, `/effort ultracode off`. */
export function parseEffortCommand(args: string): EffortCommand {
  const text = args.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return { kind: "picker" };
  if (text === "status") return { kind: "status" };
  if (text === "ultracode" || text === "ultracode on") return { kind: "set", effort: "max", ultracode: true };
  if (text === "ultracode off") return { kind: "ultracode-off" };
  const level = normalizeEffort(text);
  if (!level) return { kind: "invalid" };
  return { kind: "set", effort: level, ultracode: false };
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
