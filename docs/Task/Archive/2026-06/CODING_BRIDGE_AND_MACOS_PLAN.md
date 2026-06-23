---
status: 🔄 进行中
created: 2026-06-23
owner: hoping
scope: install.sh macOS 兼容 + coding-bridge-mcp 集成
---

# macOS 兼容 + coding-bridge-mcp 集成任务计划

## 目标

解决两个问题：

1. **macOS 兼容性 bug**：`install.sh` 在 macOS 上因 bash 3.2 缺 `mapfile` 无法跑通真实 install（`--dry-run` 通过，`--force` 失败）
2. **新需求**：安装时附带 `https://github.com/htmambo/coding-bridge-mcp`，并加入允许列表

## 背景与现状（macOS 真机实测 2026-06-23）

| 项 | 现状 |
|---|---|
| 测试机器 | Darwin 25.6.0 / x86_64 / 系统 bash 3.2.57(1) |
| 工具链 | python3 3.9.6（系统）、find 是 bfs 4.1.1（GNU 替代）、readlink BSD 风格 |
| install.sh bash 版本检查 | 第 51 行 `requires bash >= 4.0` → macOS 直接拒绝运行 |
| 实际 install 失败点 | 第 134 行 `mapfile -t snaps < <(find ...)` 在 bash 3.2 报 `command not found` |
| 实际 dry-run | ✅ 通过（因 dry-run 走 happy path 不会触发 prune_backups） |
| 实际各子命令 | install-memory-mcp / install-statusline / install-pre-push / uninstall / doctor 全部 ✅ |

### 失败的根因

`mapfile` 是 bash 4.0+ 内建（`help mapfile` 自带）。Apple 自 macOS 10.3 起一直预装 bash 3.2，拒绝升级到 4+（GPLv3 协议问题）。**不修复就无法在 macOS 默认 bash 上 install**。

### 脚本里其他可能受 bash 3.2 影响的点（需 audit）

| 行 | 用法 | bash 3.2 兼容？ |
|---|---|---|
| 51 | `BASH_VERSINFO` | ✅ OK |
| 60-69 | `declare -a MAP=(...)` | ✅ OK（索引数组，非关联） |
| 73-75 | `find -mindepth/-maxdepth` | ✅ OK（bfs 支持） |
| 131-141 | `mapfile -t snaps` | ❌ **mapfile 不可用** |
| 160 | `python3` heredoc | ✅ OK |
| 220 | `printf` 多行 | ✅ OK |
| 343 | `python3 -c 'datetime...'` | ✅ OK |
| 348-364 | `python3 <<'PYEOF'` | ✅ OK |

## 修复方案

### 修复 1：放宽 bash 版本检查到 3.2

```bash
# 旧（line 51-54）
if [[ "${BASH_VERSINFO[0]:-0}" -lt 4 ]]; then
  err "requires bash >= 4.0 (current: ${BASH_VERSION:-unknown})"
  exit 1
fi

# 新
if [[ "${BASH_VERSINFO[0]:-0}" -lt 3 ]]; then
  err "requires bash >= 3.2 (current: ${BASH_VERSION:-unknown})"
  exit 1
fi
```

### 修复 2：mapfile 改 while read 循环（line 131-141）

```bash
# 旧
mapfile -t snaps < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -r)
local count=${#snaps[@]}

# 新
local -a snaps=()
while IFS= read -r d; do snaps+=("$d"); done < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -r)
local count=${#snaps[@]}
```

### 修复 3：head 段（line 2-15）声明 macOS 实测 OK

把 "默认 symlink 模式（git pull 即生效）" 保留，usage 不变。

### 修复 4：INSTALL.md / EXTENSIONS.md 同步标注 macOS 实测状态

## coding-bridge-mcp 集成

### 决策（独立分析）

- **安装命令**：`npx -y github:htmambo/coding-bridge-mcp`（npm 支持 `github:` 协议）
- **备份方案**：npx 缓存可能跨进程失效（与 memory server 同问题），**暂不解决**（先看是否复现）
- **允许列表位置**：`global/json/execution_config.base.json` 的 `permissions.allowed_tools` 字段（已有结构），不需新建文件
- **子命令**：`install-coding-bridge-mcp`（与 memory 对称），并加入 `do_install` 主流程

### 改动清单

