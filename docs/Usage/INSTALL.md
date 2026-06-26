# INSTALL

## 5 分钟上手

```bash
git clone <your-remote>/dotclaude-portable.git
cd dotclaude-portable

./install.sh --dry-run    # 先看会发生什么
./install.sh              # 真安装
./install.sh --check      # 验证
./install.sh doctor       # 体检（扫 secret）
```

## 命令清单

| 命令 | 作用 |
|---|---|
| `./install.sh` | 安装（symlink 模式） |
| `./install.sh --copy` | 拷贝模式（Windows 兜底） |
| `./install.sh --dry-run` | 只打印动作，不改动 |
| `./install.sh --force` | 强制覆盖已存在文件 |
| `./install.sh --uninstall` | 卸载（从最新备份恢复） |
| `./install.sh --check` | symlink 健康巡检 |
| `./install.sh --rollback N` | 回滚到第 N 个备份（1=最新，2=上上次，3=再上上次） |
| `./install.sh doctor` | secret 扫描 |
| `./install.sh install-pre-push` | 在 .git/hooks/pre-push 装拦截器（已自动） |
| `./install.sh install-memory-mcp` | 修复 MCP memory server 持久化路径（跨机器必跑） |
| `./install.sh install-coding-bridge-mcp` | 验证 coding-bridge MCP 配置（首次 install 自动调） |
| `./tests/ci/smoke.sh` | 跑完整 6 步 CI 模拟（用临时 HOME，不污染本机） |

## 工作流

1. **新机器**：clone → `./install.sh`
2. **升级**：仓库里 `git pull` → `install.sh` 重新跑（symlink 模式 git pull 即生效；render JSON 已在则跳过）
3. **本机临时文件被改**：`install.sh --force` 覆盖
4. **升级搞坏了**：`install.sh --rollback 1` 恢复
5. **想干净卸载**：`install.sh --uninstall`

## 备份保留策略

- 首次安装：原文件 mv 到 `~/.claude.backups/<时间戳>/`
- 后续安装（已有 `.dotclaude-portable.version` 标记）：跳过整盘备份，仅对冲突文件做 `.bak.<时间戳>`
- 最多保留 3 个时间戳快照，自动 prune 最旧

## Windows 注意事项

- 用 **Git Bash** 跑 `./install.sh`
- Windows 7+ 默认 `--copy` 模式（脚本通过 `uname -s` 检测 `MINGW*`/`MSYS*`/`CYGWIN*`）
- 想用 symlink 需开启 **Developer Mode** + 用 git-bash 内 `ln -s`（可能仍受限）

## Hook 部署

`hooks/` 目录下的所有 `*.mjs` / `*.sh` 文件会被 `./install.sh` 自动发现并部署为 symlink：

- 当前 1 个：`hooks/review-watchdog.mjs`（PostToolUse hook，代码改动无 `runReview` 时 stderr 提示）
- 新增 hook：把文件放进 `hooks/` 目录，重跑 `./install.sh`，无需改 `install.sh` MAP
- 验证：`./install.sh --check` 校验 `~/.claude/hooks/` 下所有 hook 文件的健康（symlink 健在）

## MCP memory 修复

`@modelcontextprotocol/server-memory` v0.6.3 默认把图谱存到 `npx` 缓存目录（每次启动路径不同），导致跨进程/跨会话不共享。修复：

```bash
./install.sh install-memory-mcp   # 幂等；已配则直接 return 0
```

行为：
- 检查 `~/.claude/.mcp.json` 中 `memory` server 是否已配 `MEMORY_FILE_PATH=$HOME/.claude/memory/memory.jsonl`
- 缺失则用 Python 深合并补上（保留其他 server 段不动）
- 一次性备份 `mcp.json` 为 `.bak`
- 跑完后**重启 Claude Code** 让新配置生效

## coding-bridge MCP（External Review）

`global/CLAUDE.md` 强制所有改动需经 `runReview()` 走外部 review MCP（codex / kimi / coding-bridge）。`coding-bridge` 是 GitHub 源 MCP（**Python 项目**，启动需 `uvx`）：

### 一次性配置

