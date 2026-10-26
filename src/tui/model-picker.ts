import { cycleEffort, type EffortLevel } from "../effort.js";

/** Public model ids offered after the current model and `models` from config. */
export const SUGGESTED_MODELS = [
  "gpt-4o-mini",
  "gpt-4o",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-opus-4-5",
] as const;

export interface ModelPickerState {
  items: string[];
  selected: number;
  effort: EffortLevel;
}

export type ModelPickerEffect =
  | { type: "select"; model: string }
  | { type: "cancel" }
  | { type: "effort"; effort: EffortLevel };

export interface ModelPickerKey {
  up?: boolean;
  down?: boolean;
  left?: boolean;
  right?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrlC?: boolean;
}

/** Current model, then configured ids, then suggestions. The current id is listed once. */
export function modelChoices(
  current: string,
  configured: readonly string[] = [],
  suggestions: readonly string[] = SUGGESTED_MODELS,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    const name = id.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  push(current);
  for (const id of configured) push(id);
  for (const id of suggestions) push(id);
  if (!out.length) push("gpt-4o-mini");
  return out;
}

export function openModelPicker(current: string, configured: readonly string[], effort: EffortLevel): ModelPickerState {
  return { items: modelChoices(current, configured), selected: 0, effort };
}

/** `N/M · id`, 1-based. A one-item list is `1/1 · id`. */
export function modelPosition(state: ModelPickerState): string {
  const count = Math.max(1, state.items.length);
  const index = Math.min(Math.max(0, state.selected), count - 1);
  const id = state.items[index] ?? "";
  return `${index + 1}/${state.items.length || 1} · ${id}`;
}

export function modelWindow(items: readonly string[], selected: number, size = 8): { rows: string[]; selected: number } {
  const window = Math.max(1, size);
  const start = Math.max(0, Math.min(Math.max(0, selected - 1), Math.max(0, items.length - window)));
  return { rows: items.slice(start, start + window), selected: selected - start };
}

export function reduceModelPicker(
  state: ModelPickerState,
  key: ModelPickerKey,
): { state: ModelPickerState; effect?: ModelPickerEffect } {
  if (key.escape || key.ctrlC) return { state, effect: { type: "cancel" } };
  if (key.return) {
    const model = state.items[state.selected] ?? state.items[0];
    if (!model) return { state, effect: { type: "cancel" } };
    return { state, effect: { type: "select", model } };
  }
  const count = state.items.length;
  if (count > 0 && key.up) return { state: { ...state, selected: (state.selected + count - 1) % count } };
  if (count > 0 && key.down) return { state: { ...state, selected: (state.selected + 1) % count } };
  if (key.left || key.right) {
    const effort = cycleEffort(state.effort, key.right ? 1 : -1);
    return { state: { ...state, effort }, effect: { type: "effort", effort } };
  }
  return { state };
}

/** True only for the exact draft `/model`, so `/model <id>` can still be typed. */
export function isModelDraft(text: string): boolean {
  return text === "/model";
}

/** `/model` opens the picker. `/model <id>` sets that id and does not open it. */
export function bareModelQuery(input: string): "picker" | { model: string } | null {
  const body = input.trim().replace(/^\//, "").trim();
  if (!body) return null;
  const space = body.search(/\s/);
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  if (name !== "model") return null;
  const args = space === -1 ? "" : body.slice(space + 1).trim();
  if (!args) return "picker";
  return { model: args };
}
