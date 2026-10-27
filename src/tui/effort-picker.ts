import { EFFORT_PICKER, type EffortLevel } from "../effort.js";

export interface EffortPickerState {
  levels: EffortLevel[];
  selected: number;
}

export type EffortPickerEffect = { type: "select"; effort: EffortLevel } | { type: "cancel" };

export interface EffortPickerKey {
  left?: boolean;
  right?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrlC?: boolean;
}

/** Highlight the current level. Left and right move; they stop at the ends. */
export function openEffortPicker(current: EffortLevel): EffortPickerState {
  const levels = [...EFFORT_PICKER];
  const found = levels.indexOf(current);
  return { levels, selected: found >= 0 ? found : 0 };
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
