#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs, cliHelp } from "./args.js";
import { loadConfig } from "./config.js";
import { diagnose, formatDoctor } from "./doctor.js";
import { runPrint } from "./print.js";
import { findSessionFile, latestSessionFile, loadSession } from "./session.js";
import type { ChatMessage } from "./types.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`glue: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Try glue --help");
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(cliHelp());
    return;
  }
  if (args.version) {
    console.log(`glue ${VERSION}`);
    return;
  }
  const cwd = path.resolve(args.cwd ?? process.cwd());
  if (args.cwd) {
    if (!existsSync(cwd)) {
      console.error(`glue: directory does not exist: ${cwd}`);
      process.exitCode = 1;
      return;
    }
    process.chdir(cwd);
  }
  let config;
  try {
    config = loadConfig({
      cwd,
      model: args.model,
      baseURL: args.baseURL,
      protocol: args.protocol,
      permissionMode: args.permissionMode,
      profile: args.profile,
      configPath: args.configPath,
      allowedTools: args.allowedTools,
    });
  } catch (error) {
    console.error(`glue: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  if (args.doctor) {
    console.log(formatDoctor(diagnose(config)));
    return;
  }

  let resumeFile: string | undefined;
  if (args.resume) {
    resumeFile = findSessionFile(cwd, args.resume);
    if (!resumeFile) {
      console.error(`glue: no session matches ${args.resume}`);
      process.exitCode = 1;
      return;
    }
  } else if (args.continueSession) {
    resumeFile = latestSessionFile(cwd);
    if (!resumeFile) {
      console.error("glue: no session to continue");
      process.exitCode = 1;
      return;
    }
  }

  let prompt = args.prompt ?? "";
  if (!prompt && !process.stdin.isTTY && (args.print || !process.stdout.isTTY)) {
    prompt = (await readStdin()).trim();
  }
  const printMode = args.print || (!process.stdout.isTTY && Boolean(prompt));
  if (printMode) {
    if (!prompt) {
      console.error("glue: print mode needs a prompt. Example: glue -p \"summarize this repo\"");
      process.exitCode = 1;
      return;
    }
    let messages: ChatMessage[] | undefined;
    if (resumeFile) {
      const snap = loadSession(resumeFile);
      messages = snap.messages.filter((message) => message.role !== "system");
    }
    process.exitCode = await runPrint({
      config,
      prompt,
      output: args.output,
      messages,
    });
    return;
  }
  if (!process.stdin.isTTY) {
    console.error("glue: no terminal attached. Use glue -p \"...\" for print mode.");
    process.exitCode = 1;
    return;
  }
  const { startTui } = await import("./tui/app.js");
  await startTui({
    config,
    initialPrompt: prompt || undefined,
    resumeFile,
    openResume: args.openResume,
    includeBypass: args.allowBypass || config.permissionMode === "bypassPermissions",
    addDirs: args.addDir,
    appendSystem: args.appendSystem,
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

main().catch((error: unknown) => {
  console.error(`glue: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
