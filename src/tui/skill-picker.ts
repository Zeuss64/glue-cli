import type { Skill } from "../skills.js";
import { oneLine, skillSourceLabel } from "../skills.js";
import { fitWidth, visibleSlash } from "./complete.js";
import { prevGrapheme } from "./text.js";

export interface SkillPickerItem {
  id: string;
  name: string;
  description: string;
  source: string;
}

export interface SkillPickerState {
  all: SkillPickerItem[];
  query: string;
  selected: number;
}

export interface SkillPickerKey {
  input: string;
  ctrl: boolean;
  meta: boolean;
  return: boolean;
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  up: boolean;
  down: boolean;
}

export type SkillPickerEffect =
  | { type: "close" }
  | { type: "activate"; id: string }
  | { type: "fill"; id: string };

export function skillPickerItems(skills: readonly Skill[]): SkillPickerItem[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: oneLine(skill.description),
    source: skillSourceLabel(skill),
  }));
}

export function openSkillPicker(skills: readonly Skill[]): SkillPickerState {
  return { all: skillPickerItems(skills), query: "", selected: 0 };
}

export function filterSkillPicker(items: readonly SkillPickerItem[], query: string): SkillPickerItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) =>
    [item.id, item.name, item.description].some((field) => field.toLowerCase().includes(q)),
  );
}

export function visibleSkillPicker(state: SkillPickerState): SkillPickerItem[] {
  return filterSkillPicker(state.all, state.query);
}

/** `name (source) description`, truncated by display columns. The marker is part of the width. */
export function skillPickerLine(item: SkillPickerItem, columns: number, selected = false): string {
  const marker = selected ? "❯ " : "  ";
  const desc = oneLine(item.description);
  const body = `${item.name} (${item.source})${desc ? ` ${desc}` : ""}`;
  return fitWidth(`${marker}${body}`, Math.max(4, columns));
}

export function skillPickerWindow(items: readonly SkillPickerItem[], selected: number, size = 6): { rows: SkillPickerItem[]; selected: number } {
  return visibleSlash([...items], selected, size);
}

export function reduceSkillPicker(
  state: SkillPickerState,
  key: SkillPickerKey,
): { state: SkillPickerState; effect?: SkillPickerEffect } {
  if (key.escape || (key.ctrl && key.input === "c")) return { state, effect: { type: "close" } };
  const visible = visibleSkillPicker(state);
  if (key.up) {
    if (!visible.length) return { state };
    return { state: { ...state, selected: (state.selected + visible.length - 1) % visible.length } };
  }
  if (key.down) {
    if (!visible.length) return { state };
    return { state: { ...state, selected: (state.selected + 1) % visible.length } };
  }
  if (key.tab) {
    const item = picked(visible, state.selected);
    if (!item) return { state };
    return { state, effect: { type: "fill", id: item.id } };
  }
  if (key.return) {
    const item = picked(visible, state.selected);
    if (!item) return { state };
    return { state, effect: { type: "activate", id: item.id } };
  }
  if (key.ctrl && key.input === "u") return { state: { ...state, query: "", selected: 0 } };
  if (key.backspace || key.delete) {
    return { state: { ...state, query: state.query.slice(0, prevGrapheme(state.query, state.query.length)), selected: 0 } };
  }
  if (key.input && !key.ctrl && !key.meta) {
    return { state: { ...state, query: state.query + key.input, selected: 0 } };
  }
  return { state };
}

function picked(items: readonly SkillPickerItem[], selected: number): SkillPickerItem | undefined {
  if (!items.length) return undefined;
  return items[Math.max(0, Math.min(selected, items.length - 1))];
}
