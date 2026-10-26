# Glue Cli

[![CI](https://github.com/Zeuss64/glue-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Zeuss64/glue-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)

Glue Cli（命令 `glue`）是一个 MIT 许可的终端编码代理。它在当前项目里读文件、搜索、按你的确认改代码。交互接近公开文档里的 Claude Code：流式回复、`⏺` / `⎿` 工具行、斜杠命令、权限确认，以及 Shift+Tab 切换权限模式。

实现是独立编写的，可接 OpenAI Chat Completions 或 Anthropic Messages API。领域逻辑放在 profile 里。英文速览在[文末](#english)。

## 安装

需要 Node.js 20 或更新版本。

```bash
npm install
npm run build
npx glue --help
```

开发时可以不先构建：`npm run dev -- --help`。`npx glue doctor` 检查本机配置。

## 环境变量

优先级：命令行参数 > 环境变量 > 项目配置 > `~/.glue/config.toml` > 默认值。

| 变量 | 作用 |
| --- | --- |
| `GLUE_API_KEY`，其次 `AGENT_API_KEY`，其次 `OPENAI_API_KEY` | API 密钥 |
| `GLUE_BASE_URL`，其次 `AGENT_BASE_URL`，其次 `OPENAI_BASE_URL` | 接口根地址，默认 `https://api.openai.com/v1` |
| `GLUE_PROTOCOL`，其次 `AGENT_PROTOCOL` | `openai` 或 `anthropic`。省略时按 URL 推断 |
| `GLUE_MODEL`，其次 `AGENT_MODEL`，其次 `OPENAI_MODEL` | 模型名，默认 `gpt-4o-mini` |
| `GLUE_PERMISSION_MODE` | `default`、`acceptEdits`、`plan`、`dontAsk`、`bypassPermissions` |
| `GLUE_PROFILE` | profile 名称，默认 `default` |
| `GLUE_SHELL` | `1` / `true` 时打开 Bash 工具。默认关闭 |

项目配置按这个顺序查找：`.agent/config.toml`、`.agent/config.json`、`agent.config.json`。

```toml
model = "gpt-4o-mini"
base_url = "https://api.openai.com/v1"
permission_mode = "default"
profile = "default"

[shell]
enabled = false
```

首次进入对话（交互会话或 `glue -p`）时，如果还没有用户配置，会创建它并立刻按里面的默认值加载。路径是 `~/.glue/config.toml`；Windows 上是 `%USERPROFILE%\.glue\config.toml`。已有文件不会被覆盖。

这份文件对所有项目生效，所以 `model`、`base_url`、`protocol` 写一次即可，不必每次再 export。密钥优先放在环境变量里。也可以在该文件里取消 `api_key` 那一行的注释，只保存在这台机器上。不要把密钥写进项目配置再提交。自动创建的文件只放注释占位，不会写入当前环境里的密钥。

`protocol` 也可以写在配置里，或用 `--protocol`。未指定时：主机名是 `api.anthropic.com`（或 `*.anthropic.com`），或路径以 `/messages` 结尾，用 Anthropic；路径含 `/chat/completions` 用 OpenAI；其余默认 OpenAI。

| 协议 | `base_url` |
| --- | --- |
| OpenAI | `https://api.openai.com/v1`（补上 `/chat/completions`），或完整的 `…/chat/completions` |
| Anthropic | `https://api.anthropic.com` 或 `…/v1`（补上 `/v1/messages` 或 `/messages`），或完整的 `…/v1/messages` |

Anthropic 请求使用 Messages API：`x-api-key`、`anthropic-version: 2023-06-01`，以及 `Authorization: Bearer`。

## 交互会话

在项目根目录启动：

```bash
export GLUE_API_KEY="sk-..."
npx glue
```

提示符接受普通问题。常用按键：

- Enter 发送，`\` + Enter 换行
- Backspace 删上一个字（中文和 emoji 一次删完），Delete 删光标后面的字。Shift+方向键先选中，再按 Backspace 或 Delete 删掉选区
- Shift+Tab 循环权限：`⏸ manual mode on` → `⏵⏵ accept edits on` → `⏸ plan mode on`（若启动时允许 bypass，还会进入 `⏵⏵ bypass permissions on`）
- Esc 中断当前回合，或拒绝权限框
- Ctrl+C 先清空输入，再按一次退出；Ctrl+D 在空输入上按两次退出
- `?` 打开快捷键，`/` 打开命令菜单
- `@路径` 把文件附到这条消息上（同时视为已读，之后可以编辑）
- `!命令` 在本机直接跑一条 shell（需要先打开 shell）
- `# 笔记` 追加到 `AGENT.md`

工具调用形如：

```text
⏺ Edit(src/app.ts)
  ⎿  Updated src/app.ts with 2 additions and 1 removal
```

改文件前必须先读过该文件。`edit_file` 用精确的 `old_string` 替换，默认只能命中一次。写入限制在工作区（以及 `--add-dir` / `/add-dir` 增加的根）内。`.git/**` 和 `.agent/sessions/**` 始终拒绝。

会话记在 `.agent/sessions/`。在对话里恢复：

- `/resume` 打开会话选择器，列出最近的其它会话。方向键移动，输入文字过滤，回车恢复，Esc 取消。当前会话，以及没有消息也没有名字的会话，不在列表里。
- `/resume <session-id>` 立刻恢复该会话。id、名称，或唯一前缀都可以；前缀不唯一时仍打开选择器。

从 shell 启动时，`glue -c` 继续最近一次会话，`glue --resume <id>` 恢复指定 id。日常恢复用对话里的 `/resume`。

窗口模式和全屏（Alt+Enter）都按当前可见行列排版。画面比终端少一行，长输出只保留末尾，输入条不缩小。Windows Terminal 用 VT 序列（Backspace 常是 `\x7f`）。旧版 cmd.exe 还可能送来 `\x08` 和 `\x00` / `\xE0` 扫描码，两种都识别。不进入备用屏幕。改界面前读 [docs/tui-hacking.md](docs/tui-hacking.md)。

## 权限

| 模式 | 行为 |
| --- | --- |
| `default`（界面上的 manual） | 读和只读 shell 自动允许；改文件和其他命令要确认 |
| `acceptEdits` | 自动允许 Edit / Write，以及 mkdir、touch、cp、mv |
| `plan` | 只读。模型用 `exit_plan_mode` 提交计划，你同意后切到 accept edits |
| `dontAsk` | 原本要问的操作改为拒绝 |
| `bypassPermissions` | 跳过确认。仍遵守 deny 规则和受保护路径。需要 `--allow-dangerously-skip-permissions`，或用 `--dangerously-skip-permissions` / `--yes` 直接进入 |

确认框：Yes；Yes, and don't ask again（记在本次会话）；No, and tell Glue what to do differently。

规则形如 `Edit(src/app.ts)`、`Bash(npm test *)`、`Read(**/.env)`。`前缀 *`（星号前有空格）匹配该前缀或前缀加参数。

```bash
npx glue --allowedTools "Bash(npm test *)"
/permissions allow Edit(src/**)
/permissions deny Read(**/.env)
/permissions mode plan
```

Shell 默认关闭。`shell.enabled = true` 或 `GLUE_SHELL=1` 后再使用。

## 斜杠命令

`/help` 列出可用命令。常用：`/clear`、`/compact`、`/model`、`/permissions`、`/plan`、`/status`、`/diff`、`/review`、`/resume`、`/init`（起草 `AGENT.md`）、`/memory`、`/config`、`/doctor`、`/add-dir`、`/theme`、`/vim`、`/rewind`、`/export`、`/bug`。

`/resume` 不带参数打开会话选择器；带 session id 则立刻恢复。`/login`、`/mcp`、`/ide`、`/plugin` 在这个版本里会说明不可用。

回合进行中，`/status`、`/cost`、`/help`、`/model`、`/permissions`、`/theme`、`/exit` 会立刻执行，其它命令排队。

## Profile

```bash
npx glue --profile default
```

Prompt 文件：包内 `profiles/<name>/PROMPT.md`，以及项目 `.agent/profiles/<name>/PROMPT.md`（排在前面）。`profiles/cpld/` 只有说明，没有 `PROMPT.md`，`--profile cpld` 不会注入领域规则。

## 本地 mock

贡献者可以不起外网，用仓库里的假服务看一轮对话：

```bash
npm run mock
GLUE_API_KEY=test GLUE_BASE_URL=http://127.0.0.1:8787/v1 GLUE_MODEL=mock npx glue
```

## 测试

```bash
npm test
npm run typecheck
```

覆盖配置优先级、路径沙箱、`edit_file`、权限规则、SSE 客户端、代理循环和斜杠命令。

## English

Glue Cli (`glue`) is an MIT-licensed terminal coding agent. It streams replies, prints tool calls as `⏺` / `⎿`, confirms mutations, and cycles permission modes with Shift+Tab. The client speaks OpenAI Chat Completions or the Anthropic Messages API. The code is an original implementation.

```bash
npm install && npm run build
export GLUE_API_KEY="sk-..."   # or AGENT_API_KEY / OPENAI_API_KEY
npx glue
npx glue doctor
npm test && npm run typecheck
```

The first interactive session or `glue -p` run creates the user config if it is missing, then loads it. The path is `~/.glue/config.toml` (`%USERPROFILE%\.glue\config.toml` on Windows). An existing file is left unchanged. `model`, `base_url`, and `protocol` in that file apply to every later `glue` session, in any project, without exporting them again. Prefer `GLUE_API_KEY`, `AGENT_API_KEY`, or `OPENAI_API_KEY` for the key. You can also uncomment `api_key` in the user file for this machine only. Do not commit a key in project config. The generated file has a commented placeholder and does not copy a key out of the environment.

Set `GLUE_BASE_URL` and `GLUE_MODEL` for a gateway. `GLUE_PROTOCOL=openai` posts to `…/chat/completions` (`https://host/v1` or a full chat completions URL). `GLUE_PROTOCOL=anthropic` posts to `…/v1/messages` (`https://api.anthropic.com`, a `/v1` root, or a full messages URL) with `x-api-key`, `anthropic-version: 2023-06-01`, and `Authorization: Bearer`. A URL on `*.anthropic.com` or ending in `/messages` selects Anthropic when the protocol is omitted; anything else stays OpenAI. Shell stays off until `GLUE_SHELL=1` or `shell.enabled = true`. File tools stay inside the workspace.

Windowed and fullscreen consoles both use the visible rows and columns. The frame is one row shorter than the terminal, long output is tailed, and the prompt does not shrink. Windows Terminal sends VT sequences (Backspace is often `\x7f`). Legacy cmd.exe may also send `\x08` and `\x00` / `\xE0` scan codes; both are accepted. The alternate screen stays off. Agents changing the interface should follow [docs/tui-hacking.md](docs/tui-hacking.md).

Sessions live in `.agent/sessions/`. In the REPL, `/resume` opens a picker of other recent sessions (arrow keys, type to filter, Enter to resume, Esc to cancel). The current session and empty unnamed ones stay off that list. `/resume <session-id>` resumes that session immediately; a unique id, name, or prefix is enough, and an ambiguous prefix opens the picker. From the shell, `glue -c` continues the newest session and `glue --resume <id>` resumes one id.

Profiles are `PROMPT.md` files. `cpld` is an empty stub so the core stays domain-agnostic. Contributors can run `npm run mock` and point `GLUE_BASE_URL` at `http://127.0.0.1:8787/v1`.

## Project

- [TUI hacking](docs/tui-hacking.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE) (MIT)
- Issues: https://github.com/Zeuss64/glue-cli/issues
