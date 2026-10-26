import { chmodSync } from "node:fs";

// npm and npx launch the bin through a Node shim, so the executable bit is
// optional. Set it on Unix so `./dist/cli.js` works after a local build.
// Skip Windows: there is no chmod command, and the Unix bit is meaningless.
if (process.platform !== "win32") {
  chmodSync(new URL("../dist/cli.js", import.meta.url), 0o755);
}
