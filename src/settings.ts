import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeApproval, type ApprovalMode } from "./permissions.js";

export interface UiSettings {
  goal?: string;
  approval?: ApprovalMode;
  seen: { goal: boolean; approval: boolean };
}

export function uiSettingsPath(workspace: string): string {
  return path.join(workspace, ".agent", "ui.json");
}

export function readUiSettings(workspace: string): UiSettings {
  const file = uiSettingsPath(workspace);
  const empty: UiSettings = { seen: { goal: false, approval: false } };
  if (!existsSync(file)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const settings: UiSettings = { seen: { goal: false, approval: false } };
    if ("goal" in parsed && typeof parsed.goal === "string") {
      settings.goal = parsed.goal;
      settings.seen.goal = true;
    }
    if ("approval" in parsed && typeof parsed.approval === "string") {
      const approval = normalizeApproval(parsed.approval);
      if (approval) {
        settings.approval = approval;
        settings.seen.approval = true;
      }
    }
    return settings;
  } catch {
    return empty;
  }
}

export function writeUiSettings(
  workspace: string,
  patch: { goal?: string; approval?: ApprovalMode },
): UiSettings {
  const current = readUiSettings(workspace);
  const next: Record<string, string> = {};
  if (current.seen.goal && current.goal !== undefined) next.goal = current.goal;
  if (current.seen.approval && current.approval) next.approval = current.approval;
  if (patch.goal !== undefined) next.goal = patch.goal;
  if (patch.approval !== undefined) next.approval = patch.approval;
  const file = uiSettingsPath(workspace);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return readUiSettings(workspace);
}
