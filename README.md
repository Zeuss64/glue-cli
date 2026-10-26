# Glue Cli

[![CI](https://github.com/Zeuss64/glue-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Zeuss64/glue-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)

Glue Cli (`glue`) is an MIT-licensed terminal coding agent. It streams replies, shows tool calls, asks before it edits, and talks to any OpenAI-compatible chat API. The interaction follows the public Claude Code model. The code is an original implementation.

中文说明在下面。English quick start is at the [end](#english).

Glue Cli（命令 `glue`）是一个开源的终端编码代理。它在当前项目目录里读文件、搜索、按你的确认改代码，交互方式接近公开文档里的 Claude Code：流式回复、`⏺` / `⎿` 工具行、斜杠命令、权限确认，以及 Shift+Tab 切换权限模式。

实现是独立编写的 MIT 代码，面向 OpenAI 兼容的 Chat Completions 接口（OpenAI、DeepSeek、OpenRouter，或任何兼容网关）。领域逻辑放在 profile 里，核心不绑定某一类硬件或仓库。

## 安装

需要 Node.js 20 或更新版本。

```bash
npm install
npm run build
npx glue --help
```

开发时可以不先构建：

```bash
npm run dev -- --help
```

## 环境变量

优先级：命令行参数 > 环境变量 > 项目配置 > `~/.glue/config.toml` > 默认值。

| 变量 | 作用 |
| --- | --- |
| `GLUE_API_KEY`，其次 `AGENT_API_KEY`，其次 `OPENAI_API_KEY` | API 密钥 |
| `GLUE_BASE_URL`，其次 `AGENT_BASE_URL`，其次 `OPENAI_BASE_URL` | 接口根地址，默认 `https://api.openai.com/v1` |
| `GLUE_MODEL`，其次 `AGENT_MODEL`，其次 `OPENAI_MODEL` | 模型名，默认 `gpt-4o-mini` |
| `GLUE_PERMISSION_MODE` | `default`、`acceptEdits`、`plan`、`dontAsk`、`bypassPermissions` |
| `GLUE_PROFILE` | profile 名称，默认 `default` |
| `GLUE_SHELL` | `1` / `true` 时打开 Bash 工具。默认关闭 |

项目配置按这个顺序查找：`.agent/config.toml`、`.agent/config.json`、`agent.config.json`。

```toml
model = "deepseek-chat"
base_url = "https://api.deepseek.com/v1"
permission_mode = "default"
profile = "default"

[shell]
enabled = false
```

不要把密钥写进仓库。密钥放在环境变量里。

## 交互会话

在项目根目录启动：

```bash
export GLUE_API_KEY="sk-..."
npx glue
```

提示符接受普通问题。常用按键：

- Enter 发送，`\` + Enter 换行
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

改文件前必须先读过该文件。`edit_file` 用精确的 `old_string` 替换，默认只能命中一次。写入被限制在工作区（以及 `--add-dir` / `/add-dir` 增加的根目录）内，符号链接不能逃出这些根。`.git/**` 和 `.agent/sessions/**` 始终拒绝，包括 bypass。

一次示例：

```text
> 给 src/parse.ts 的 parseArgs 补上 --dry-run，并加上一个失败用例
⏺ Read(src/parse.ts)
  ⎿  Read 80 lines
⏺ Edit(src/parse.ts)
  ⎿  Updated src/parse.ts with 6 additions and 0 removals
已加上 --dry-run。解析到该参数时只打印计划，不写文件。
```

## 一次性运行

```bash
npx glue -p "用三句话说明这个仓库怎么测试"
npx glue run "列出 src 下的入口文件"
```

标准输入不是 TTY 时，也可以把提示从管道送进去。`--output-format json` 每行一个事件（`text-delta`、`tool`、`done`、`error`）。

打印模式不能弹出确认框。默认权限下，写文件会被拒绝。要让模型直接改文件：

```bash
npx glue -p "创建 notes.md，写上构建步骤" --permission-mode acceptEdits
```

继续上次会话：`glue -c` 或 `glue --resume <id>`。会话记在 `.agent/sessions/`。

## DeepSeek 与 OpenRouter

DeepSeek：

```bash
export GLUE_API_KEY="sk-..."
export GLUE_BASE_URL="https://api.deepseek.com/v1"
export GLUE_MODEL="deepseek-chat"
npx glue
```

OpenRouter：

```bash
export GLUE_API_KEY="sk-or-..."
export GLUE_BASE_URL="https://openrouter.ai/api/v1"
export GLUE_MODEL="openai/gpt-4o-mini"
npx glue
```

`base_url` 可以是根路径（自动补 `/chat/completions`），也可以已经是完整的 chat completions 地址。

## 本地 mock

不访问外网时，用仓库里的假服务看一轮写文件：

```bash
npm run mock
# 另一个终端
export GLUE_API_KEY="test"
export GLUE_BASE_URL="http://127.0.0.1:8787/v1"
export GLUE_MODEL="mock"
npx glue -p "create hello.txt" --permission-mode acceptEdits
```

`PORT=0 npm run mock` 会选一个空闲端口，并打印 `LISTENING <port>`。mock 第一次回复调用 `write_file` 写入 `hello.txt`（内容 `hello from glue`），第二次回复 `Created hello.txt`。

检查本机配置：

```bash
npx glue doctor
```

## 权限

| 模式 | 行为 |
| --- | --- |
| `default`（界面上的 manual） | 读和只读 shell 自动允许；改文件和其他命令要确认 |
| `acceptEdits` | 自动允许 Edit / Write，以及 mkdir、touch、cp、mv |
| `plan` | 只读。模型用 `exit_plan_mode` 提交计划，你同意后切到 accept edits |
| `dontAsk` | 原本要问的操作改为拒绝 |
| `bypassPermissions` | 跳过确认。仍遵守 deny 规则和受保护路径。需要 `--allow-dangerously-skip-permissions`，或用 `--dangerously-skip-permissions` / `--yes` 直接进入 |

确认框选项：Yes；Yes, and don't ask again（把规则记在本次会话）；No, and tell Glue what to do differently。

规则形如 `Edit(src/app.ts)`、`Bash(npm test *)`、`Read(**/.env)`。`前缀 *`（星号前有空格）匹配该前缀或前缀加参数。

```bash
npx glue --allowedTools "Bash(npm test *)"
# 会话中
/permissions allow Edit(src/**)
/permissions deny Read(**/.env)
/permissions mode plan
```

Shell 工具默认关闭，因为命令本身不受文件系统沙箱约束。在配置里设 `shell.enabled = true` 或 `GLUE_SHELL=1` 后再使用。`glue doctor` 会提醒这一点。

## 斜杠命令

`/help` 列出可用命令。常用的有 `/clear`、`/compact`、`/model`、`/permissions`、`/plan`、`/status`、`/diff`、`/review`、`/resume`、`/init`（起草 `AGENT.md`）、`/memory`、`/config`、`/doctor`、`/add-dir`、`/theme`、`/vim`、`/rewind`、`/export`、`/bug`。

`/login`、`/mcp`、`/ide`、`/plugin` 等在这个版本里会说明不可用，而不是假装连上了托管账号。

回合进行中，`/status`、`/cost`、`/help`、`/model`、`/permissions`、`/theme`、`/exit` 会立刻执行，其它命令排队。

## Profile

```bash
npx glue --profile default
```

Prompt 文件：

- 包内 `profiles/<name>/PROMPT.md`
- 项目 `.agent/profiles/<name>/PROMPT.md`（排在前面）

`profiles/cpld/` 只有说明，没有 `PROMPT.md`。`--profile cpld` 不会注入领域规则，等你以后把 prompt 放进去。

## 测试

```bash
npm test
npm run typecheck
```

覆盖配置优先级、路径沙箱、`edit_file`、权限规则、SSE 客户端、代理循环，以及一次对 mock 服务的 `glue -p` 运行。

## English

Glue Cli (`glue`) is an MIT-licensed terminal coding agent. It streams replies, prints tool calls as `⏺` / `⎿`, confirms mutations, and cycles permission modes with Shift+Tab. The client speaks OpenAI-compatible Chat Completions. It is an original implementation of that interaction model.

```bash
npm install && npm run build
export GLUE_API_KEY="sk-..."   # or AGENT_API_KEY / OPENAI_API_KEY
npx glue                       # REPL in the current directory
npx glue -p "summarize the repo"
npx glue doctor
npm test
```

Point it at another gateway with `GLUE_BASE_URL` and `GLUE_MODEL`:

- DeepSeek: `https://api.deepseek.com/v1`, model `deepseek-chat`
- OpenRouter: `https://openrouter.ai/api/v1`, model such as `openai/gpt-4o-mini`

Local mock, no network key required:

```bash
npm run mock
GLUE_API_KEY=test GLUE_BASE_URL=http://127.0.0.1:8787/v1 GLUE_MODEL=mock \
  npx glue -p "create hello.txt" --permission-mode acceptEdits
```

Print mode cannot ask. Pass `--permission-mode acceptEdits` or an allow rule before expecting writes. The shell tool stays off until `GLUE_SHELL=1` or `shell.enabled = true`. File tools stay inside the workspace and refuse symlink escapes. Profiles are `PROMPT.md` files; `cpld` is an empty stub so the core stays domain-agnostic.

## Project

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE) (MIT)
- Issues: https://github.com/Zeuss64/glue-cli/issues
