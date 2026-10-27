import { EFFORT_LEVELS, type EffortChoice, type EffortLevel } from "../effort.js";

/** Left-to-right slider. UltraCode sits after `max`: max thinking plus subagents. `auto` is the model default. */
export const EFFORT_PICKER_LEVELS: readonly EffortChoice[] = [...EFFORT_LEVELS, "ultracode", "auto"];

export interface EffortPickerState {
  levels: EffortChoice[];
  selected: number;
}

export interface EffortPickerKey {
  left?: boolean;
  right?: boolean;
  tab?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrlC?: boolean;
}

export type EffortPickerEffect = { type: "select"; choice: EffortChoice } | { type: "cancel" };

export function openEffortPicker(current: EffortLevel, ultracode = false): EffortPickerState {
  const levels = [...EFFORT_PICKER_LEVELS];
  const choice: EffortChoice = ultracode ? "ultracode" : current;
  const index = levels.indexOf(choice);
  return { levels, selected: index >= 0 ? index : 0 };
}

/** Highlighted stop, for tests. Brackets are the selection chrome. */
export function effortPickerMark(state: EffortPickerState): string {
  return state.levels.map((level, index) => (index === state.selected ? `[${level}]` : level)).join("  ");
}

/** Knob track under the labels. The filled dot is the highlighted stop. */
export function effortSliderTrack(count: number, selected: number): string {
  if (count <= 0) return "";
  const cells: string[] = [];
  for (let i = 0; i < count; i++) {
    cells.push(i === selected ? "●" : "○");
    if (i < count - 1) cells.push("────");
  }
  return cells.join("");
}

export function reduceEffortPicker(
  state: EffortPickerState,
  key: EffortPickerKey,
): { state: EffortPickerState; effect?: EffortPickerEffect } {
  if (key.escape || key.ctrlC) return { state, effect: { type: "cancel" } };
  if (key.return) {
    const choice = state.levels[state.selected] ?? state.levels[0] ?? "auto";
    return { state, effect: { type: "select", choice } };
  }
  if (key.tab) return { state: { ...state, selected: tabTarget(state) } };
  const last = Math.max(0, state.levels.length - 1);
  if (key.left) return { state: { ...state, selected: Math.max(0, state.selected - 1) } };
  if (key.right) return { state: { ...state, selected: Math.min(last, state.selected + 1) } };
  return { state };
}

/** Tab jumps to UltraCode, and Tab again returns to `max`. */
function tabTarget(state: EffortPickerState): number {
  const ultra = state.levels.indexOf("ultracode");
  if (ultra < 0) return state.selected;
  if (state.selected === ultra) {
    const max = state.levels.indexOf("max");
    return max >= 0 ? max : 0;
  }
  return ultra;
}
