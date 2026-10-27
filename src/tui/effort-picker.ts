import { EFFORT_LEVELS, type EffortLevel, type NamedEffort } from "../effort.js";

/** Stops on the `/effort` track. UltraCode is not one of them. */
export const EFFORT_PICKER_LEVELS: readonly NamedEffort[] = [...EFFORT_LEVELS];

export interface EffortPickerState {
  levels: NamedEffort[];
  selected: number;
  ultracode: boolean;
}

export interface EffortPickerKey {
  left?: boolean;
  right?: boolean;
  tab?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrlC?: boolean;
}

export type EffortPickerEffect =
  | { type: "select"; effort: NamedEffort; ultracode: boolean }
  | { type: "cancel" };

export function openEffortPicker(current: EffortLevel, ultracode = false): EffortPickerState {
  const levels = [...EFFORT_PICKER_LEVELS];
  const index = levels.indexOf(current as NamedEffort);
  const selected = index >= 0 ? index : Math.max(0, levels.indexOf("high"));
  return { levels, selected, ultracode };
}

const TRACK_GAP = "  ";
const TRACK_FLANK = "  ";

/**
 * One thin track, with the level names underneath.
 * `Faster` and `Smarter` flank the line. The ▲ sits in the same columns as the highlighted name.
 */
export function effortTrackLines(levels: readonly string[], selected: number): { labels: string; track: string } {
  const cells = levels.map((level) => {
    const width = Math.max(level.length, 3);
    return { width, label: center(level, width) };
  });
  const body = cells.map((cell) => cell.label).join(TRACK_GAP);
  let column = 0;
  for (let index = 0; index < selected && index < cells.length; index += 1) {
    column += (cells[index]?.width ?? 0) + TRACK_GAP.length;
  }
  const width = cells[selected]?.width ?? 1;
  const markAt = Math.min(body.length - 1, column + Math.floor(width / 2));
  const dashes = Array.from("─".repeat(body.length));
  if (markAt >= 0 && markAt < dashes.length) dashes[markAt] = "▲";
  const prefix = `Faster${TRACK_FLANK}`;
  const suffix = `${TRACK_FLANK}Smarter`;
  return {
    track: `${prefix}${dashes.join("")}${suffix}`,
    labels: `${" ".repeat(prefix.length)}${body}${" ".repeat(suffix.length)}`,
  };
}

/** True when the knob column falls inside the highlighted level's letters. */
export function effortKnobAligned(levels: readonly string[], selected: number): boolean {
  const { labels, track } = effortTrackLines(levels, selected);
  const name = levels[selected];
  if (!name) return false;
  const knob = track.indexOf("▲");
  const start = labels.indexOf(name);
  if (knob < 0 || start < 0) return false;
  return knob >= start && knob < start + name.length;
}

export function reduceEffortPicker(
  state: EffortPickerState,
  key: EffortPickerKey,
): { state: EffortPickerState; effect?: EffortPickerEffect } {
  if (key.escape || key.ctrlC) return { state, effect: { type: "cancel" } };
  if (key.return) {
    const effort = state.levels[state.selected] ?? "high";
    return { state, effect: { type: "select", effort, ultracode: state.ultracode } };
  }
  if (key.tab) return { state: { ...state, ultracode: !state.ultracode } };
  const last = Math.max(0, state.levels.length - 1);
  if (key.left) return { state: { ...state, selected: Math.max(0, state.selected - 1) } };
  if (key.right) return { state: { ...state, selected: Math.min(last, state.selected + 1) } };
  return { state };
}

function center(text: string, width: number): string {
  const pad = Math.max(0, width - text.length);
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + text + " ".repeat(pad - left);
}
