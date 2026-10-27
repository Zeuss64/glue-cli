import type { EffortLevel } from "../effort.js";
import { EFFORT_LEVELS } from "../effort.js";

/** Left-to-right order in the `/effort` picker. `auto` is the model default. */
export const EFFORT_PICKER_LEVELS: readonly EffortLevel[] = [...EFFORT_LEVELS, "auto"];

export interface EffortPickerState {
  levels: EffortLevel[];
  selected: number;
}

export interface EffortPickerKey {
  left?: boolean;
  right?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrlC?: boolean;
}

export type EffortPickerEffect = { type: "select"; effort: EffortLevel } | { type: "cancel" };

export function openEffortPicker(current: EffortLevel): EffortPickerState {
  const levels = [...EFFORT_PICKER_LEVELS];
  const index = levels.indexOf(current);
  return { levels, selected: index >= 0 ? index : 0 };
}

/** Highlighted level, for the one-line picker and tests. */
export function effortPickerMark(state: EffortPickerState): string {
  return state.levels.map((level, index) => (index === state.selected ? `[${level}]` : level)).join("  ");
}

export function reduceEffortPicker(
  state: EffortPickerState,
  key: EffortPickerKey,
): { state: EffortPickerState; effect?: EffortPickerEffect } {
  if (key.escape || key.ctrlC) return { state, effect: { type: "cancel" } };
  if (key.return) {
    const effort = state.levels[state.selected] ?? state.levels[0] ?? "auto";
    return { state, effect: { type: "select", effort } };
  }
  const last = Math.max(0, state.levels.length - 1);
  if (key.left) return { state: { ...state, selected: Math.max(0, state.selected - 1) } };
  if (key.right) return { state: { ...state, selected: Math.min(last, state.selected + 1) } };
  return { state };
}
