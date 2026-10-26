# Contributing

Thanks for helping Glue Cli. The project is an original MIT terminal agent. Keep changes small, and do not add domain-specific logic to the core. Put that in a profile `PROMPT.md`.

## 开发

需要 Node.js 20 或更新版本。

```bash
npm install
npm test
npm run typecheck
npm run dev -- --help
```

`npm test` 覆盖配置、路径沙箱、编辑、权限，以及一次对 `scripts/mock-openai.mjs` 的打印模式运行。交互界面改动请在真实终端里看一眼：`npx glue`（或 `npm run dev`）。

## What to change

- Bug fixes and tests belong together. A regression test is enough when the behavior is already specified.
- New tools should stay inside the workspace sandbox. Shell stays off unless the user turns it on.
- User-facing copy can be English. The README stays bilingual (Chinese first, then a shorter English section).
- Do not commit API keys, session logs, or `.agent/sessions/`.

## Pull requests

1. Fork the repo and branch from `main`.
2. Run `npm test` and `npm run typecheck`.
3. Describe what changed and how you checked it.
4. Open the PR against https://github.com/Zeuss64/glue-cli.

## 行为准则

参与讨论和代码审查时请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。安全问题不要开公开 issue，见 [SECURITY.md](SECURITY.md)。
