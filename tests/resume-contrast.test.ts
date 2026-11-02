import assert from "node:assert/strict";
import { createElement } from "react";
import { Box, Text } from "ink";
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
  test("selection is bright white on a dark 16-color bar, readable even if the bar is dropped", () => {
    for (const accent of Object.values(NAMED_ACCENTS)) {
      assert.deepEqual(resumeSelectedInk({ ...THEMES.dark, accent }), { color: "whiteBright", backgroundColor: "blue" });
    }
    assert.deepEqual(resumeSelectedInk(THEMES.dark), { color: "whiteBright", backgroundColor: "blue" });
    assert.deepEqual(resumeSelectedInk(THEMES.light), { color: "whiteBright", backgroundColor: "blue" });
    assert.deepEqual(resumeSelectedInk(THEMES.ansi), { color: "whiteBright", backgroundColor: "blue" });
    for (const accent of ["red", "green", "blue", "magenta", "cyan"]) {
      assert.deepEqual(resumeSelectedInk({ ...THEMES.ansi, accent }), { color: "whiteBright", backgroundColor: accent });
    }
    for (const accent of ["black", "yellow", "white", "gray", "whiteBright", "yellowBright"]) {
      assert.deepEqual(resumeSelectedInk({ ...THEMES.ansi, accent }), { color: "whiteBright", backgroundColor: "blue" });
    }
    for (const accent of Object.keys(LEGACY)) {
      const ink = resumeSelectedInk({ ...THEMES.ansi, accent });
      const fg = FOREGROUND[ink.color];
      const bg = LEGACY[ink.backgroundColor];
      assert.equal(ink.color, "whiteBright");
      assert.ok(fg, `${accent} foreground ${ink.color} is not a known palette ink`);
      assert.ok(bg, `${accent} background ${ink.backgroundColor} is not a palette color`);
      const onBar = contrastRatio(fg, bg ?? "#000000");
      const onBlack = contrastRatio(fg, "#000000");
      assert.ok(onBar >= 4.5, `${accent} -> ${ink.color} on ${ink.backgroundColor} contrast ${onBar.toFixed(2)}`);
      // SGR 30 fails this. A dropped background must not hide the title on cmd.
      assert.ok(onBlack >= 4.5, `${accent} foreground ${ink.color} on a black window is ${onBlack.toFixed(2)}`);
      assert.notEqual(ink.color, "black");
      assert.doesNotMatch(ink.color, /^#/);
      assert.doesNotMatch(ink.backgroundColor, /^#/);
    }
    // The old bug: #D97757 is fine in truecolor, and nearly black once reduced to cmd red.
    assert.ok(contrastRatio("#D97757", "#000000") >= 4.5);
    assert.ok(contrastRatio("#800000", "#000000") < 2.5);
    // Black on yellow clears 4.5:1 only while the yellow is painted.
    assert.ok(contrastRatio("#000000", "#808000") >= 4.5);
    assert.ok(contrastRatio("#000000", "#000000") < 2);
    assert.ok(contrastRatio("#ffffff", "#000080") >= 4.5);
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
          assert.doesNotMatch(titleLine, /sess-selected|2h ago|messages/);
          assert.match(ageLine, /2h ago · 4 messages · main/);
          assert.doesNotMatch(ageLine, /SelectedTitleZQ|sess-selected/);
          const titleLineRaw = frame.split("\n").find((line) => line.includes("SelectedTitleZQ")) ?? "";
          assert.doesNotMatch(titleLineRaw, /\x1b\[7m/);
          const selected = markAt(frame, "SelectedTitleZQ");
          assert.equal(selected.fg, "ansi-97", `${theme.name} level ${level} fg ${selected.fg}`);
          assert.equal(selected.bg, "ansi-44", `${theme.name} level ${level} bg ${selected.bg}`);
          assert.equal(selected.bold, true, `${theme.name} level ${level} title should be bold`);
          assert.equal(selected.inverse, false);
          const age = markAt(frame, "2h ago");
          assert.equal(age.bold, false, `${theme.name} level ${level} meta should stay plain`);
          assert.notEqual(age.bg, "ansi-44");
          assert.match(text, /2h ago · 4 messages · main/);
          assert.doesNotMatch(ageLine, /sess-selected|SelectedTitleZQ/);
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
      assert.equal(lightSelected.fg, "ansi-97");
      assert.equal(lightSelected.bg, "ansi-44");
      const lightPlain = markAt(lightFrame, "SelectedTitleZQ");
      assert.equal(lightPlain.fg, THEMES.light.text.toLowerCase());
      assert.equal(lightPlain.bg, THEMES.light.bg);
      assert.notEqual(lightPlain.bg, "ansi-44");
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

  test("a short window does not paint the meta line over the selected title", () => {
    const previous = chalk.level;
    chalk.level = 3;
    try {
      const long = 'Follow the active skill "mattpocock-skills:ask-matt".';
      const rows = [
        { id: "20261029-153356-9dec", title: long, age: "1d ago", meta: "1d ago · 6 messages · main", detail: "20261029-153356-9dec", messages: 6, branch: "main" },
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `2026102${index}-155104-550a`,
          title: `short ${index}`,
          age: "3d ago",
          meta: "3d ago · 2 messages",
          detail: `2026102${index}-155104-550a`,
          messages: 2,
          branch: "",
        })),
      ];
      const view = render(
        createElement(
          Box,
          { flexDirection: "column", height: 24, width: 80, overflow: "hidden" },
          createElement(Box, { flexShrink: 0 }, createElement(Text, null, "HEADER")),
          createElement(
            Box,
            { flexGrow: 1, flexShrink: 1, minHeight: 0, overflow: "hidden" },
            createElement(Text, null, "TRANSCRIPT"),
          ),
          createElement(ResumePicker, {
            theme: THEMES.dark,
            selected: 0,
            query: "",
            matchCount: rows.length,
            preview: [`> ${long}`],
            rows,
          }),
          createElement(Box, { flexShrink: 0 }, createElement(Text, null, "PROMPT_ANCHOR")),
        ),
      );
      const frame = view.lastFrame() ?? "";
      const text = stripAnsi(frame);
      const lines = text.split("\n").map((line) => line.trim());
      const title = lines.find((line) => line.includes(long));
      const meta = lines.find((line) => line.includes("1d ago"));
      assert.ok(title, text);
      assert.ok(meta, text);
      assert.notEqual(title, meta);
      assert.match(title ?? "", /❯/);
      assert.doesNotMatch(title ?? "", /1d ago|20261029|messages/);
      assert.doesNotMatch(meta ?? "", /ask-matt|Follow the active/);
      assert.doesNotMatch(text, /9deccock/);
      assert.match(text, /PROMPT_ANCHOR/);
      const mark = markAt(frame, "ask-matt");
      assert.equal(mark.fg, "ansi-97");
      assert.equal(mark.bg, "ansi-44");
      view.unmount();
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
      { id: "sess-selected", title: "SelectedTitleZQ", age: "2h ago", meta: "2h ago · 4 messages · main", detail: "sess-selected", messages: 4, branch: "main" },
      { id: "sess-other", title: "OtherTitleZQ", age: "1d ago", meta: "1d ago · 1 message", detail: "sess-other", messages: 1, branch: "" },
    ],
  });
}

interface Mark {
  fg?: string;
  bg?: string;
  bold: boolean;
  inverse: boolean;
}

function markAt(frame: string, needle: string): Mark {
  const at = frame.indexOf(needle);
  assert.ok(at >= 0, `missing ${needle}`);
  let fg: string | undefined;
  let bg: string | undefined;
  let bold = false;
  let inverse = false;
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
        inverse = false;
        continue;
      }
      if (code === 1) {
        bold = true;
        continue;
      }
      if (code === 7) {
        inverse = true;
        continue;
      }
      if (code === 22) {
        bold = false;
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
      if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = `ansi-${code}`;
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) bg = `ansi-${code}`;
    }
  }
  return { fg, bg, bold, inverse };
}

function toHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}
