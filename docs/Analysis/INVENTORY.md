# INVENTORY — 同步 / 不同步决策表

> dotclaude-portable 的同步决策记录，Code Review 时优先看本表。**清理后（2026-06-18）** 的真实状态。

## 同步：纯文本规则

| 仓库路径 | 源（`~/.claude/`） | 决策 | 理由 |
|---|---|---|---|
| `global/CLAUDE.md` | `CLAUDE.md` | ✅ symlink | 全局 Claude 指令，机器无关 |
| `global/COMMIT_TEMPLATE.md` | `COMMIT_TEMPLATE.md` | ✅ symlink | Git 提交模板，机器无关 |
| `commands/fix-permissions.md` | `commands/fix-permissions.md` | ✅ symlink | 用户 command |
| `commands/fullauto-prune.md` | `commands/fullauto-prune.md` | ✅ symlink | 用户 command |
| `skills/fullauto/SKILL.md` | `skills/fullauto/SKILL.md` | ✅ symlink | 自定义 skill |

## 同步：JSON 配置

| 仓库路径 | 源 | 决策 | 理由 |
|---|---|---|---|
| `global/json/execution_config.base.json` | `execution_config.json` | ✅ 渲染 cp（仅本机无该文件时） | 纯结构无 secret |
| `global/json/mcp.base.json` | `.mcp.json` | ✅ 渲染 cp（占位符 `${HOME}` 由 install.sh Python 替换） | 路径脱敏后机器无关 |
| `global/json/.omc-version.base.json` | `.omc-version.json` | ✅ 渲染 cp | 纯版本号无 secret |
| `global/json/statusline.base.json` | `settings.json` 的 `statusLine` 字段 | ✅ `install.sh install-statusline` 合并 | statusLine 是 npx 命令无 secret；**仅深度合并 statusLine 字段**，本机其他 settings 字段（含 sk- token）原样保留不被覆盖 |

## 同步：hooks（占位，V0.3 视情况填充）

| 仓库路径 | 源 | 决策 | 理由 |
|---|---|---|---|
| `hooks/` | `~/.claude/hooks/*` | ⏳ V0.3 | 2026-06-18 实测：本机 `~/.claude/hooks/` 已被 OMC 清理，无源文件可复制；9 个 hook 的 install/uninstall 路径在 `install.sh` 已实现，待从 OMC 备份或历史快照恢复 |

## 跨机器补全（不入仓，但跨机器需要跑）

| 范围 | 脚本 | 说明 |
|---|---|---|
| 4 个 MCP | (无脚本，npx 自动) | `context7` / `filesystem` / `mcp-deepwiki` / `memory` 全部用 `npx -y <pkg>` 启动，首次启动时 npx 自动下载 |
| `ccstatusline-zh` | `./install.sh install-statusline` | 把 `global/json/settings.statusline.base.json` 合并到本机 `settings.json`；不污染 env / permissions 等含 token 字段 |
| 7 个 plugin | `./scripts/setup-plugins.sh` | 3 marketplace + 7 plugin 跨机器一次装齐；维护在 `scripts/setup-plugins.sh` 顶部 `PLUGINS=(...)` 与 `MARKETPLACES=(...)` |

### 7 个 plugin 清单

- `oh-my-claudecode@omc`
- `frontend-design@claude-plugins-official`
- `rust-analyzer-lsp@claude-plugins-official`
- `php-lsp@claude-plugins-official`
- `typescript-lsp@claude-plugins-official`
- `context7@claude-plugins-official`
- `code-review@claude-plugins-official`

### 3 个 marketplace 源

- `claude-code-plugins` → `https://github.com/anthropics/claude-code`
- `omc` → `https://github.com/Yeachan-Heo/oh-my-claudecode.git`
- `superpowers-marketplace` → `https://github.com/obra/superpowers-marketplace`

## 永不同步：含 secret 的 JSON（红线）

| 文件 | 实测含 secret | 决策 |
|---|---|---|
| `settings.json` | `sk-***REDACTED-anthropic-40chars***` | ❌ 永不入库（仅 `statusLine` 字段独立脱敏） |
| `settings.local.json` | 无 secret，但本机临时权限 | ❌ 永不入库（机器局部） |
| `settings.self` | `sk-***REDACTED-anthropic-40chars***` | ❌ 永不入库 |
| `default.json` | `sk-***REDACTED-anthropic-40chars***` + nvm 路径 | ❌ 永不入库 |
| `providers.json` | `sk-ant-***REDACTED-anthropic-72chars***` | ❌ 永不入库 |
| `.omc-config.json` | telegram bot token `***REDACTED-telegram***` + nvm 路径 | ❌ 永不入库 |
| `kimi.json` | API key | ❌ |
| `minimax.json` / `selfminimax.json` | secret | ❌ |
| `baidu.json` / `anyrouter.json` | 可能含 token | ❌ |
| `mcp-needs-auth-cache.json` | 鉴权缓存 | ❌ |

`.gitignore` 用黑名单 + 白名单（`global/json/*` 全屏蔽，例外 `*.base.json`）+ 模式化屏蔽（`**/settings*.json` / `**/provider*.json` 等）实现纵深防御。

## 永不同步：缓存/历史/运行态/插件

`backups/`, `cache/`, `debug/`, `downloads/`, `file-history/`, `history.jsonl`, `transcripts/`, `stats-cache.json`, `.session-stats.json`, `paste-cache/`, `plans/`, `session-env/`, `sessions/`, `shell-snapshots/`, `tasks/`, `telemetry/`, `plugins/`, `projects/`, `ide/`

## 安全防御（已落地）

- `tools/scan-secrets.py`：7 类 token 模式 + 敏感 key 上下文长 hex + 裸长 hex
- `install.sh doctor`：调扫描器，命中即 fail
- `install.sh install-pre-push`：在 `.git/hooks/pre-push` 安装扫描器，`git push` 时强制拦截
- `tests/fixtures/`：维护正/负样本（假 token + 干净样本）
- `.gitignore` 黑名单 + 白名单：防止 `cp` 误入

## V0.3+ 待办

- 9 个 hook 实际源文件（待从 OMC 备份或历史快照恢复）
- macOS 实测
- GitHub Releases 自动发版
- hook 行为改写（路径变量化）