```bash
# 1. 装 uvx（如果还没装）
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. 在 ~/.zshrc 加 API Key
echo 'export CODING_BRIDGE_API_KEY=your-xfyun-or-volcengine-key' >> ~/.zshrc
echo 'export CODING_BRIDGE_PROVIDER=xfyun-coding' >> ~/.zshrc  # 可选，默认 xfyun-coding
source ~/.zshrc

# 3. 重装本仓库让 install.sh 渲染 .mcp.json 用 uvx 命令
./install.sh --force
# （如果之前已装过、.mcp.json 已存在且是 npx 命令，先 rm ~/.claude/.mcp.json 再 ./install.sh）

# 4. 验证
./install.sh install-coding-bridge-mcp
# 输出应包含 "uvx entry" + "uvx: installed" + "settings.json.allowlist: ok"
# 唯一 warn 应是 "CODING_BRIDGE_API_KEY NOT set"（如果你忘了 source ~/.zshrc）

# 5. 重启 Claude Code
```

### 子命令清单

| 子命令 | 作用 |
|---|---|
| `./install.sh install-coding-bridge-json` | 把 coding-bridge MCP server 定义写到 `~/.claude.json` 的 mcpServers（**Claude Code 真正加载 MCP 的位置**）。`./install.sh --force` 末尾自动调 |
| `./install.sh install-coding-bridge-mcp` | 完整验证（uvx 命令 + uvx 安装 + env + allowlist），`./install.sh --force` 末尾自动调 |
| `./install.sh install-coding-bridge-allow` | 把 `mcp__coding-bridge__review_code` + `mcp__coding-bridge__review_plan` 加进 `~/.claude/settings.json` 的 `permissions.allow`（保留含 sk- token 的其他字段） |

### 关键（**易踩坑**）

`~/.claude/.mcp.json` **不是** Claude Code 加载 MCP 的位置——它是 OMC / 其他工具读的（filesystem MCP 也写在 `.mcp.json` 但 `claude mcp list` 看不到）。**真正位置**是 `~/.claude.json` 的 `mcpServers` 字段。

所以 `./install.sh --force` 默认会做两件事：
1. render `~/.claude/.mcp.json`（OMC 用）
2. 合并到 `~/.claude.json.mcpServers`（**Claude Code 用**）

### 排错速查

| 现象 | 原因 | 修复 |
|---|---|---|
| `MCP error: command not found: uvx` | 未装 uvx | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| `NOT uvx in .../.mcp.json` | 旧版 npx 命令（1.0.5 残缺） | `rm ~/.claude/.mcp.json && ./install.sh --force` |
| `CODING_BRIDGE_API_KEY NOT set` | env 没配 | `export CODING_BRIDGE_API_KEY=...` |
| `claude mcp list` 显示 `failed` | API Key 无效 / 没填到 env | 检查 key；用 `claude mcp get coding-bridge` 看详情 |
| Claude Code 启动慢 10~30s | 首次 GitHub clone | npx/uvx 会缓存，之后秒启 |

## 详细能力说明

刚装好想了解 **2 个 user command**（`/fix-permissions` / `/fullauto-prune`）、**1 个 user skill**（`fullauto`）、**1 个 hook**（`review-watchdog.mjs`）、**5 个 MCP server**（`context7` / `filesystem` / `mcp-deepwiki` / `memory` / `coding-bridge`）的**触发方式、行为边界、典型场景、排错速查** → 读 [`EXTENSIONS.md`](./EXTENSIONS.md)。

## 统一配置向导（推荐上手流程）

不想记子命令？直接跑 `./tools/configure.mjs` —— 菜单驱动：

1. **外部 Review 供应商**（coding-bridge / kimi / codex 切换 + API key → 仓库根 `.env`）
2. **Claude Code 主供应商预设**（minimax / anyrouter / selfminimax / xunfei / default）
3. **Statusline / HUD**（ccstatusline-zh / omc-hud）
4. **辅助子模块状态**（只读：memory MCP / pre-push / pre-sync-docs）

```bash
./tools/configure.mjs           # 交互式
./tools/configure.mjs --dry-run # 只打印动作不落盘（CI 用）
./tools/configure.mjs --no-color
```

详细文档 → [`CONFIGURE.md`](./CONFIGURE.md)。

## CI 验证

GitHub Actions 工作流位于 `.github/workflows/ci.yml`，在 push/PR 时自动跑：

1. `./install.sh --dry-run`
2. `./install.sh doctor`
3. `./install.sh --force`（临时 HOME）
4. `./install.sh --check`
5. `./install.sh --rollback 1`
6. `./install.sh --uninstall`
7. `python3 tools/scan-secrets.py .`

本地复现：`./tests/ci/smoke.sh`
