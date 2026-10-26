import { accessSync, constants, existsSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { redactKey } from "./config.js";
import { loadProfileText, memoryPath } from "./prompt.js";
import { VERSION } from "./version.js";

export interface DoctorReport {
  lines: Array<{ label: string; value: string; warn?: boolean }>;
}

export function diagnose(config: AppConfig): DoctorReport {
  const lines: DoctorReport["lines"] = [];
  lines.push({ label: "Glue", value: VERSION });
  lines.push({ label: "Node", value: process.version });
  let writable = false;
  try {
    accessSync(config.workspace, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  lines.push({
    label: "Workspace",
    value: `${config.workspace}${writable ? "" : " (not writable)"}`,
    warn: !writable,
  });
  lines.push({
    label: "Config",
    value: config.configPath ?? "none (using defaults and environment)",
  });
  lines.push({
    label: "API key",
    value: config.apiKey ? `${redactKey(config.apiKey)} via ${config.apiKeySource}` : "missing",
    warn: !config.apiKey,
  });
  lines.push({ label: "Base URL", value: config.baseURL });
  lines.push({ label: "Model", value: config.model });
  const profile = loadProfileText(config.profile, config.workspace);
  lines.push({
    label: "Profile",
    value: profile ? `${config.profile} · ${profile.source}` : `${config.profile} (no PROMPT.md overlay)`,
  });
  const memory = memoryPath(config.workspace);
  lines.push({ label: "Memory", value: existsSync(memory) ? memory : "no AGENT.md yet (/init writes one)" });
  lines.push({
    label: "Shell",
    value: config.shellEnabled ? "enabled — commands are not sandboxed" : "disabled",
    warn: config.shellEnabled,
  });
  lines.push({
    label: "Permission",
    value: config.permissionMode,
  });
  lines.push({ label: "Git", value: existsSync(path.join(config.workspace, ".git")) ? "yes" : "no" });
  return { lines };
}

export function formatDoctor(report: DoctorReport): string {
  const width = Math.max(...report.lines.map((line) => line.label.length));
  return report.lines
    .map((line) => `${line.label.padEnd(width)}  ${line.value}${line.warn ? "  !" : ""}`)
    .join("\n");
}
