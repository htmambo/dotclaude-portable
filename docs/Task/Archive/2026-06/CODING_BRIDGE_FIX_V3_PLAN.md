---
status: 🔄 进行中
created: 2026-06-23
owner: hoping
scope: coding-bridge MCP 第三次位置修正 (1.0.6 → 1.0.7)
---

# coding-bridge MCP 第三次位置修正（1.0.6 → 1.0.7）

## 背景

1.0.5 / 1.0.6 两次都没让 Claude Code 真正加载 `coding-bridge` MCP。用户 `claude mcp list` 输出仍无 coding-bridge。诊断后根因：

| 版本 | 写到哪里 | Claude Code 实际加载吗 |
|---|---|---|
| 1.0.5 | `~/.claude/.mcp.json` + `execution_config.json` `allowed_tools` | ❌ 不读这两个 |
| 1.0.6 | 同上（修了 env + uvx） | ❌ 仍然不读 |
| **1.0.7** | **`~/.claude.json` 的 `mcpServers` 字段** | ✅ 这里才是 Claude Code 真读的位置 |

**核心证据**：用户 `claude mcp list` 显示的 7 个 MCP（codex / memory / mcp-deepwiki / ace-tool / context7 / plugin:context7 / plugin:oh-my-claudecode）全部从 `~/.claude.json` 的 `mcpServers` + `enabledPlugins` 读出来。`filesystem` 写在 `~/.claude/.mcp.json` 里但 list 也不显示（说明 `~/.claude/.mcp.json` 完全不被读）。

## 我的错误过程

- **第 1 错**：没读 README，猜 `npx -y github:htmambo/coding-bridge-mcp`。coding-bridge 是 Python 项目。
- **第 2 错**：看了 `execution_config.json` 字段没核对 Claude Code 实际读哪个文件
- **第 3 错**：以为 `~/.claude/.mcp.json` 是 Claude Code 的 MCP 配置位置（实际**不存在**于 Claude Code 加载链）

CLAUDE.md §"Only make targeted changes to requirements" 第 3 次还在犯——**根因是我没在用户本机跑 `claude mcp list` 验证**。下次类似需求必须先用 `claude mcp list` / `claude mcp add` 看实际加载行为。

## 修复方案

### 改动 1：install.sh 写 `~/.claude.json`（不是 `~/.claude/.mcp.json`）

新增子命令 `install-coding-bridge-allow`，把 coding-bridge 加到 `~/.claude.json` 的 `mcpServers`：
- 用 Python `dict.setdefault + update` 合并（保留所有其他字段：numStartups / projects / tipsHistory / enabledPlugins / 等）
- 备份 `~/.claude.json.backup-<ts>`（一次性）
- 原子写 `os.replace`
- 兼容 `~/.claude.json` 已存在 mcpServers 但无 coding-bridge 的情况（追加）和不存在 mcpServers 的情况（创建）

### 改动 2：`~/.claude/.mcp.json` 路径问题

`~/.claude/.mcp.json` 这个文件存在但 Claude Code 不读。它是 OMC / 别的工具读的位置。**保留 install.sh 渲染它**（不破坏现有行为），但**真正起作用的是 `~/.claude.json`**。

### 改动 3：do_install_coding_bridge_mcp 检查 `~/.claude.json`

替换原有检查 `~/.claude/.mcp.json` 的逻辑，改查 `~/.claude.json` 的 `mcpServers.coding-bridge`。

### 改动 4：render 路径加 `${CODING_BRIDGE_API_KEY}` 处理

`~/.claude.json` 是 JSON，不直接走 install.sh render 模板——走 Python deep-merge。env 占位 `${CODING_BRIDGE_API_KEY}` 保留为字符串（启动时 MCP 服务自己读 env），不替换。

### 改动 5：README / INSTALL 同步修正

明确写：**Claude Code MCP 配置在 `~/.claude.json`（不是 `~/.claude/.mcp.json`）**。

### 改动 6：CHANGELOG / VERSION → 1.0.7

诚实写：1.0.5 / 1.0.6 都没让用户真正能用。

## 子任务

- [ ] 1. backup 用户 ~/.claude.json
- [ ] 2. install.sh 新增 `install-coding-bridge-allow`：写 ~/.claude.json.mcpServers
- [ ] 3. do_install_coding_bridge_mcp 改查 ~/.claude.json（不查 .mcp.json）
- [ ] 4. do_install 末尾自动调 install-coding-bridge-allow
- [ ] 5. macOS 用户本机实测：跑完后 `claude mcp list` 应显示 coding-bridge
- [ ] 6. CI smoke 仍 ALL STEPS PASSED
- [ ] 7. README / INSTALL / EXTENSIONS 同步
- [ ] 8. CHANGELOG 1.0.7 + VERSION
- [ ] 9. commit + 归档

## 验收

- [ ] 跑完 `./install.sh install-coding-bridge-mcp` 后 `claude mcp list` 显示 `coding-bridge: uvx ... ✓ Connected`
- [ ] `~/.claude.json` 顶层其他字段（numStartups / projects / tipsHistory / enabledPlugins 等）原样保留
- [ ] 重启 Claude Code 后 MCP 真正可调（用户本机 `mcp__coding-bridge__review_code` 工具出现）

## 风险

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| 1 | `~/.claude.json` 大（100KB+），原子写期间断电可能破坏 | P1 | os.replace(tmp, path) 原子 rename；备份 |
| 2 | Python json.load 100KB 大文件稍慢 | P2 | < 100ms，可接受 |
| 3 | 用户从未跑过 `claude mcp add`，`mcpServers` 字段不存在 | P1 | 用 `setdefault` 创建 |
| 4 | `~/.claude.json` 含 OAuth token / 设备指纹等敏感字段 | P0 | 只读不写其他字段；备份 + 显示 before/after diff |
| 5 | 不修改 `~/.claude/.mcp.json`——但 OMC 工具可能依赖它 | P2 | 保留 install.sh 渲染 `.mcp.json` 的行为，OMC 行为不变 |