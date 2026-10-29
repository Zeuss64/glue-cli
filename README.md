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

## Profile

普通安装使用 `profile = "default"`。它从 `profiles/default/PROMPT.md` 加载 CPLD 系统提示 v0.5。`profiles/cpld` 是同一份提示，`glue --profile cpld` 与默认相同。查找顺序见 [profiles/README.md](profiles/README.md)。

## 命令

- `/model` 和 Alt+P 打开同一个界面。有 `models` 时用配置里的那些 id，当前 `model` 放在第一位，同一个 id 只出现一次。没写 `models` 时只显示当前模型，不会带上无关的内置 id。界面分四层：标题、编号列表、effort、底部提示。当前模型带绿色 `✓`，焦点行是 `>`。说明文字在右侧同一列。effort 单独一行，`←/→` 只写在这一行。`Enter to select · Esc to cancel` 在再下一行。`/model <id>` 直接切换，不打开列表。Alt+P 不清掉正在输入的草稿。
- `/effort` 回车打开居中的滑条。一条细轨道，`Faster` 和 `Smarter` 在轨道两侧，档名在轨道下面。`▲` 在当前档的正上方，只有这一档上色：low 黄、medium 绿、high 青、xhigh 紫字带白色扫光、max 保持彩色闪动。右边是紫色的 `Ultracode on/off`，Tab 切换，不改档位。打开时文案是 `Ultracode: dynamic workflows on every task`。开关打开时系统提示用同一句，要求每个任务拆成步骤并优先用 `spawn_subagent` 分派；关掉后下一轮不再带这句，也不再提供该工具。`/effort ultracode` 只开这个开关，`/effort ultracode off` 关掉，都保留当前档。没有「仅本次会话」的第二套保存。`/effort <level>` 直接设置，`/effort status` 打印当前档位。默认页脚只留模式和 `shift+tab`，不再画路径、模型、tokens、ctx、cache。自定义 `~/.glue` 状态栏仍画在这行上面。Anthropic 在非 auto 时发送 `output_config.effort`。OpenAI Chat Completions 不附带该字段。`GLUE_EFFORT=ultracode` 启动时档位是 `max` 且开关打开。
- 鼠标滚轮或 PgUp 看更早的对话，PgDn 回到最新。停在最新一行时，新输出仍跟着底部。提示是 `wheel or pgup for earlier`，Windows 右侧滚动条不会跟着走。
- `/resume` 打开其它近期会话。`/resume <id>` 直接恢复。`glue -c` 继续最近一次。
- `/goal <一句话>` 记下当前目标，写入会话和 `.agent/ui.json`。`/goal clear` 清除。
- `/auto on` 进入 auto：低风险的读、改和本地命令直接执行，`rm -rf`、联网安装、提权仍会询问。`/auto off` 回到 manual。Shift+Tab 顺序是 plan → manual → accept → auto → YOLO。YOLO 自动批准操作，不再询问。默认是 manual。页脚显示当前模式。
- `/statusline` 在全局 `~/.glue/` 生成状态栏脚本（不是项目目录）。无参数时默认显示模型和上下文占用百分比；也可以用一句话描述，例如 `/statusline show model name and context percentage with a progress bar`。`/statusline clear`（或 `delete` / `remove`）去掉自定义状态栏。Glue 把会话 JSON 从 stdin 传给脚本，把 stdout 画在页脚上方。脚本没有可见输出时不留空行。
- `/skill` 在 TUI 里打开选择器（↑↓ 选择，输入按 id、名称、描述过滤，Enter 加载，Tab 填入 `/skill <id>`，Esc 关闭）。打印模式仍输出文本列表。`/skill <name>` 加载并执行。技能文件是 `.glue/skills/<name>/SKILL.md`、`.agent/skills/<name>/SKILL.md` 或 `~/.glue/skills/<name>/SKILL.md`。
- `/plugin load <目录>` 把本地技能库接到当前项目。`/plugin install <owner/repo>` 从 GitHub 安装到 `~/.glue/plugins`。只读取 `SKILL.md`，不执行插件里的其它程序。
- `/help` 打开一页命令，不再把整表重复追加到对话里。`/login`、`/mcp` 这类不可用命令只提示一行。
- Tab 按前缀补全 `/` 命令和技能。同名时命令优先，技能仍可用完整 id。`/skill ` 之后按 id 前缀循环，`/plugin remove ` 补全已安装插件名。多个匹配时循环，并和高亮的是同一行。Shift+Tab 仍切换权限。
- 退出时清掉最后一帧，避免橙色输入框留在 cmd 提示符上。窗口变大或变小时按新的行列重画整帧。

