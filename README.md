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
# Windows 可用。仍失败时：npm install -g .
glue --version
```

`npm run install:global` 会构建并执行 `npm install -g .`。Windows 上也用这一条：不再对 `npm.cmd` 做无 shell 的 `spawnSync`（以前会 EINVAL）。仍失败时，在 `npm run build` 之后改跑 `npm install -g .`。卸掉：`npm uninstall -g glue-cli`。改这份仓库时先 `npm run build`，再 `npm link`（取消：`npm unlink -g glue-cli`）。

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
- 鼠标滚轮或 PgUp 看更早的对话，PgDn 回到最新。停在最新一行时，新输出仍跟着底部。提示是 `wheel or pgup for earlier`，Windows 右侧滚动条不会跟着走。
- `/resume` 打开其它近期会话。`/resume <id>` 直接恢复。`glue -c` 继续最近一次。
- `/goal <一句话>` 记下当前目标，写入会话和 `.agent/ui.json`。`/goal clear` 清除。
- `/auto on` 自动放行低风险的读、改和本地命令。`rm -rf`、越出工作区、联网安装、提权仍会询问。页脚在 `manual mode on` 和 `auto mode on` 之间切换。`/auto off` 回到手动。
- `/statusline` 选择输入框下的字段（tokens、effort、model、目标等）。`/statusline 设计` 用更完整的一行，`/statusline reset` 恢复默认。
- `/help` 打开一页命令，不再把整表重复追加到对话里。`/login`、`/mcp` 这类不可用命令只提示一行。
- Tab 按前缀补全 `/` 命令；多个匹配时循环，并高亮菜单。Shift+Tab 仍切换权限。
- 退出时清掉最后一帧，避免橙色输入框留在 cmd 提示符上。窗口变大或变小时按新的行列重画整帧。

Shift+Tab 切换权限。改文件前会确认。界面改动见 [docs/tui-hacking.md](docs/tui-hacking.md)。

```bash
npm test
npm run typecheck
```

## English

Coding agent for CPLD. `glue` is an MIT-licensed terminal agent. It speaks OpenAI Chat Completions or the Anthropic Messages API.

`npm run install:global` builds and runs `npm install -g .`. On Windows, use that command: it no longer calls `spawnSync` on `npm.cmd` (that returned EINVAL). If it still fails, run `npm install -g .` after `npm run build`. `glue.cmd` is in the directory `npm prefix -g` prints; add that directory to the user Path if needed (`%USERPROFILE%\npm-global` when the default prefix is not writable). The first session creates `~/.glue/config.toml` when it is missing and does not write an API key. Set `GLUE_API_KEY` (or `AGENT_API_KEY` / `OPENAI_API_KEY`).

`/model` lists `models` from config, with the current model first and each id once. If `models` is empty, the list is only `model`, not unrelated built-in ids. One `base_url` and key can serve several models: set `models = ["id-a", "id-b"]`. `/model <id>` sets an id directly. Left and right in the model picker change effort.

`/effort` opens a left/right picker for low, medium, high, xhigh, max, and auto. Enter sets the highlighted level. Esc cancels. `/effort <level>` still sets a level directly, and `/effort status` prints the current one.

`/goal` keeps a persistent goal. `/auto on` auto-approves low-risk tools and still asks for high-risk shell (recursive delete, network install, privilege escalation). `/statusline` picks the footer fields. `/help` is a paged panel; unavailable commands such as `/login` print one line. Tab completes slash commands by prefix. The mouse wheel and PgUp scroll inside the transcript; the host scrollbar does not. PgDn returns to the latest line. Resize repaints the frame from the new stdout size, and exit erases it so cmd's prompt is not covered. See [docs/tui-hacking.md](docs/tui-hacking.md).
