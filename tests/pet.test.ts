import assert from "node:assert/strict";
import { createElement } from "react";
import { render } from "ink-testing-library";
import chalk from "chalk";
import test from "node:test";
import { stripAnsi } from "../src/statusline.js";
import { Header } from "../src/tui/components.js";
import { HORSE_PIXELS, horseRows, PET_COLOR, pixelsToRows, STARTUP_HEADER_ROWS } from "../src/tui/pet.js";
import { displayWidth } from "../src/tui/text.js";
import { THEMES } from "../src/tui/theme.js";
import { VERSION } from "../src/version.js";

chalk.level = 3;

const BLOCK = /[▀▄█▌▐▖▗▘▝▚▞▛▜▙▟]/;

test("quadrant blocks pack pixel pairs", () => {
  assert.equal(pixelsToRows(["##", "#."])[0], "▛");
  assert.equal(pixelsToRows([".#", ".."])[0], "▝");
  assert.equal(pixelsToRows(["..", ".."])[0], "");
  assert.equal(pixelsToRows(["#o", "##"])[0], "▙");
});

test("the startup horse is a short left-aligned side view", () => {
  assert.equal(PET_COLOR, "#9B6BFF");
  assert.equal(HORSE_PIXELS.length, STARTUP_HEADER_ROWS * 2);
  assert.equal(STARTUP_HEADER_ROWS, 4);
  const rows = horseRows();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows, pixelsToRows(HORSE_PIXELS));
  for (const row of rows) {
    assert.equal(displayWidth(row), [...row].length);
    assert.ok(displayWidth(row) <= 12, row);
  }
  assert.ok(rows.some((row) => BLOCK.test(row[0] ?? "")));
  const legs = rows[rows.length - 1] ?? "";
  assert.ok(legs.trim().split(/\s+/).length >= 4, legs);
  const body = rows[rows.length - 2] ?? "";
  assert.equal(body.trim().split(/\s+/).length, 1);

  let left = Number.POSITIVE_INFINITY;
  let leftY = -1;
  let right = -1;
  let rightY = -1;
  HORSE_PIXELS.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell !== "#") return;
      if (x < left) {
        left = x;
        leftY = y;
      }
      if (x > right) {
        right = x;
        rightY = y;
      }
    });
  });
  assert.ok(rightY >= 0 && rightY < HORSE_PIXELS.length / 2, "muzzle is in the upper half");
  assert.ok(leftY >= HORSE_PIXELS.length / 2, "tail is in the lower half");
  assert.ok(HORSE_PIXELS.some((row) => row.includes("o")));
});

test("the startup header puts the horse on the left and the version on the right", () => {
  const theme = THEMES.ansi;
  const view = render(
    createElement(Header, { theme, model: "gpt-4o-mini", cwd: "D:/work", branch: "main" }),
  );
  const raw = view.lastFrame() ?? "";
  const frame = stripAnsi(raw);
  const lines = frame.split("\n").filter((line) => line.trim().length > 0);
  assert.equal(lines.length, STARTUP_HEADER_ROWS);
  const top = lines[0] ?? "";
  assert.match(top, /Glue/);
  assert.ok(top.includes(VERSION));
  assert.ok(top.indexOf("Glue") < top.indexOf(VERSION));
  const petAt = top.search(BLOCK);
  assert.ok(petAt >= 0 && petAt < top.indexOf("Glue"));
  assert.ok(top.indexOf(VERSION) < 40);
  assert.ok(lines.some((line) => line.includes("gpt-4o-mini")));
  assert.ok(lines.some((line) => line.includes("D:/work") && line.includes("main")));
  assert.ok(lines.some((line) => BLOCK.test(line[0] ?? "")));
  assert.doesNotMatch(frame, /✻/);
  assert.match(raw, /38;2;155;107;255/);
  view.unmount();

  const plain = render(createElement(Header, { theme, model: "gpt-4o-mini", cwd: "D:/work" }));
  const plainFrame = stripAnsi(plain.lastFrame() ?? "");
  assert.match(plainFrame, /D:\/work/);
  assert.doesNotMatch(plainFrame, /D:\/work\s+·/);
  plain.unmount();

  const light = render(
    createElement(Header, { theme: THEMES.light, model: "gpt-4o-mini", cwd: "~/src", branch: "main" }),
  );
  const lightRaw = light.lastFrame() ?? "";
  assert.match(lightRaw, /38;2;155;107;255/);
  assert.match(lightRaw, /48;2;250;250;249/);
  assert.match(stripAnsi(lightRaw), new RegExp(VERSION.replaceAll(".", "\\.")));
  light.unmount();
});
