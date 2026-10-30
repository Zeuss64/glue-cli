import assert from "node:assert/strict";
import { createElement } from "react";
import { Box } from "ink";
import { render } from "ink-testing-library";
import chalk from "chalk";
import test from "node:test";
import { stripAnsi } from "../src/statusline.js";
import { contrastAtLeast, contrastRatio, luminance } from "../src/tui/contrast.js";
import { EffortPicker, PromptBox, SlashMenu, StatusBar, TranscriptView } from "../src/tui/components.js";
import { THEMES, textInk } from "../src/tui/theme.js";

// Ink drops colors when chalk's level is 0. These cases read the SGR codes.
chalk.level = 3;

const LIGHT_BG = "#fafaf9";
const DARK_BG = "#0c0c0c";

test("light theme tokens are dark ink on a light background, not palette black", () => {
  const light = THEMES.light;
  assert.equal(light.bg, LIGHT_BG);
  assert.notEqual(light.text, "black");
  assert.notEqual(light.text, "white");
  assert.ok(luminance(light.text) < 0.15);
  assert.ok(luminance(light.bg ?? "") > 0.9);
  assert.ok(contrastRatio(light.text, light.bg ?? "") >= 7);
  for (const color of [
    light.user,
    light.muted,
    light.accent,
    light.border,
    light.ok,
    light.bad,
    light.add,
    light.del,
    ...Object.values(light.mode),
  ]) {
    assert.ok(contrastRatio(color, light.bg ?? "") >= 4.5, `${color} is too close to the light background`);
  }
  const body = textInk(light, light.text);
  assert.equal(body.color, light.text);
  assert.equal(body.backgroundColor, light.bg);
  assert.equal(textInk(light, "black").color, light.text);
  assert.notEqual(textInk(light, "black").color, "black");
  assert.equal(textInk(light, "white").color, light.text);
  assert.ok(contrastRatio(textInk(light, "yellow").color, light.bg ?? "") >= 4.5);
  const washed = textInk(light, "#ffffff");
  assert.equal(washed.backgroundColor, light.bg);
  assert.ok(contrastRatio(washed.color, light.bg ?? "") >= 4.5);
  assert.ok(contrastRatio(contrastAtLeast("#ffffff", light.bg ?? ""), light.bg ?? "") >= 4.5);
});

test("dark and ansi themes keep a light body against a dark background", () => {
  assert.equal(THEMES.dark.text, "white");
  assert.equal(THEMES.dark.bg, undefined);
  assert.deepEqual(textInk(THEMES.dark, THEMES.dark.text), { color: "white" });
  assert.equal(THEMES.ansi.text, "white");
  assert.equal(THEMES.ansi.bg, undefined);
  assert.ok(contrastRatio("#ffffff", DARK_BG) >= 7);
  assert.ok(contrastRatio(THEMES.dark.user, DARK_BG) >= 4.5);
  assert.notEqual(THEMES.dark.text, THEMES.light.text);
  assert.notEqual(THEMES.dark.user, THEMES.dark.text);
  assert.notEqual(THEMES.light.user, THEMES.light.text);
});

test("rendered assistant text and the input caret contrast on light and stay light on dark", () => {
  const items = [
    { id: "u", type: "user" as const, text: "UserLineZQ" },
    { id: "a", type: "assistant" as const, text: "AssistantBodyZQ" },
  ];
  const lightView = render(createElement(TranscriptView, { theme: THEMES.light, expanded: false, items }));
  const lightFrame = lightView.lastFrame() ?? "";
  assert.match(stripAnsi(lightFrame), /AssistantBodyZQ/);
  assert.match(stripAnsi(lightFrame), /UserLineZQ/);
  assertReadable(lightFrame, "AssistantBodyZQ", { light: true, maxForeground: 0.15 });
  assertReadable(lightFrame, "UserLineZQ", { light: true });
  assert.equal(styleAt(lightFrame, "AssistantBodyZQ").fg, THEMES.light.text);
  assert.equal(styleAt(lightFrame, "AssistantBodyZQ").bg, THEMES.light.bg);
  lightView.unmount();

  const darkView = render(createElement(TranscriptView, { theme: THEMES.dark, expanded: false, items }));
  const darkFrame = darkView.lastFrame() ?? "";
  assertReadable(darkFrame, "AssistantBodyZQ", { light: false, minForeground: 0.7 });
  assert.notEqual(styleAt(darkFrame, "AssistantBodyZQ").fg, "ansi-30");
  assert.notEqual(styleAt(darkFrame, "AssistantBodyZQ").fg, styleAt(lightFrame, "AssistantBodyZQ").fg);
  darkView.unmount();

  const lightInput = render(
    createElement(Box, { width: 72, flexDirection: "column" }, createElement(PromptBox, { theme: THEMES.light, text: "ab", cursor: 1 })),
  );
  const inputFrame = lightInput.lastFrame() ?? "";
  assert.match(stripAnsi(inputFrame), /ab/);
  assert.match(inputFrame.split("\n")[0] ?? "", /38;2;120;113;108/);
  assert.doesNotMatch(inputFrame.split("\n")[0] ?? "", /38;2;194;65;12/);
  assertReadable(inputFrame, "a", { light: true, maxForeground: 0.15 });
  const caret = styleAt(inputFrame, "b");
  assert.equal(caret.inverse, true);
  assert.equal(caret.fg, THEMES.light.text);
  assert.equal(caret.bg, THEMES.light.bg);
  const caretPaint = effective(caret, LIGHT_BG, true);
  assert.ok(contrastRatio(caretPaint.fg, caretPaint.bg) >= 4.5);
  assert.notEqual(caretPaint.fg.toLowerCase(), caretPaint.bg.toLowerCase());
  lightInput.unmount();

  const darkInput = render(
    createElement(Box, { width: 72, flexDirection: "column" }, createElement(PromptBox, { theme: THEMES.dark, text: "ab", cursor: 1 })),
  );
  const darkInputFrame = darkInput.lastFrame() ?? "";
  assert.match(darkInputFrame.split("\n")[0] ?? "", /38;2;107;98;92/);
  assert.doesNotMatch(darkInputFrame.split("\n")[0] ?? "", /38;2;217;119;87/);
  assertReadable(darkInputFrame, "a", { light: false, minForeground: 0.7 });
  const darkCaret = styleAt(darkInputFrame, "b");
  assert.equal(darkCaret.inverse, true);
  assert.notEqual(darkCaret.fg, "ansi-30");
  darkInput.unmount();
});

