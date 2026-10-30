import assert from "node:assert/strict";
import { createElement } from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import chalk from "chalk";
import test from "node:test";
import { stripAnsi } from "../src/statusline.js";
import { contrastRatio } from "../src/tui/contrast.js";
import { ResumePicker } from "../src/tui/components.js";
import { NAMED_ACCENTS, THEMES, resumeSelectedInk, type Theme } from "../src/tui/theme.js";

/**
 * Legacy cmd.exe palette. SGR 37 (`white`) is #c0c0c0, not #ffffff.
 * SGR 31 (`red`) is #800000, which is what chalk's 16-color reducer emits for #D97757.
 */
const LEGACY: Record<string, string> = {
  black: "#000000",
  red: "#800000",
  green: "#008000",
  yellow: "#808000",
  blue: "#000080",
  magenta: "#800080",
  cyan: "#008080",
  white: "#c0c0c0",
  gray: "#808080",
  grey: "#808080",
  blackBright: "#808080",
  redBright: "#ff0000",
  greenBright: "#00ff00",
  yellowBright: "#ffff00",
  blueBright: "#0000ff",
  magentaBright: "#ff00ff",
  cyanBright: "#00ffff",
  whiteBright: "#ffffff",
};

const FOREGROUND: Record<string, string> = {
  black: "#000000",
  white: "#c0c0c0",
  whiteBright: "#ffffff",
};

