import type { PermissionMode } from "../types.js";

export interface Theme {
  name: "dark" | "light" | "ansi";
  accent: string;
  border: string;
  muted: string;
  text: string;
  /** User `>` lines. Distinct from `text`, which is the assistant body. */
  user: string;
  ok: string;
  bad: string;
  add: string;
  del: string;
  mode: Record<PermissionMode, string>;
}

export const THEMES: Record<Theme["name"], Theme> = {
  dark: {
    name: "dark",
    accent: "#D97757",
    border: "#6b625c",
    muted: "gray",
    text: "white",
    user: "#7DD3FC",
    ok: "green",
    bad: "red",
    add: "green",
    del: "red",
    mode: {
      default: "gray",
      acceptEdits: "cyan",
      plan: "yellow",
      dontAsk: "yellow",
      bypassPermissions: "red",
    },
  },
  light: {
    name: "light",
    accent: "#C2410C",
    border: "#a8a29e",
    muted: "gray",
    text: "black",
    user: "#0369A1",
    ok: "green",
    bad: "red",
    add: "green",
    del: "red",
    mode: {
      default: "gray",
      acceptEdits: "blue",
      plan: "yellow",
      dontAsk: "yellow",
      bypassPermissions: "red",
    },
  },
  ansi: {
    name: "ansi",
    accent: "yellow",
    border: "gray",
    muted: "gray",
    text: "white",
    user: "cyan",
    ok: "green",
    bad: "red",
    add: "green",
    del: "red",
    mode: {
      default: "white",
      acceptEdits: "cyan",
      plan: "yellow",
      dontAsk: "yellow",
      bypassPermissions: "red",
    },
  },
};

export const NAMED_ACCENTS: Record<string, string> = {
  red: "#ef4444",
  blue: "#60a5fa",
  green: "#34d399",
  yellow: "#facc15",
  purple: "#c084fc",
  orange: "#D97757",
  pink: "#f472b6",
  cyan: "#22d3ee",
};