| 文件 | 改动 |
|---|---|
| `global/json/mcp.base.json` | 新增 `coding-bridge` 段（`command: npx, args: ["-y", "github:htmambo/coding-bridge-mcp"]`） |
| `global/json/execution_config.base.json` | `allowed_tools` 加 `"mcp__coding-bridge__review_code"` + `"mcp__coding-bridge__review_plan"`（按 CLAUDE.md §"Provider Adaptation Table"） |
| `install.sh` | 新增 `do_install_coding_bridge_mcp` 函数 + arg 解析 + case 分发 + 加入 `do_install` 末尾 |
| `docs/Usage/INSTALL.md` | 加 `install-coding-bridge-mcp` 子命令说明 |
| `docs/Usage/EXTENSIONS.md` | 加 coding-bridge 段 |
| `CHANGELOG.md` | 加 1.0.5 段 |
| `VERSION` | 1.0.0 → 1.0.5（patch：兼容 + 新 MCP） |

## 子任务列表

- [x] 1. 实测 macOS 当前 install.sh 行为（dry-run / force / 子命令全跑一遍）
- [x] 2. 定位根因：bash 3.2 缺 mapfile
- [ ] 3. 修复 bash 版本检查（4.0 → 3.2）
- [ ] 4. 修复 mapfile → while read
- [ ] 5. macOS 真机回归：dry-run / force / --check / uninstall 全绿
- [ ] 6. 在 mcp.base.json 加 coding-bridge-mcp 条目
- [ ] 7. 在 execution_config.base.json 加 allowed_tools
- [ ] 8. install.sh 加 `do_install_coding_bridge_mcp` 子命令
- [ ] 9. 在 do_install 末尾自动调用
- [ ] 10. macOS 真机测 `install-coding-bridge-mcp`
- [ ] 11. 文档同步（INSTALL.md / EXTENSIONS.md / CHANGELOG.md / VERSION）
- [ ] 12. codex review（如恢复）+ 独立自查
- [ ] 13. git commit + 归档

## 验收标准

- [ ] macOS 默认 bash 3.2 上 `./install.sh --force` exit 0
- [ ] macOS 上 `./install.sh --check` 0 个 missing / broken
- [ ] macOS 上 `./install.sh --uninstall` 干净
- [ ] macOS 上 `./install.sh install-coding-bridge-mcp` 幂等
- [ ] Linux CI 仍通过（CI 在 ubuntu-latest 跑）
- [ ] `~/.claude/.mcp.json` 包含 `coding-bridge` 段
- [ ] `~/.claude/settings.json` 的 `permissions.allowed_tools` 包含 `mcp__coding-bridge__*`
- [ ] scan-secrets clean
- [ ] 文档与代码一致

## 风险

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| 1 | npx github: 协议可能因 GitHub 限流失败 | P1 | 失败时 warn + 继续，不阻断 install |
| 2 | coding-bridge-mcp 仓库 README 变更导致命令失效 | P1 | 锁版本到具体 commit（`-y github:htmambo/coding-bridge-mcp#<sha>`），待实际验证 |
| 3 | macOS bash 3.2 不支持 `[[ =~ ]]` 正则（实测量 OK） | P2 | 已实测 |
| 4 | `find -mindepth/-maxdepth` 在 BSD find 上行为差异 | P2 | macOS bfs 支持；BSD find 不支持时需 fallback |
| 5 | codex MCP 持续 401（API key 失效） | P0 | 已转独立完成 + 显式声明未 codex 审核 |

## Runtime Decisions

### File: install.sh
- 决策 1: 移除 `bash >= 4.0` 硬性检查，改为 `bash >= 3.2`（最宽松，与 macOS 默认对齐）
- 决策 2: mapfile → while read 循环（不引入新依赖；3.2 兼容）
- 决策 3: macOS 不做 OS 特定分支（行为与 Linux 一致，无需 `uname -s` 检测）

### File: mcp.base.json
- 决策 4: 用 `github:htmambo/coding-bridge-mcp` 而非 `git+https://`，与 npx 习惯一致
- 决策 5: 暂不锁 commit（先试默认分支，README 调整后回看）

### File: execution_config.base.json
- 决策 6: 加 `mcp__coding-bridge__review_code` 和 `mcp__coding-bridge__review_plan` 到 allowed_tools

## 后续

完成 → 归档到 `docs/Task/Archive/2026-06/CODING_BRIDGE_AND_MACOS_PLAN.md` + 更新 README.md 索引 + git commit（commit msg 严格按 `COMMIT_TEMPLATE.md`）