test.describe("resume picker contrast", { concurrency: false }, () => {
  test("selection is a 16-color pair that stays readable on the legacy cmd palette", () => {
    for (const accent of Object.values(NAMED_ACCENTS)) {
      assert.deepEqual(resumeSelectedInk({ ...THEMES.dark, accent }), { color: "black", backgroundColor: "yellow" });
    }
    assert.deepEqual(resumeSelectedInk(THEMES.dark), { color: "black", backgroundColor: "yellow" });
    assert.deepEqual(resumeSelectedInk(THEMES.light), { color: "black", backgroundColor: "yellow" });
    assert.deepEqual(resumeSelectedInk(THEMES.ansi), { color: "black", backgroundColor: "yellow" });
    assert.equal(resumeSelectedInk({ ...THEMES.ansi, accent: "black" }).backgroundColor, "yellow");
    for (const accent of Object.keys(LEGACY)) {
      const ink = resumeSelectedInk({ ...THEMES.ansi, accent });
      const fg = FOREGROUND[ink.color];
      const bg = LEGACY[ink.backgroundColor];
      assert.ok(fg, `${accent} foreground ${ink.color} is not a known palette ink`);
      assert.ok(bg, `${accent} background ${ink.backgroundColor} is not a palette color`);
      const ratio = contrastRatio(fg, bg ?? "#000000");
      assert.ok(ratio >= 4.5, `${accent} -> ${ink.color} on ${ink.backgroundColor} contrast ${ratio.toFixed(2)}`);
      assert.doesNotMatch(ink.color, /^#/);
      assert.doesNotMatch(ink.backgroundColor, /^#/);
    }
    // The bug: #D97757 is fine in truecolor, and nearly black once reduced to cmd red.
    assert.ok(contrastRatio("#D97757", "#000000") >= 4.5);
    assert.ok(contrastRatio("#800000", "#000000") < 2.5);
    assert.ok(contrastRatio("#000000", "#808000") >= 4.5);
  });

  test("a lone hex accent has no background and becomes dark red at 16 colors", () => {
    const previous = chalk.level;
    try {
      chalk.level = 1;
      const dim = render(createElement(Text, { color: "#D97757" }, "AccentZQ"));
      const dimFrame = dim.lastFrame() ?? "";
      const dimMark = markAt(dimFrame, "AccentZQ");
      assert.equal(dimMark.fg, "ansi-31");
      assert.equal(dimMark.bg, undefined);
      assert.doesNotMatch(dimFrame, /38;2;/);
      dim.unmount();

      chalk.level = 3;
      const full = render(createElement(Text, { color: "#D97757" }, "AccentZQ"));
      const fullFrame = full.lastFrame() ?? "";
      const fullMark = markAt(fullFrame, "AccentZQ");
      assert.equal(fullMark.fg, "#d97757");
      assert.equal(fullMark.bg, undefined);
      assert.match(fullFrame, /38;2;217;119;87/);
      full.unmount();
    } finally {
      chalk.level = previous;
    }
  });

  test("the selected resume title uses the ANSI pair at every color level", () => {
    const previous = chalk.level;
    try {
      for (const level of [1, 2, 3] as const) {
        chalk.level = level;
        for (const theme of [THEMES.dark, THEMES.light, THEMES.ansi]) {
          const view = render(picker(theme, 0));
          const frame = view.lastFrame() ?? "";
          const text = stripAnsi(frame);
          const titleLine = text.split("\n").find((line) => line.includes("SelectedTitleZQ")) ?? "";
          const ageLine = text.split("\n").find((line) => line.includes("2h ago")) ?? "";
          assert.match(titleLine, /❯ SelectedTitleZQ/);
          assert.doesNotMatch(titleLine, /sess-selected|2h ago/);
          assert.match(ageLine, /2h ago · sess-selected/);
          assert.doesNotMatch(ageLine, /SelectedTitleZQ/);
          const selected = markAt(frame, "SelectedTitleZQ");
          assert.equal(selected.fg, "ansi-30", `${theme.name} level ${level} fg ${selected.fg}`);
          assert.equal(selected.bg, "ansi-43", `${theme.name} level ${level} bg ${selected.bg}`);
          const age = markAt(frame, "2h ago");
          assert.equal(age.bold, true, `${theme.name} level ${level} age should be bold`);
          assert.notEqual(age.bg, "ansi-43");
          const id = markAt(frame, "sess-selected");
          assert.equal(id.bold, false, `${theme.name} level ${level} session id should not be bold`);
          assert.notEqual(id.bg, selected.bg, `${theme.name} level ${level} session id uses the selection bar`);
          if (theme.muted === "gray") assert.equal(id.fg, "ansi-90");
          view.unmount();
        }
      }

      chalk.level = 3;
      const dark = render(picker(THEMES.dark, 0));
      const other = markAt(dark.lastFrame() ?? "", "OtherTitleZQ");
      assert.equal(other.fg, "ansi-37");
      assert.equal(other.bg, undefined);
      dark.unmount();

      const light = render(picker(THEMES.light, 1));
      const lightFrame = light.lastFrame() ?? "";
      const lightSelected = markAt(lightFrame, "OtherTitleZQ");
      assert.equal(lightSelected.fg, "ansi-30");
      assert.equal(lightSelected.bg, "ansi-43");
      const lightPlain = markAt(lightFrame, "SelectedTitleZQ");
      assert.equal(lightPlain.fg, THEMES.light.text.toLowerCase());
      assert.equal(lightPlain.bg, THEMES.light.bg);
      assert.notEqual(lightPlain.bg, "ansi-43");
      light.unmount();

      const named = render(picker({ ...THEMES.ansi, accent: "red" }, 0));
      const red = markAt(named.lastFrame() ?? "", "SelectedTitleZQ");
      assert.equal(red.fg, "ansi-97");
      assert.equal(red.bg, "ansi-41");
      named.unmount();
    } finally {
      chalk.level = previous;
    }
  });
});

function picker(theme: Theme, selected: number) {
  return createElement(ResumePicker, {
    theme,
    selected,
    query: "",
    matchCount: 2,
    preview: ["> preview line"],
    rows: [
      { id: "sess-selected", title: "SelectedTitleZQ", age: "2h ago", detail: "sess-selected" },
      { id: "sess-other", title: "OtherTitleZQ", age: "1d ago", detail: "sess-other" },
    ],
  });
}

interface Mark {
  fg?: string;
  bg?: string;
  bold: boolean;
}

function markAt(frame: string, needle: string): Mark {
  const at = frame.indexOf(needle);
  assert.ok(at >= 0, `missing ${needle}`);
  let fg: string | undefined;
  let bg: string | undefined;
  let bold = false;
  for (const match of frame.slice(0, at).matchAll(/\x1b\[([0-9;]*)m/g)) {
    const raw = match[1] ?? "";
    const parts = raw.length ? raw.split(";").map((part) => Number(part)) : [0];
    let index = 0;
    while (index < parts.length) {
      const code = parts[index++] ?? 0;
      if (code === 0) {
        fg = undefined;
        bg = undefined;
        bold = false;
        continue;
      }
      if (code === 1) {
        bold = true;
        continue;
      }
      if (code === 22) {
        bold = false;
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
      if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = `ansi-${code}`;
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) bg = `ansi-${code}`;
    }
  }
  return { fg, bg, bold };
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}
