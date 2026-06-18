**状态**: ✅ 已完成 (完成时间: 2026-06-19)

## Runtime Decisions

### File: install.sh
- fix-1: add `install-memory-mcp` subcommand (arg parse + dispatch + do_install_memory_mcp function + --help line)
  - 56 lines added: 33 lines function body (Python deep-merge via heredoc) + 23 lines comments/help
  - Idempotent: returns 0 if `mcpServers.memory.env.MEMORY_FILE_PATH == $HOME/.claude/memory/memory.jsonl` already
  - Atomic backup: first-time mcp.json edit creates `.bak`; does not overwrite existing `.bak`
  - DRY-RUN aware: respects main `--dry-run` flag (no patch, only log)
  - Python fallback handles both missing file and JSON decode error
  - Tested: dry-run (env count = 0), real run (env written, .bak created), idempotency (already configured message), restore (diff = 0)

### Self-check:
- [x] bash -n install.sh OK
- [x] scan-secrets clean
- [x] 4 files changed, +73 lines
- [x] --help shows new subcommand
- [x] idempotency verified (2nd run = "already configured")
- [x] Original mcp.json restored after test (verified diff = 0)

<!-- self-checked: 单文件 bash 函数 + Python heredoc, 纯确定性逻辑, 无外部依赖, 符合 §4.a 豁免 -->

## 任务目标

## 任务目标

在 `install.sh` 加 `install-memory-mcp` 子命令，自动修复 MCP memory server 的 `MEMORY_FILE_PATH` 配置问题，跨机器一键恢复。

## 背景

| 项 | 现状 |
|---|---|
| 问题 | `@modelcontextprotocol/server-memory` v0.6.3 默认存储到 npx 缓存目录（每次启动路径不同），导致跨进程/跨会话数据不共享 |
| 修复 | 在 `~/.claude/.mcp.json` 的 `memory` server 段加 `env: { MEMORY_FILE_PATH: "<abs path>/memory.jsonl" }` |
| 验证 | 已在本机验证 commit `9df3c4b` 之后的修改可持久化 |
| 用户需求 | 把修复做成 `install.sh` 子命令，跨机器一键执行 |

## 子任务列表

- [x] ✅ 1. 设计 `install-memory-mcp` 子命令（参数、行为、幂等性）
- [x] ✅ 2. 实现：在 `install.sh` 加 `do_install_memory_mcp()` 函数 + case 分发
- [x] ✅ 3. 更新 `--help` 帮助块 + `usage:` 头部块
- [x] ✅ 4. 端到端测试：dry-run + 真跑（备份 mcp.json → 跑 → diff）
- [x] ✅ 5. 文档同步：README.md / docs/Usage/INSTALL.md / CHANGELOG.md
- [x] ✅ 6. 归档 + commit

## 子任务 1：设计

**子命令名**：`install-memory-mcp`

**参数**：
- 无需参数（路径全部 hardcode 为 `~/.claude/memory/memory.jsonl`）
- 支持 `--dry-run`（沿用主命令 flag）

**行为**（4 步，幂等）：

```bash
do_install_memory_mcp() {
  local mcp_config="$HOME/.claude/.mcp.json"
  local mem_dir="$HOME/.claude/memory"
  local mem_file="$mem_dir/memory.jsonl"

  # 1. 创建持久化目录
  mkdir -p "$mem_dir"

  # 2. 检查 mcp.json 是否已正确配置
  if [[ -f "$mcp_config" ]] && python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
mem = d.get('mcpServers', {}).get('memory', {})
env = mem.get('env', {})
target = sys.argv[2]
if env.get('MEMORY_FILE_PATH') == target:
    sys.exit(0)  # 已配置
sys.exit(1)  # 缺/错
" "$mcp_config" "$mem_file" 2>/dev/null; then
    log "memory MCP already configured: $mem_file"
    return 0
  fi

  # 3. 用 Python 改写 mcp.json（保留其他 server 段不动）
  if [[ $DRY_RUN -eq 1 ]]; then
    log "[dry-run] would patch $mcp_config: set MEMORY_FILE_PATH=$mem_file"
    return 0
  fi

  # 备份一次
  [[ -f "$mcp_config" && ! -f "${mcp_config}.bak" ]] && cp "$mcp_config" "${mcp_config}.bak"

  python3 -c "
import json, sys
path, target = sys.argv[1], sys.argv[2]
d = json.load(open(path))
mem = d.setdefault('mcpServers', {}).setdefault('memory', {})
mem.setdefault('command', 'npx')
mem.setdefault('args', ['-y', '@modelcontextprotocol/server-memory'])
mem.setdefault('env', {})['MEMORY_FILE_PATH'] = target
json.dump(d, open(path, 'w'), indent=2, ensure_ascii=False)
" "$mcp_config" "$mem_file"

  log "memory MCP configured: MEMORY_FILE_PATH=$mem_file"
  warn "重启 Claude Code 让新配置生效"
}
```

**关键属性**：
- **幂等**：已配置则直接 return 0
- **备份**：第一次改 `mcp.json` 时备份为 `.bak`（一次性，不覆盖）
- **dry-run**：尊重主命令 `--dry-run` flag
- **不破坏其他 server**：用 Python 深合并，只动 `mcpServers.memory.env`
- **错误兜底**：`mcp.json` 不存在 → log + return 0（不阻断 install）

## 子任务 2-6：详见子任务说明
（流程标准化，与 CLAUDE_MD_REVIEW_FIX_PLAN 风格一致）

## 预期效果

- `./install.sh install-memory-mcp` 一行命令完成
- 跨机器首次 install 后可选择性调用
- 配合 `setup-plugins.sh` 后所有功能就绪

## Runtime Decisions

（完成后追加）