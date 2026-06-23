# dotclaude-portable

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)](./VERSION)
[![CI](https://github.com/htmambo/dotclaude-portable/actions/workflows/ci.yml/badge.svg)](https://github.com/htmambo/dotclaude-portable/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/htmambo/dotclaude-portable)](https://github.com/htmambo/dotclaude-portable/releases)

便携式同步 `~/.claude/` 中"机器无关"的配置：纯文本规则、commit 模板、commands、skills，以及 3 个**不含 secret** 的 JSON 配置（含 `.mcp.json`）。换机器后 **clone + 一行命令** 即可恢复。

## 5 分钟上手

```bash
# 1. 拉仓库
git clone <your-remote>/dotclaude-portable.git
cd dotclaude-portable

# 2. 先 dry-run
./install.sh --dry-run

# 3. 真安装
./install.sh
./install.sh --force      # 强制覆盖
./install.sh --copy       # 拷贝模式（Windows 兜底）

# 4. 验证
./install.sh --check
./install.sh doctor       # secret 扫描

# 5. 跨机器补全
./install.sh install-statusline   # 把 ccstatusline-zh 注入本机 settings.json
./install.sh install-memory-mcp   # 修复 MCP memory 持久化路径
./install.sh install-coding-bridge-mcp  # 验证 coding-bridge MCP（External Review）
./scripts/setup-plugins.sh        # 装 3 marketplace + 7 plugin
```

卸载 / 回滚：

```bash
./install.sh --uninstall  # 或 ./uninstall.sh
./install.sh --rollback 1 # 1=最新，2=上一个，3=再上一个
```

## 已有 dotclaude-portable 的机器,`git pull` 后

绝大多数情况 `git pull` 后 **symlink 自动同步**,无需重跑 install.sh：

```bash
cd ~/path/to/dotclaude-portable
git pull
./install.sh --check           # 3 秒,确认 symlink 健在
```

**仅在以下情况手动补**:

| 情况 | 命令 | 何时 |
|---|---|---|
| 新机器首次 | `./install.sh` | clone 后首次 |
| CLAUDE.md 被 OMC 改 | `./install.sh --force` | `omc-setup` / `omc-doctor` 后 |
| 升级本机 pre-commit hook | `./install.sh install-pre-sync-docs-hook` | sync-docs.mjs 升级后首次 pull |
| 重装 secret 扫描 hook | `./install.sh install-pre-push` | pre-push 被破坏后 |

注：`scripts/setup-plugins.sh` 仅在新机器或新增 plugin 时跑,日常 pull 不需要。

## ⚠️ 已知冲突：OMC 与本仓库的 `CLAUDE.md`

**问题**：`oh-my-claudecode` (OMC) 的 `omc-setup` / `omc-doctor` / 某些 slash command 会**直接 patch `~/.claude/CLAUDE.md`**（用 OMC 自己的模板覆盖）。本仓库把 `~/.claude/CLAUDE.md` 当作 `global/CLAUDE.md` 的 symlink 托管 —— **OMC 会把 symlink 替换成普通文件，覆盖你的全局指令**。

**冲突表现**：
- symlink 被破坏（OMC 写文件时删了 symlink）
- 本机 `~/.claude/CLAUDE.md` 不再跟仓库同步
- `git pull` 后 symlink 重建，**会丢失 OMC 注入的额外规则**

**解决方案**：

```bash
# 1. 先 install（建立 symlink）再装 OMC，让 OMC 知道"这个文件已托管"
./install.sh
./scripts/setup-plugins.sh        # 这一步会装 oh-my-claudecode

# 2. OMC 装完后如果 symlink 被破坏：
./install.sh --force               # 重建 symlink
git diff ~/.claude/CLAUDE.md       # 检查是否丢了内容

# 3. 想知道 OMC 装完后改了哪些文件：
./install.sh --check               # symlink 健康巡检
```

**经验法则**：
- **先 `install.sh` → 再 `setup-plugins.sh`**（顺序不能反）
- 装完 OMC 之后**立即** `./install.sh --check` 验证 symlink 健在
- 不要直接编辑 `~/.claude/CLAUDE.md`（它是 symlink，本地编辑会落到 symlink 自身，git pull 后丢失）
- 想编辑全局指令 → 改仓库 `global/CLAUDE.md` → `git push` → 跨机器自然同步

**对比 superpowers**：superpowers 极简（14 skill, 2.4 MB，**不**改 `CLAUDE.md`），无此问题。详见 [`docs/Analysis/SUPERPOWERS_VS_OMC.md`](./docs/Analysis/SUPERPOWERS_VS_OMC.md)。

## 同步范围（清理后）

| 仓库路径 | 落点（相对 `~/.claude/`） | 类型 |
|---|---|---|
| `global/CLAUDE.md` | `CLAUDE.md` | symlink |
| `global/COMMIT_TEMPLATE.md` | `COMMIT_TEMPLATE.md` | symlink |
| `global/json/execution_config.base.json` | `execution_config.json` | 渲染 cp（仅本机无时） |
| `global/json/mcp.base.json` | `.mcp.json` | 渲染 cp（`${HOME}` 占位） |
| `global/json/.omc-version.base.json` | `.omc-version.json` | 渲染 cp |
| `commands/fix-permissions.md` | `commands/fix-permissions.md` | symlink |
| `commands/fullauto-prune.md` | `commands/fullauto-prune.md` | symlink |
| `skills/fullauto/SKILL.md` | `skills/fullauto/SKILL.md` | symlink |
| `global/json/settings.statusline.base.json` | 合并到 `settings.json` 的 `statusLine` 字段 | `install-statusline` 子命令 |
| `hooks/review-watchdog.mjs` | `hooks/review-watchdog.mjs` | symlink（`HOOK_FILES` 动态扫描，新增 hook 丢进 `hooks/` 即可自动部署） |
| `hooks/guard-read-size.mjs` | `hooks/guard-read-size.mjs` | symlink（PreToolUse:Read — 超 2MB 媒体/5MB 文本自动 deny，避免撑爆 32MB 请求体） |
| `hooks/warn-context.mjs` | `hooks/warn-context.mjs` | symlink（UserPromptSubmit — transcript 24/28/30 MB 三档预警 systemMessage） |

### 6 个 MCP（`global/json/mcp.base.json`）

- `context7` / `filesystem` / `mcp-deepwiki` / `memory` / `coding-bridge` / **`kimi`（fallback）**
- 前 4 个用 `npx -y <pkg>` 启动；**`coding-bridge` + `kimi` 是 Python 项目**，需先装 `uvx`（`curl -LsSf https://astral.sh/uv/install.sh | sh`）
- **关键**：Claude Code 真正加载 MCP server 是从 `~/.claude.json` 的 `mcpServers` 字段（不是 `~/.claude/.mcp.json`——后者是 OMC 等工具读的，不被 Claude Code 加载）
- **CLAUDE.md fallback 链**：`coding-bridge → kimi`（CLAUDE.md §"Hard-coded fallback"）。coding-bridge 失败时 Claude 自动用 `mcp__kimi__kimi` 兜底
- **必设环境变量**（仅 coding-bridge）：`export CODING_BRIDGE_API_KEY=<your-key>`（写到 `~/.zshrc`）；`kimi` 自动读 `~/.claude/kimi.json` 的 provider 配置
- 自动把 `mcp__coding-bridge__review_code` + `mcp__coding-bridge__review_plan` + `mcp__kimi__kimi` 加进 `~/.claude/settings.json` 的 `permissions.allow`
- 跨机器只需 `node` + `npx` + `uvx`

### `ccstatusline-zh`（非 plugin，是 statusLine 命令）

- `settings.json` 含 sk- token 永不入库 → statusLine 单独脱敏
- 用 `./install.sh install-statusline` 把 base 合并到本机 `settings.json`
- 不污染 env / permissions 等含 token 的其他字段

### 7 个 plugin（`enabledPlugins`）

- 不进 dotclaude-portable 仓库（每个 plugin 都有独立 git source，体积大）
- 跨机器装：`./scripts/setup-plugins.sh`
- 维护 3 个 marketplace + 7 个 plugin（oh-my-claudecode / frontend-design / 3 个 LSP / context7 / code-review）

## 永不入库（实测含 secret 或本机局部）

- `settings.json` / `settings.self` / `default.json` / `providers.json` — 全部含 `sk-...` 真实 API token
- `settings.local.json` — 本机临时权限列表
- `.omc-config.json` — 含 telegram bot token + 本机 nvm 路径
- `kimi.json` / `minimax.json` / `selfminimax.json` / `baidu.json` / `anyrouter.json` / `mcp-needs-auth-cache.json`
- 所有缓存/历史/运行态/插件目录

完整决策表见 `docs/Analysis/INVENTORY.md`。

### Hooks (3 已落地)

- `hooks/review-watchdog.mjs` — PostToolUse hook；`Write|Edit` 触及代码文件但本轮未调 `runReview` 时 stderr 提示（`exit 0`，非阻塞）
- `hooks/guard-read-size.mjs` — PreToolUse:Read 守卫；图片/PDF/压缩档 >2MB 或文本 >5MB 时 deny 防撑爆 32MB 请求体；用 `path.extname()` 兼容复合扩展名
- `hooks/warn-context.mjs` — UserPromptSubmit 守卫；transcript ≥24MB 温和 / ≥28MB 强烈 / ≥30MB 紧急 三档 systemMessage 提醒，趁 `/compact` 仍可成功时主动处理
- Auto-deploy：`./install.sh` 通过 `HOOK_FILES` 动态扫描 `hooks/*.mjs` / `hooks/*.sh`，无需在 MAP 中注册；`--check` 校验 symlink 健在

## 安全防御

1. `.gitignore` 黑名单 + 白名单：`global/json/*` 全屏蔽，例外 `*.base.json`；模式化屏蔽 `**/settings*.json` / `**/provider*.json` / `**/.omc-config*.json` 等
2. `tools/scan-secrets.py`：7 类 token 模式（sk- / AKIA / ghp_ / xoxb- / telegram / sk-ant- / 长 hex）+ 敏感 key 上下文
3. `install.sh doctor`：调扫描器，命中即 fail
4. `install.sh install-pre-push`：在 `.git/hooks/pre-push` 装拦截器（`git push` 时强制扫）
5. `tests/fixtures/`：正/负样本（假 token + 干净样本）

## 关键设计

- **默认 symlink**：仓库 `git pull` 即生效；不放心可用 `--copy`
- **首次安装自动备份**：原文件移到 `~/.claude.backups/<时间戳>/`，最多保留 3 快照
- **幂等**：检测到 `.dotclaude-portable.version` 标记后跳过整盘备份
- **shell 注入幂等**：往 `~/.bashrc` / `~/.zshrc` 追加 `# dotclaude-portable` 标记 + `export CLAUDE_HOME="$HOME/.claude"`，卸载时整段剥离
- **JSON 渲染**：仅替换 `${HOME}` / `${USER}` 两个占位符；本机已有同名 JSON 不覆盖
- **statusLine 合并**：用 Python 把 base 的 `statusLine` 字段 merge 进本机 `settings.json`（base 优先覆盖），其他字段保留
- **plugin 跨机器装**：单独脚本 `scripts/setup-plugins.sh`，不污染 install.sh

## CI / 测试

- `.github/workflows/ci.yml`：Ubuntu 跑 dry-run / doctor / install / check / rollback / uninstall / scan-secrets
- `./tests/ci/smoke.sh`：本地复现 CI（用 FAKE_HOME 隔离，不污染本机 `~/.claude`）
- hooks：`HOOK_FILES` 自动从 `hooks/` 目录发现 `*.mjs` / `*.sh`，无需在 `install.sh` 注册

## Windows

- 用 **Git Bash** 跑 `./install.sh`
- `MINGW*` / `MSYS*` / `CYGWIN*` 自动 fallback 到 `--copy` 模式

## macOS

- **1.0.5+ 已支持**：默认 macOS bash 3.2.57（Apple 因 GPLv3 拒绝升级）下 `./install.sh --force` 跑通，hooks 正确部署
- Linux 同样可用（bash 4/5）
- 系统需预装 `python3`（macOS 13+ 自带 / 旧版 `brew install python3`）与 `npx`（`brew install node`）
