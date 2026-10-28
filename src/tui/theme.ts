import type { PermissionMode } from "../types.js";
import { contrastAtLeast, contrastRatio, isHex } from "./contrast.js";

export interface Theme {
  name: "dark" | "light" | "ansi";
  accent: string;
  border: string;
  muted: string;
  text: string;
  /**
   * Cell background painted behind theme text.
   * Light theme sets this so body copy does not sit on the terminal's own
   * background. Omit it for `ansi`, which stays on the terminal palette.
   */
  bg?: string;
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
      auto: "yellow",
      yolo: "red",
      dontAsk: "yellow",
      bypassPermissions: "red",
    },
  },
  light: {
    name: "light",
    accent: "#C2410C",
    border: "#78716c",
    muted: "#57534e",
    // Truecolor, not ANSI black. Palette color 0 is often the light background.
    text: "#1c1917",
    bg: "#fafaf9",
    user: "#0369A1",
    ok: "#15803d",
    bad: "#b91c1c",
    add: "#15803d",
    del: "#b91c1c",
    mode: {
      default: "#57534e",
      acceptEdits: "#1d4ed8",
      plan: "#a16207",
      auto: "#a16207",
      yolo: "#b91c1c",
      dontAsk: "#a16207",
      bypassPermissions: "#b91c1c",
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
      auto: "yellow",
      yolo: "red",
      dontAsk: "yellow",
      bypassPermissions: "red",
    },
  },
};

/**
 * Ink props for one run of theme text.
 * Light theme always sets an explicit background. ANSI names that disappear
 * on that background (`black`, `white`, `yellow`, …) are rewritten to hex.
 */
export function textInk(theme: Theme, color: string): { color: string; backgroundColor?: string } {
  const paint = theme.name === "light" ? lightForeground(theme, color) : color;
  if (theme.bg) return { color: paint, backgroundColor: theme.bg };
  return { color: paint };
}

function lightForeground(theme: Theme, color: string): string {
  const background = theme.bg ?? "#fafaf9";
  switch (color) {
    case "black":
    case "white":
      return isHex(theme.text) ? theme.text : "#1c1917";
    case "gray":
    case "grey":
      return isHex(theme.muted) ? theme.muted : "#57534e";
    case "yellow":
      return "#a16207";
    case "cyan":
      return "#0f766e";
    case "green":
      return isHex(theme.ok) ? theme.ok : "#15803d";
    case "red":
      return isHex(theme.bad) ? theme.bad : "#b91c1c";
    case "blue":
      return "#1d4ed8";
    default:
      if (isHex(color) && contrastRatio(color, background) < 4.5) return contrastAtLeast(color, background);
      return color;
  }
}

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
