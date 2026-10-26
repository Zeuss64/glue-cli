import assert from "node:assert/strict";
import test from "node:test";
import { globMatch } from "../src/glob.js";

test("globs without a slash match in any directory", () => {
  assert.equal(globMatch("*.ts", "src/a.ts"), true);
  assert.equal(globMatch("src/*.ts", "src/a.ts"), true);
  assert.equal(globMatch("src/*.ts", "src/nested/a.ts"), false);
  assert.equal(globMatch("**/.env", ".env"), true);
  assert.equal(globMatch("src/**/*.ts", "src/nested/a.ts"), true);
});
