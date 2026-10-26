import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("README points at the TUI guide, and the guide names the current entry points", () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  const doc = readFileSync(path.join(root, "docs", "tui-hacking.md"), "utf8");
  assert.match(readme, /docs\/tui-hacking\.md/);
  assert.match(doc, /src\/tui\/app\.tsx/);
  assert.match(doc, /PromptBox/);
  assert.match(doc, /useConsoleInput/);
  assert.match(doc, /frameSize/);
  assert.match(doc, /There is no model picker/);
  assert.match(doc, /flexShrink=\{0\}/);
  assert.match(doc, /npm test/);
  assert.match(doc, /Windows Terminal/);
  assert.match(doc, /Legacy cmd\.exe/);
});
