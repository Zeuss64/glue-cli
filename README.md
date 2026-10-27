# Glue Cli

[![CI](https://github.com/Zeuss64/glue-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Zeuss64/glue-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json)

用于 CPLD 的 coding agent。命令是 `glue`，MIT 许可。在当前项目里读文件、搜索，并在确认后改代码。可接 OpenAI Chat Completions 或 Anthropic Messages API。

## 安装

需要 Node.js 20 或更新版本。

```bash
git clone https://github.com/Zeuss64/glue-cli.git
cd glue-cli
npm install
npm run build
npm run install:global
glue --version
```

`npm run install:global` 会构建并执行 `npm install -g .`。卸掉：`npm uninstall -g glue-cli`。改这份仓库时先 `npm run build`，再 `npm link`（取消：`npm unlink -g glue-cli`）。

Windows 上的 `glue.cmd` 在 `npm prefix -g` 打印的目录里，不是 `bin`。新终端找不到命令时，把该目录加到用户 Path。PowerShell：`[Environment]::SetEnvironmentVariable('Path', "$user;$prefix", 'User')`。没有安装权限时：`npm config set prefix %USERPROFILE%\npm-global`，再把该目录加入用户 Path。其他系统的全局命令在 `$(npm prefix -g)/bin`；前缀不可写时用 `export PATH="$HOME/.local/bin:$PATH"`。不要把命令复制到固定盘符或 Program Files。

## 配置

优先级：命令行 > 环境变量（`GLUE_` > `AGENT_` > `OPENAI_`）> 项目 `.agent/config.toml` > `~/.glue/config.toml`（Windows：`%USERPROFILE%\.glue\config.toml`）> 默认值。

首次交互会话或 `glue -p` 会在用户配置不存在时创建它。已有文件不覆盖，也不会写入 API 密钥。密钥用 `GLUE_API_KEY`、`AGENT_API_KEY` 或 `OPENAI_API_KEY`。`model`、`base_url`、`protocol` 写在用户配置里之后，任意目录的 `glue` 都会用到。

```toml
model = "gpt-4o-mini"
base_url = "https://api.openai.com/v1"
# protocol = "openai"
# 同一个 base_url 和密钥可以列多个模型。/model 只显示这个列表。
# 不写 models 时，/model 只显示上面的 model。
# models = ["gpt-4o-mini", "gpt-4o"]
# effort = "auto"
```

`GLUE_PROTOCOL=openai` 走 `…/chat/completions`。`GLUE_PROTOCOL=anthropic` 走 `…/v1/messages`。Shell 默认关闭，`GLUE_SHELL=1` 或 `shell.enabled = true` 后再用。

## 命令

- `/model` 打开列表。有 `models` 时用配置里的那些 id，当前 `model` 放在第一位，同一个 id 只出现一次。没写 `models` 时只显示当前模型，不会带上无关的内置 id。↑↓ 移动，回车选定，Esc 取消。←→ 改 effort。`/model <id>` 直接切换，不打开列表。
- `/effort` 回车打开左右选择：low、medium、high、xhigh、max、auto。回车确认，Esc 取消。`/effort <level>` 直接设置，`/effort status` 打印当前档位。状态栏显示 `effort <level>`。Anthropic 在非 auto 时发送 `output_config.effort`。OpenAI Chat Completions 不附带该字段。
- 鼠标滚轮、PgUp、PgDn 可以翻回更早的对话。停在最新一行时，新输出仍跟着底部。
- `/resume` 打开其它近期会话。`/resume <id>` 直接恢复。`glue -c` 继续最近一次。

Shift+Tab 切换权限。改文件前会确认。界面改动见 [docs/tui-hacking.md](docs/tui-hacking.md)。

```bash
npm test
npm run typecheck
```

## English

Coding agent for CPLD. `glue` is an MIT-licensed terminal agent. It speaks OpenAI Chat Completions or the Anthropic Messages API.

`npm run install:global` builds and runs `npm install -g .`. On Windows, `glue.cmd` is in the directory `npm prefix -g` prints; add that directory to the user Path if needed (`%USERPROFILE%\npm-global` when the default prefix is not writable). The first session creates `~/.glue/config.toml` when it is missing and does not write an API key. Set `GLUE_API_KEY` (or `AGENT_API_KEY` / `OPENAI_API_KEY`).

`/model` lists `models` from config, with the current model first and each id once. If `models` is empty, the list is only `model`, not unrelated built-in ids. One `base_url` and key can serve several models: set `models = ["id-a", "id-b"]`. `/model <id>` sets an id directly. Left and right in the model picker change effort.

`/effort` opens a left/right picker for low, medium, high, xhigh, max, and auto. Enter sets the highlighted level. Esc cancels. `/effort <level>` still sets a level directly, and `/effort status` prints the current one.

The mouse wheel, PgUp, and PgDn scroll to earlier messages. The view stays on the latest line until you scroll. `/resume` opens the session picker. See [docs/tui-hacking.md](docs/tui-hacking.md).
