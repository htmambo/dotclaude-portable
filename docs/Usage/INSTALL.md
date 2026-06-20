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

## 详细能力说明

刚装好想了解 **2 个 user command**（`/fix-permissions` / `/fullauto-prune`）、**1 个 user skill**（`fullauto`）、**1 个 hook**（`review-watchdog.mjs`）、**4 个 MCP server**（`context7` / `filesystem` / `mcp-deepwiki` / `memory`）的**触发方式、行为边界、典型场景、排错速查** → 读 [`EXTENSIONS.md`](./EXTENSIONS.md)。

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
