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

## 同步：hooks（1 个已落地）

| 仓库路径 | 源 | 决策 | 理由 |
|---|---|---|---|
| `hooks/review-watchdog.mjs` | `~/.claude/hooks/review-watchdog.mjs` | ✅ symlink | PostToolUse hook，监听 `Write|Edit` 工具；触及代码文件（`.py` `.ts` `.js` `.go` `.rs` 等）但本轮 session transcript 未检测到 `runReview` 时 stderr 提示（exit 0，非阻塞） |
| `hooks/.gitkeep` | — | 占位 | 保持 `hooks/` 目录在 git 中存在；后续 hook 添加无需 `mkdir` |

## 跨机器补全（不入仓，但跨机器需要跑）

| 范围 | 脚本 | 说明 |
|---|---|---|
| 4 个 MCP | (无脚本，npx 自动) | `context7` / `filesystem` / `mcp-deepwiki` / `memory` 全部用 `npx -y <pkg>` 启动，首次启动时 npx 自动下载 |
| `ccstatusline-zh` | `./install.sh install-statusline` | 把 `global/json/settings.statusline.base.json` 合并到本机 `settings.json`；不污染 env / permissions 等含 token 字段 |
| 7 个 plugin | `./scripts/setup-plugins.sh` | 3 marketplace + 7 plugin 跨机器一次装齐；维护在 `scripts/setup-plugins.sh` 顶部 `PLUGINS=(...)` 与 `MARKETPLACES=(...)` |
| hooks | `./install.sh` 自动部署 | `HOOK_FILES` 动态扫描 `hooks/*.mjs` / `hooks/*.sh`；当前 1 个：`review-watchdog.mjs` |

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

## 已知冲突：OMC ↔ dotclaude-portable

**冲突点**：`oh-my-claudecode` 的 `omc-setup` / `omc-doctor` / 部分 slash command 会**直接 patch `~/.claude/CLAUDE.md`**，把本仓库的 symlink 替换成普通文件，破坏跨机器同步。

**完整对比与解决方案**：见 `docs/Analysis/SUPERPOWERS_VS_OMC.md` 与 `README.md` 的"已知冲突"section。

**缓解**（已建议但未自动化）：
- 顺序：`./install.sh` → `./scripts/setup-plugins.sh`（不能反）
- 装完 OMC 后立即 `./install.sh --check` 验证 symlink 健在
- 未来可加：`setup-plugins.sh` 装完 OMC 后自动 `install.sh --force` 重建 symlink

**未受影响的 plugin**：
- `superpowers`（极简，不改 CLAUDE.md）✅
- `frontend-design` / `code-review` / 3 个 LSP / `context7` ✅

**受影响的 plugin**：
- `oh-my-claudecode@omc` ⚠️

## V0.3+ 待办

- 其他 hook 源文件（按需补齐；当前 `review-watchdog.mjs` 已落地，详见 CHANGELOG 1.0.4）
- macOS 实测
- GitHub Releases 自动发版
- hook 行为改写（路径变量化）
