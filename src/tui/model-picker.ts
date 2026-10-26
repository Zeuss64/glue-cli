import type { ApiProtocol } from "../llm/protocol.js";
import type { KeyIn } from "./editor.js";

export interface ModelChoice {
  id: string;
  detail: string;
}

export interface ModelPickerState {
  choices: ModelChoice[];
  selected: number;
}

export type ModelPickerEffect = "close" | "select";

const OPENAI_SUGGESTIONS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];
const ANTHROPIC_SUGGESTIONS = ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"];

export function bareModelQuery(text: string): boolean {
  return /^\/model\s*$/.test(text);
}

export function modelChoices(current: string, protocol: ApiProtocol, configured: readonly string[] = []): ModelChoice[] {
  const suggestions = protocol === "anthropic" ? ANTHROPIC_SUGGESTIONS : OPENAI_SUGGESTIONS;
  const rows: ModelChoice[] = [];
  const push = (id: string, detail: string) => {
    const name = id.trim();
    if (!name || rows.some((row) => row.id === name)) return;
    rows.push({ id: name, detail: name === current ? "current" : detail });
  };
  push(current, "current");
  for (const id of configured) push(id, "configured");
  for (const id of suggestions) push(id, "suggestion");
  return rows;
}

export function modelWindow<T>(rows: T[], selected: number, size = 8): { rows: T[]; selected: number } {
  const start = Math.max(0, Math.min(Math.max(0, selected - 1), Math.max(0, rows.length - size)));
  return { rows: rows.slice(start, start + size), selected: selected - start };
}

export function reduceModelPicker(state: ModelPickerState, key: KeyIn): { state: ModelPickerState; effect?: ModelPickerEffect } {
  const count = state.choices.length;
  if (!count) return key.escape ? { state, effect: "close" } : { state };
  const selected = ((state.selected % count) + count) % count;
  const normalized = selected === state.selected ? state : { ...state, selected };
  if (key.escape || (key.ctrl && key.input === "c")) return { state: normalized, effect: "close" };
  if (key.up) return { state: { ...normalized, selected: (selected + count - 1) % count } };
  if (key.down) return { state: { ...normalized, selected: (selected + 1) % count } };
  if (/^[1-9]$/.test(key.input) && !key.ctrl && !key.meta) {
    const index = Number(key.input) - 1;
    if (index < count) return { state: { ...normalized, selected: index }, effect: "select" };
  }
  if (key.return) return { state: normalized, effect: "select" };
  return { state: normalized };
}

export function formatModelStatus(model: string, protocol: ApiProtocol, configured: readonly string[] = []): string {
  const names = modelChoices(model, protocol, configured).map((choice) => choice.id).join(", ");
  return [
    `Model: ${model}`,
    "Set one for this session with /model <name>.",
    "In the prompt, /model opens a list. Up and down move, Enter switches, Esc cancels.",
    `Choices: ${names}`,
  ].join("\n");
}

export function modelHint(state: ModelPickerState): string {
  const choice = state.choices[state.selected];
  if (!choice) return "no models";
  return `model ${state.selected + 1}/${state.choices.length} · ${choice.id}`;
}