test("placeholder, preedit, footer, slash row, and effort stay visible when the theme switches", () => {
  const placeholder = render(
    createElement(
      Box,
      { width: 72, flexDirection: "column" },
      createElement(PromptBox, { theme: THEMES.light, text: "", cursor: 0, placeholder: "place-zq" }),
    ),
  );
  const placeholderFrame = placeholder.lastFrame() ?? "";
  assert.match(stripAnsi(placeholderFrame), /place-zq/);
  assertReadable(placeholderFrame, "place-zq", { light: true });
  placeholder.unmount();

  const preedit = render(
    createElement(
      Box,
      { width: 72, flexDirection: "column" },
      createElement(PromptBox, { theme: THEMES.light, text: "", cursor: 0, preedit: "pinyin" }),
    ),
  );
  const preeditFrame = preedit.lastFrame() ?? "";
  assert.match(stripAnsi(preeditFrame), /pinyin/);
  assert.doesNotMatch(stripAnsi(preeditFrame), /place-zq/);
  assertReadable(preeditFrame, "pinyin", { light: true, maxForeground: 0.15 });
  preedit.unmount();

  const footer = render(createElement(StatusBar, { theme: THEMES.light, mode: "default", approval: "manual", session: "sess" }));
  const footerFrame = footer.lastFrame() ?? "";
  const footerText = stripAnsi(footerFrame).replace(/\s+/g, " ");
  assert.match(footerText, /manual mode on/);
  assert.match(footerText, /shift\+tab to cycle/);
  assert.match(footerText, /sess/);
  assert.doesNotMatch(footerText, /tokens:/);
  assertReadable(footerFrame, "manual mode on", { light: true });
  footer.unmount();

  const auto = render(createElement(StatusBar, { theme: THEMES.light, mode: "default", approval: "auto" }));
  const autoFrame = auto.lastFrame() ?? "";
  assert.match(stripAnsi(autoFrame), /auto mode on/);
  assertReadable(autoFrame, "auto mode on", { light: true });
  assert.notEqual(styleAt(autoFrame, "auto mode on").fg, "ansi-33");
  auto.unmount();

  const slash = render(
    createElement(SlashMenu, {
      theme: THEMES.light,
      selected: 0,
      columns: 80,
      rows: [
        { name: "theme", summary: "palette-check" },
        { name: "status", summary: "session status" },
      ],
    }),
  );
  const slashFrame = slash.lastFrame() ?? "";
  assert.match(slashFrame.replace(/\s+/g, " "), /palette-check/);
  assertReadable(slashFrame, "palette-check", { light: true });
  slash.unmount();

  const effort = render(
    createElement(EffortPicker, {
      theme: THEMES.light,
      levels: ["low", "medium", "high", "xhigh", "max"],
      selected: 2,
      ultracode: false,
    }),
  );
  const effortText = stripAnsi(effort.lastFrame() ?? "");
  assert.match(effortText, /Effort/);
  assert.match(effortText, /Faster/);
  assert.match(effortText, /Smarter/);
  assert.match(effortText, /Ultracode off/);
  assert.match(effortText, /Tab to toggle/);
  assertReadable(effort.lastFrame() ?? "", "Effort", { light: true, maxForeground: 0.15 });
  assertReadable(effort.lastFrame() ?? "", "Ultracode off", { light: true });
  effort.unmount();

  const switched = render(
    createElement(TranscriptView, {
      theme: THEMES.light,
      expanded: false,
      items: [{ id: "a", type: "assistant", text: "SwitchBodyZQ" }],
    }),
  );
  const before = switched.lastFrame() ?? "";
  assertReadable(before, "SwitchBodyZQ", { light: true, maxForeground: 0.15 });
  switched.rerender(
    createElement(TranscriptView, {
      theme: THEMES.dark,
      expanded: false,
      items: [{ id: "a", type: "assistant", text: "SwitchBodyZQ" }],
    }),
  );
  const after = switched.lastFrame() ?? "";
  assertReadable(after, "SwitchBodyZQ", { light: false, minForeground: 0.7 });
  assert.notEqual(styleAt(before, "SwitchBodyZQ").fg, styleAt(after, "SwitchBodyZQ").fg);
  assert.match(stripAnsi(after), /SwitchBodyZQ/);
  switched.unmount();
});

