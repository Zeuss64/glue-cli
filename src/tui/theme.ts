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

/** 16-color names Ink can pass to chalk without emitting `38;2`. */
const ANSI_BACKGROUND = new Set([
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "gray",
  "grey",
  "blackBright",
  "redBright",
  "greenBright",
  "yellowBright",
  "blueBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
]);

/**
 * Palette backgrounds where black text clears 4.5:1 on the legacy cmd colors.
 * Dark backgrounds use bright white (SGR 97). Plain `white` is SGR 37, which
 * is gray `#c0c0c0` there and fails on green and cyan.
 */
const BLACK_ON_ANSI = new Set([
  "yellow",
  "white",
  "gray",
  "grey",
  "blackBright",
  "redBright",
  "greenBright",
  "yellowBright",
  "magentaBright",
  "cyanBright",
  "whiteBright",
]);

const ANSI_SELECTION = { color: "black", backgroundColor: "yellow" } as const;

/**
 * Ink props for the selected `/resume` title.
 *
 * Dark and light accents are hex (`#D97757`, `#C2410C`). The row used to set
 * that hex as `color` and leave `backgroundColor` unset. Ink forwards it to
 * `chalk.hex`. At 16 colors, chalk turns `#D97757` into SGR 31. Classic cmd
 * draws SGR 31 as `#800000`, about 1.9:1 on a black window, so the title is
 * nearly invisible. The line under it is the named color `gray`, which stays
 * readable, and the list looks like `2h ago · <session id>`.
 *
 * Windows 10+ is reported as truecolor from the OS build, including cmd.exe,
 * so chalk often emits `38;2;217;119;87` instead of SGR 31. Conhost quantizes
 * 24-bit SGR onto the 16-color palette instead of drawing the RGB, so a hex
 * background is not an escape hatch. The selection always uses a 16-color
 * background and a 16-color foreground. A hex accent is black on yellow.
 */
export function resumeSelectedInk(theme: Theme): { color: string; backgroundColor: string } {
  const accent = theme.accent;
  // A black bar is the cmd window itself, so it does not mark the row.
  if (!ANSI_BACKGROUND.has(accent) || accent === "black") return { ...ANSI_SELECTION };
  return {
    color: BLACK_ON_ANSI.has(accent) ? "black" : "whiteBright",
    backgroundColor: accent,
  };
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
