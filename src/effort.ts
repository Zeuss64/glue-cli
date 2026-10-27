/** Session effort. `auto` means the provider default and is omitted from the request. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type NamedEffort = (typeof EFFORT_LEVELS)[number];
export type EffortLevel = NamedEffort | "auto";

/**
 * UltraCode is not an API effort value. The flag turns on dynamic workflows
 * (`spawn_subagent` on every task). `GLUE_EFFORT=ultracode` still starts at `max`.
 */
export const ULTRACODE = "ultracode" as const;

/** Exact overlay and session copy. Do not rephrase. */
export const ULTRACODE_DESCRIPTION = "Ultracode: dynamic workflows on every task";
export type EffortChoice = EffortLevel | typeof ULTRACODE;

/** Left/right order in the model picker. UltraCode stays on the `/effort` slider. */
export const EFFORT_CYCLE: readonly EffortLevel[] = ["auto", ...EFFORT_LEVELS];

export interface EffortSelection {
  /** Value sent as Anthropic `output_config.effort`. `auto` omits it. */
  effort: EffortLevel;
  /** When true, every task is a dynamic workflow dispatched with `spawn_subagent`. */
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
  const level = effort ?? "auto";
  return ultracode ? `${level} · ultracode` : level;
}

const EFFORT_COLOR: Record<string, string> = {
  low: "yellow",
  medium: "green",
  high: "cyan",
  xhigh: "#c084fc",
  auto: "white",
};

/** Bright steps for the `max` shimmer. Other levels do not use this list. */
export const MAX_EFFORT_SHIMMER = ["#fde047", "#fb923c", "#f472b6", "#e879f9", "#22d3ee", "#4ade80"] as const;

const XHIGH_BASE = "#c084fc";
const XHIGH_EDGE = "#e9d5ff";
const XHIGH_WASH = "#ffffff";

/** Stable color per level. `max` advances through the shimmer on each tick. `xhigh` stays purple here; the sweep is per glyph. */
export function effortColor(level: string | undefined, tick = 0): string {
  if (level === "max") {
    const index = ((Math.floor(tick) % MAX_EFFORT_SHIMMER.length) + MAX_EFFORT_SHIMMER.length) % MAX_EFFORT_SHIMMER.length;
    return MAX_EFFORT_SHIMMER[index] ?? "green";
  }
  return EFFORT_COLOR[level ?? "auto"] ?? "white";
}

/**
 * Where the white wash sits inside an `xhigh` label.
 * `-1` means the wash is off the left or right end, so the word is solid purple.
 */
export function xhighSweepIndex(length: number, tick: number): number {
  const span = Math.max(1, length) + 2;
  const head = ((Math.floor(tick) % span) + span) % span;
  const index = head - 1;
  if (index < 0 || index >= length) return -1;
  return index;
}

/** Per-glyph color. `xhigh` runs a white wash left to right. `max` uses the rainbow on every glyph. */
export function effortGlyphColor(level: string, index: number, length: number, tick = 0): string {
  if (level === "xhigh") {
    const hot = xhighSweepIndex(length, tick);
    if (hot < 0) return XHIGH_BASE;
    const dist = Math.abs(index - hot);
    if (dist === 0) return XHIGH_WASH;
    if (dist === 1) return XHIGH_EDGE;
    return XHIGH_BASE;
  }
  return effortColor(level, tick);
}

/** Public label in the model picker, for example `xHigh`. */
export function effortTitle(level: string | undefined): string {
  switch (level) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "xHigh";
    case "max":
      return "Max";
    default:
      return "Auto";
  }
}

export function effortSetMessage(selection: EffortSelection): string {
  if (selection.ultracode) return `${ULTRACODE_DESCRIPTION}.`;
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
      return ULTRACODE_DESCRIPTION;
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
  | { kind: "ultracode-on" }
  | { kind: "ultracode-off" }
  | { kind: "invalid" };

/** `/effort`, `/effort <level>`, `/effort ultracode`, `/effort ultracode off`. */
export function parseEffortCommand(args: string): EffortCommand {
  const text = args.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return { kind: "picker" };
  if (text === "status") return { kind: "status" };
  if (text === "ultracode" || text === "ultracode on") return { kind: "ultracode-on" };
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