Shift+Tab 按 plan → manual → accept → auto → YOLO 循环。默认是 manual，改文件前会确认。界面改动见 [docs/tui-hacking.md](docs/tui-hacking.md)。

```bash
npm test
npm run typecheck
```

## English

Coding agent for CPLD. `glue` is an MIT-licensed terminal agent. It speaks OpenAI Chat Completions or the Anthropic Messages API.

`npm run install:global` builds and runs `npm install -g .`. On Windows, use that command: it no longer calls `spawnSync` on `npm.cmd` (that returned EINVAL). If it still fails, run `npm install -g .` after `npm run build`. `glue.cmd` is in the directory `npm prefix -g` prints; add that directory to the user Path if needed (`%USERPROFILE%\npm-global` when the default prefix is not writable). The first session creates `~/.glue/config.toml` when it is missing and does not write an API key. Set `GLUE_API_KEY` (or `AGENT_API_KEY` / `OPENAI_API_KEY`).

### Profile

A normal install uses `profile = "default"`. That loads the CPLD system prompt v0.5 from `profiles/default/PROMPT.md`. `profiles/cpld` has the same prompt, so `glue --profile cpld` matches the default. Lookup order is in [profiles/README.md](profiles/README.md).

`/model` and Alt+P open the same four-layer screen: title, numbered list, effort row, then `Enter to select · Esc to cancel`. With `models` set, those ids are listed, current model first, each id once. With no `models` list, only the current `model` is shown, not unrelated built-in ids. One `base_url` and key can serve several models: set `models = ["id-a", "id-b"]`. The current model has a green `✓`, the focused row is `>`, and descriptions share the right-hand column. `←/→` change effort on that row only. `/model <id>` switches without opening the list. Alt+P leaves the draft in place.

`/effort` opens a centered slider: a thin track with `Faster` and `Smarter` on the sides and the level names underneath. `▲` sits above the current stop, the only one in color (low yellow, medium green, high cyan, xhigh purple with a white sweep, max keeps shifting). Purple `Ultracode on/off` is on the right; Tab toggles it and does not change the level. While it is on, the system prompt uses `Ultracode: dynamic workflows on every task` and prefers `spawn_subagent`; turning it off drops both on the next turn. `/effort ultracode` and `/effort ultracode off` flip only that switch and keep the level. There is no second, session-only save. `/effort <level>` sets a level directly, and `/effort status` prints the current one. The default footer shows only the mode and `shift+tab`; a custom `~/.glue` status line still draws above it. Anthropic sends `output_config.effort` except for auto; OpenAI Chat Completions do not. `GLUE_EFFORT=ultracode` starts at `max` with the switch on.

`/goal` keeps a persistent goal. Shift+Tab cycles plan → manual → accept edits → auto → YOLO, and a new session starts in manual. `/auto on` is that auto mode: low-risk tools pass and high-risk shell (recursive delete, network install, privilege escalation) still asks. YOLO approves every operation with no prompt. The footer shows the active mode. `/auto off` returns to manual. `/statusline` generates a command script under `~/.glue/` (see `~/.glue/settings.json`) from a short description, or with no args for model + context %. Glue feeds the script JSON on stdin and renders stdout above the built-in footer. Empty or color-only stdout does not leave a blank row. `/statusline clear` removes it. `/skill` opens a picker in the TUI (arrows, type to filter, Enter loads, Tab fills `/skill <id>`, Esc closes) and still prints the list outside the TUI. `/skill <name>` loads one. `/plugin load` attaches a local skill folder, and `/plugin install owner/repo` clones a GitHub skill library. `/help` is a paged panel; unavailable commands such as `/login` print one line. Tab completes slash commands and skills by prefix. A command wins when a skill shares its name; that skill stays available as its full id. After `/skill `, Tab cycles skill ids, and `/plugin remove ` completes installed plugin names. The highlighted row is the one Tab fills. The mouse wheel and PgUp scroll inside the transcript; the host scrollbar does not. PgDn returns to the latest line. Resize repaints the frame from the new stdout size, and exit erases it so cmd's prompt is not covered. See [docs/tui-hacking.md](docs/tui-hacking.md).
