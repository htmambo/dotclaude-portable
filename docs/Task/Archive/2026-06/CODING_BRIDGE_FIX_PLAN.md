---
status: 🔄 进行中
created: 2026-06-23
owner: hoping
scope: coding-bridge-mcp 实际不可用修复
---

# coding-bridge-mcp 实际不可用修复（1.0.5 残缺版补救）

## 背景

commit `84ddd4c` (1.0.5) 加了 `coding-bridge-mcp`，但**用户实测 Claude Code 找不到**。诊断后根因：

| # | 问题 | 实际 |
|---|---|---|
| 1 | `npx -y github:htmambo/coding-bridge-mcp` | ❌ 启动命令错了。coding-bridge-mcp 是 **Python 项目**（`.python-version` 存在），不是 Node.js 包，正确命令是 `uvx --from git+https://github.com/htmambo/coding-bridge-mcp.git coding-bridge-mcp` |
| 2 | `mcp__coding-bridge__*` 写到 `execution_config.json` 的 `allowed_tools` | ❌ Claude Code 真正读取的是 `~/.claude/settings.json` 的 `permissions.allow`，不是 `execution_config.json`（后者是 OMC 给 review MCP 用的） |
| 3 | 没注入 `env`（PROVIDER / API_KEY） | ❌ MCP 服务需要环境变量才能调用讯飞 / 火山 API |
| 4 | README 里说"通过 ~/.claude/settings.json 注入 env"（不能放 mcpServers 段） | ✅ 正确 |

## 根因（自审）

我之前犯 3 个错：
1. **没读 README 直接猜安装命令**——用 npm `github:` 协议是 npm 支持的，但 Python MCP 项目不行
2. **混淆了 `execution_config.json` 和 `settings.json`**——只看了 execution_config 的 `allowed_tools` 字段，没核对 Claude Code 实际读哪个文件
3. **没在用户本机实测**——只跑了 `--force` 让 install.sh 报告"ready"，但 ready ≠ Claude Code 真能加载

## 修复方案

### 改动 1：mcp.base.json 改用 `uvx` + env 占位符

```json
"coding-bridge": {
  "command": "uvx",
  "args": ["--from", "git+https://github.com/htmambo/coding-bridge-mcp.git", "coding-bridge-mcp"],
  "env": {
    "PROVIDER": "${CODING_BRIDGE_PROVIDER:-xfyun-coding}",
    "API_KEY": "${CODING_BRIDGE_API_KEY}"
  }
}
```

env 里用 `${VAR}` 占位（render 时替换）。注意 mcp.json 的 `${HOME}` 占位已有 `install_one` 的 render 逻辑，需要扩到通用 `${VAR}`。

### 改动 2：install_one 的 render 支持任意 `${VAR}` 占位

当前实现只替换 `${HOME}` 和 `${USER}`。需要扩成"读本地 env + 替换所有 `${VAR}`"。但 `${CODING_BRIDGE_API_KEY}` 是 secret，不应该入仓库 base 文件——所以 base 文件里**写占位字符串**，让用户本机有 env 后 render 替换。

策略：
- base 文件：env 字段直接写 `${CODING_BRIDGE_API_KEY}`（render 时不存在的 var 保留占位字符串）
- 渲染逻辑：python 用 `os.environ` 替换，找不到的 var 保留 `${VAR}` 字符串不替换（不报错）
- 用户提示：缺 env 时 warn，不阻断 install

### 改动 3：settings.json 的 `permissions.allow` 合并机制（独立子命令）

新子命令 `install-coding-bridge-allow`：
- 读 `~/.claude/settings.json`（**真文件**，含 sk- token）
- 在 `permissions.allow` 数组里**追加** `mcp__coding-bridge__review_code` 和 `mcp__coding-bridge__review_plan`
- **不动**其他字段（env / model / statusLine / enabledPlugins 等）
- 幂等：已存在则跳过
- 备份：`settings.json.bak.<timestamp>`（每次）
- 不入仓库（settings.json 在 .gitignore）

### 改动 4：do_install 末尾自动调用

`do_install` 完成后自动跑 `do_install_coding_bridge_allow`（仅当 settings.json 存在时）。

### 改动 5：依赖提示

README / INSTALL 提示用户：
1. 安装 `uv` / `uvx`：`curl -LsSf https://astral.sh/uv/install.sh | sh`
2. 配 env：`export CODING_BRIDGE_API_KEY=...`（写到 `~/.zshrc`）
3. 重启 Claude Code

### 改动 6：CHANGELOG / VERSION → 1.0.6

## 子任务

- [ ] 1. mcp.base.json：换 uvx 命令 + env 占位
- [ ] 2. install_one render：扩成通用 `${VAR}` 占位
- [ ] 3. 新增 do_install_coding_bridge_allow 子命令（settings.json.allow 合并）
- [ ] 4. do_install 末尾自动调（条件：settings.json 存在）
- [ ] 5. README / INSTALL / EXTENSIONS 加 uvx 依赖提示
- [ ] 6. CHANGELOG 1.0.6 + VERSION
- [ ] 7. macOS 真机回归
- [ ] 8. 代码自查（核对 settings.json 真实合并效果）
- [ ] 9. commit + 归档

## 验收

- [ ] macOS 上 `~/.claude/.mcp.json` 的 coding-bridge 段用 `uvx` 命令
- [ ] macOS 上 `~/.claude/settings.json` 的 `permissions.allow` 包含 `mcp__coding-bridge__review_code` 和 `mcp__coding-bridge__review_plan`
- [ ] macOS 上其他字段（env 含 sk- token / model / statusLine / enabledPlugins / extraKnownMarketplaces）原样保留
- [ ] 重启 Claude Code 后能跑 `claude mcp list` 看到 coding-bridge（用户本机实测）
- [ ] CI smoke 仍 ALL STEPS PASSED
- [ ] scan-secrets clean

## 风险

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| 1 | `${CODING_BRIDGE_API_KEY}` 占位在 mcp.base.json 里——可能触发 scan-secrets 误报 | P1 | 占位字符串不含真实 token 前缀（无 sk- / AKIA / ghp_ / 长 hex），应能通过 |
| 2 | 用户没装 uv / uvx | P1 | 文档明示 + install 时检测 `command -v uvx` 缺失则 warn |
| 3 | settings.json 真文件合并出错破坏用户配置 | P0 | 备份 .bak.<ts>；用 Python `dict.update` 幂等合并；干跑用 `--dry-run` 验证 |
| 4 | `permissions.allow` 已有 `mcp__coding-bridge__*` 时 `dict.update` 行为 | P2 | 检查 + 跳过（set 语义） |