interface PaintOptions {
  light: boolean;
  maxForeground?: number;
  minForeground?: number;
}

function assertReadable(frame: string, needle: string, options: PaintOptions): void {
  const style = styleAt(frame, needle);
  assert.notEqual(style.fg, "ansi-30", `${needle} uses palette black`);
  const paint = effective(style, options.light ? LIGHT_BG : DARK_BG, options.light);
  const ratio = contrastRatio(paint.fg, paint.bg);
  assert.ok(ratio >= 4.5, `${needle} contrast ${ratio.toFixed(2)} fg ${paint.fg} bg ${paint.bg}`);
  assert.notEqual(paint.fg.toLowerCase(), paint.bg.toLowerCase());
  if (options.light) {
    assert.ok(style.bg, `${needle} has no light background`);
    assert.ok(luminance(style.bg ?? "") > 0.85);
  }
  if (options.maxForeground !== undefined && !style.inverse) {
    assert.ok(luminance(paint.fg) <= options.maxForeground, paint.fg);
  }
  if (options.minForeground !== undefined && !style.inverse) {
    assert.ok(luminance(paint.fg) >= options.minForeground, paint.fg);
  }
}

interface CellStyle {
  fg?: string;
  bg?: string;
  inverse: boolean;
}

function effective(style: CellStyle, fallbackBg: string, light: boolean): { fg: string; bg: string } {
  let fg = resolve(style.fg, light ? fallbackBg : "#e5e5e5", light);
  let bg = resolve(style.bg, fallbackBg, light);
  if (style.inverse) {
    const swap = fg;
    fg = bg;
    bg = swap;
  }
  return { fg, bg };
}

function resolve(color: string | undefined, fallback: string, light: boolean): string {
  if (!color) return fallback;
  if (color === "ansi-30") return light ? fallback : "#000000";
  return color;
}

const ANSI_FG: Record<number, string> = {
  30: "ansi-30",
  31: "#cd3131",
  32: "#0dbc79",
  33: "#e5e510",
  34: "#2472c8",
  35: "#bc3fbc",
  36: "#11a8cd",
  37: "#e5e5e5",
  90: "#666666",
  91: "#f14c4c",
  92: "#23d18b",
  93: "#f5f543",
  94: "#3b8eea",
  95: "#d670d6",
  96: "#29b8db",
  97: "#ffffff",
};

function styleAt(frame: string, needle: string): CellStyle {
  const at = frame.indexOf(needle);
  assert.ok(at >= 0, `missing ${needle}`);
  let fg: string | undefined;
  let bg: string | undefined;
  let inverse = false;
  const prefix = frame.slice(0, at);
  for (const match of prefix.matchAll(/\x1b\[([0-9;]*)m/g)) {
    const raw = match[1] ?? "";
    const parts = raw.length ? raw.split(";").map((part) => Number(part)) : [0];
    let index = 0;
    while (index < parts.length) {
      const code = parts[index++] ?? 0;
      if (code === 0) {
        fg = undefined;
        bg = undefined;
        inverse = false;
        continue;
      }
      if (code === 7) {
        inverse = true;
        continue;
      }
      if (code === 27) {
        inverse = false;
        continue;
      }
      if (code === 39) {
        fg = undefined;
        continue;
      }
      if (code === 49) {
        bg = undefined;
        continue;
      }
      if ((code === 38 || code === 48) && parts[index] === 2) {
        const hex = toHex(parts[index + 1] ?? 0, parts[index + 2] ?? 0, parts[index + 3] ?? 0);
        if (code === 38) fg = hex;
        else bg = hex;
        index += 4;
        continue;
      }
      if ((code === 38 || code === 48) && parts[index] === 5) {
        index += 2;
        continue;
      }
      const named = ANSI_FG[code];
      if (named) {
        fg = named;
        continue;
      }
      if (code >= 40 && code <= 47) bg = ANSI_FG[code - 10];
      else if (code >= 100 && code <= 107) bg = ANSI_FG[code - 60];
    }
  }
  return { fg, bg, inverse };
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}
