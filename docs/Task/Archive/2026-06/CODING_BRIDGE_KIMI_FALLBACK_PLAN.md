---
status: 🔄 进行中
created: 2026-06-23
owner: hoping
scope: coding-bridge kimi fallback 健康检查
---

# coding-bridge + kimi fallback 双 MCP 集成

## 背景

CLAUDE.md 定义 review fallback 链 `coding-bridge → kimi`，但只装了 coding-bridge，**kimi MCP 完全没装**——fallback 链断。

读取 https://github.com/htmambo/kimimcp README 后确认：
- **kimi 是 MCP server**（不是 provider 配置；用户本机 `~/.claude/kimi.json` 是 Claude Code 切到 kimi 后端的 settings，**两个独立概念**）
- 安装命令：`claude mcp add kimi -s user --transport stdio -- uvx --from git+https://github.com/htmambo/kimimcp.git kimimcp`
- 调用工具名：`mcp__kimi__kimi`
- README 步骤 1.4：在 `~/.claude/settings.json.permissions.allow` 加 `mcp__kimi__kimi`

**当前现状**：
- ✅ `~/.claude.json.mcpServers` 有 `coding-bridge`
- ❌ 没有 `kimi` 段
- ❌ `~/.claude/settings.json.permissions.allow` 没有 `mcp__kimi__kimi`
- ❌ `mcp.base.json`（仓库）也没有 `kimi` 段

## 修复方案

### 改动 1：`mcp.base.json` 加 kimi 段

```json
"kimi": {
  "command": "uvx",
  "args": ["--from", "git+https://github.com/htmambo/kimimcp.git", "kimimcp"]
}
```

注意：与 coding-bridge 不同，kimi **不需要 env**（它读 ~/.claude/kimi.json 的 provider 配置自动获取 token）。

### 改动 2：`install-coding-bridge-mcp` 改名为 `install-external-review-mcp`（同时检查两者）

但改名破坏向后兼容，**保留旧名 + 加新名**：
- `install-coding-bridge-mcp` 继续存在；末尾追加 kimi 检查
- 新增 `install-external-review-mcp`：两个都装 + 都查

### 改动 3：`installCodingBridgeAllow` 扩成 `installExternalReviewAllow`

合并 `mcp__coding-bridge__*` + `mcp__kimi__kimi` 到 `~/.claude/settings.json.permissions.allow`。

### 改动 4：`install-coding-bridge-json` → `install-external-review-json`

合并 `coding-bridge` + `kimi` 两段到 `~/.claude.json.mcpServers`。

但改名成本大。先简单实现：
- `install-coding-bridge-json` 同步装 `kimi`（语义"coding-bridge + fallback kimi 一起装"）
- `install-coding-bridge-allow` 同步加 `mcp__kimi__kimi`
- `install-coding-bridge-mcp` 验证两者

### 改动 5：CHANGELOG / VERSION → 2.1.0

minor bump（增加 provider，比 hotfix 大）。

## 子任务

- [ ] 1. mcp.base.json 加 kimi 段
- [ ] 2. install.mjs `installCodingBridgeJson` 同步装 kimi
- [ ] 3. install.mjs `installCodingBridgeAllow` 同步加 mcp__kimi__kimi
- [ ] 4. install.mjs `installCodingBridgeMcp` 同步验证 kimi fallback
- [ ] 5. macOS 真机：跑完 install --force 后 `claude mcp list` 应显示 coding-bridge + kimi
- [ ] 6. CI smoke + scan-secrets
- [ ] 7. 文档同步（README / INSTALL）
- [ ] 8. CHANGELOG 2.1.0 + VERSION
- [ ] 9. commit + 归档

## 验收

- [ ] `~/.claude.json.mcpServers` 含 `coding-bridge` + `kimi`
- [ ] `~/.claude/settings.json.permissions.allow` 含 `mcp__coding-bridge__*` + `mcp__kimi__kimi`
- [ ] `claude mcp list` 显示 8 个（新增 kimi）
- [ ] 重启 Claude Code 后两个 MCP 都 Connected（用户本机实测）
- [ ] CI smoke + scan-secrets clean
- [ ] settings.json 其他字段（含 sk- token）原样保留

## 风险

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| 1 | kimimcp README 步骤 1.1 提示"先移除官方 Kimi MCP"——若用户已有 `kimi`（不同的 MCP），本仓库不应主动删 | P1 | install.sh 仅追加，不删；如遇冲突 warn 让用户手动 |
| 2 | kimimcp 可能要求 kimi CLI（`v0.16.0+`）作为子依赖 | P1 | 文档明示；启动失败时 warn + 让用户装 kimi CLI |
| 3 | uvx 启动 kimimcp 第一次慢（GitHub clone） | P2 | 与 coding-bridge 同样：首次由 Claude Code 触发，不在 install 阶段预热 |
| 4 | kimimcp 命名冲突（用户可能用 `kimi` 作为别的 MCP 名） | P2 | setdefault 检查 + warn，不强写 |