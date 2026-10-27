import { cycleEffort, type EffortLevel } from "../effort.js";

/**
 * Optional ids a caller can pass as `suggestions` when `models` is empty.
 * The picker does not add these on its own.
 */
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

/**
 * Ids the picker shows. `models` from config wins: the current id, then that
 * list, each once. Built-in suggestions are not added on top of a custom list.
 * When `models` is empty, the list is only the current id unless `suggestions`
 * is passed explicitly.
 */
export function modelChoices(
  current: string,
  configured: readonly string[] = [],
  suggestions: readonly string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    const name = id.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  const listed = configured.map((id) => id.trim()).filter(Boolean);
  push(current);
  for (const id of listed) push(id);
  if (!listed.length) {
    for (const id of suggestions) push(id);
  }
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

export function modelWindow(items: readonly string[], selected: number, size = 8): { rows: string[]; selected: number; start: number } {
  const window = Math.max(1, size);
  const start = Math.max(0, Math.min(Math.max(0, selected - 1), Math.max(0, items.length - window)));
  return { rows: items.slice(start, start + window), selected: selected - start, start };
}

export interface ModelListEntry {
  id: string;
  /** 1-based index in the full list. */
  number: number;
  current: boolean;
  focused: boolean;
  description: string;
}

export function modelDescription(id: string, current: string): string {
  return id === current ? "Current session model" : "Configured id";
}

/** Plain rows for the model list. Descriptions share one column. */
export function modelListLines(entries: readonly ModelListEntry[]): string[] {
  const nameWidth = Math.max(1, ...entries.map((entry) => entry.id.length + (entry.current ? 2 : 0)));
  return entries.map((entry) => {
    const caret = entry.focused ? ">" : " ";
    const name = `${entry.id}${entry.current ? " ✓" : ""}`.padEnd(nameWidth);
    return `${caret} ${entry.number}. ${name}  ${entry.description}`;
  });
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
