#!/usr/bin/env node
// Install the `glue` bin onto the npm global prefix so it runs from any directory.
// Windows shims live in the prefix itself (`npm prefix -g`). Unix shims live in `<prefix>/bin`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function npmBinName(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

/** Directory that must be on PATH for the `glue` command. */
export function globalBinDir(prefix, platform = process.platform) {
  const root = String(prefix ?? "").trim();
  if (!root) throw new Error("npm prefix -g returned an empty path");
  if (platform === "win32") return root;
  return path.posix.join(root, "bin");
}

export function pathAdvice(binDir, platform = process.platform) {
  if (platform === "win32") {
    return [
      "The glue command is `glue.cmd` in this directory (the npm prefix, not a bin subfolder):",
      binDir,
      "",
      "Add it to the user Path if a new terminal cannot find glue. `npm prefix -g` prints the directory.",
      "This does not copy anything onto a fixed drive or into Program Files.",
      "",
      "PowerShell:",
      "  $prefix = (npm prefix -g).Trim()",
      "  $user = [Environment]::GetEnvironmentVariable('Path', 'User')",
      "  if ($user -notlike \"*$prefix*\") { [Environment]::SetEnvironmentVariable('Path', \"$user;$prefix\", 'User') }",
      "",
      "If npm install -g is denied, point the prefix at your profile and run npm run install:global again:",
      "  npm config set prefix %USERPROFILE%\\npm-global",
      "Then add %USERPROFILE%\\npm-global to the user Path.",
    ].join("\n");
  }
  return [
    "The glue command is in this directory:",
    binDir,
    "",
    "Add it to PATH if a new terminal cannot find glue:",
    '  export PATH="$(npm prefix -g)/bin:$PATH"',
    "",
    "If that prefix is not writable, install under your home directory instead:",
    '  npm config set prefix "$HOME/.local"',
    '  export PATH="$HOME/.local/bin:$PATH"',
    "  npm run install:global",
  ].join("\n");
}

export function queryNpmPrefix(platform = process.platform) {
  const result = spawnSync(npmBinName(platform), ["prefix", "-g"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "npm prefix -g failed").trim());
  }
  return result.stdout.trim();
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    printBin: false,
    printNpm: false,
    explain: false,
    platform: process.platform,
    prefix: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--dry-run") out.dryRun = true;
    else if (token === "--print-bin") out.printBin = true;
    else if (token === "--print-npm") out.printNpm = true;
    else if (token === "--explain") out.explain = true;
    else if (token === "--platform") {
      out.platform = argv[++i];
      if (!out.platform) throw new Error("--platform needs a value");
    } else if (token === "--prefix") {
      out.prefix = argv[++i];
      if (out.prefix === undefined) throw new Error("--prefix needs a value");
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return out;
}

function explain(platform, prefix) {
  const binDir = globalBinDir(prefix, platform);
  console.log(`bin: ${binDir}`);
  console.log(pathAdvice(binDir, platform));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.printNpm) {
    console.log(npmBinName(args.platform));
    return;
  }
  if (args.explain) {
    explain(args.platform, args.prefix);
    return;
  }
  const prefix = queryNpmPrefix();
  const binDir = globalBinDir(prefix);
  if (args.printBin) {
    console.log(binDir);
    return;
  }
  console.log(`npm install -g .`);
  console.log(`bin: ${binDir}`);
  if (args.dryRun) {
    console.log(pathAdvice(binDir));
    return;
  }
  const built = path.join(packageRoot(), "dist", "cli.js");
  if (!existsSync(built)) {
    throw new Error("dist/cli.js is missing. Run npm run build first.");
  }
  const install = spawnSync(npmBinName(), ["install", "-g", ".", "--no-fund", "--no-audit"], {
    cwd: packageRoot(),
    stdio: "inherit",
  });
  if (install.error) throw install.error;
  if (install.status !== 0) process.exit(install.status ?? 1);
  console.log("Installed glue. Open a new terminal and run: glue --version");
  console.log(pathAdvice(binDir));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`glue install: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
