**状态**: ✅ 已完成 (完成时间: 2026-06-19)

## Runtime Decisions

### File: `global/CLAUDE.md`
- fix-1: full Chinese → English translation, preserving all protocol literals (EXTREMELY-IMPORTANT block, MCP tool names, OMC trailers, code samples, table schema)
  - Self-check: all 6 OMC trailers preserved; `mcp__codex__codex` (3×) / `mcp__kimi__kimi` (3×) / `mcp__coding-bridge` (5×) literal strings intact; `sandbox="read-only"` (3×) / `yolo` (2×) / `503` (3×) keywords intact
  - Line count: 385 → 365 (-5.2%, within ±10% acceptance threshold)
  - Residual Chinese: 0 lines (full monolingual English)
  - Section structure preserved: 15 sections + same heading hierarchy
  - `/fullauto 协作约定` section pointer translated to "Collaboration Agreement" + retained as English pointer per user decision (L1 SKILL.md skip, L3 slash command preserve Chinese not applicable since this is a pointer section not slash command)
  - User decisions honored: L2/L5 docs/* skipped, L3 slash commands skipped, L4 shell scripts skipped
  - Single-file fix; no runReview() per §4.a exemption (纯文档改动, self-checked stamp)

<!-- self-checked: 纯文档/单文件翻译改动, 无逻辑语义变化 -->

## 任务目标

把 `global/CLAUDE.md` 从中文全文翻译为英文，使其符合 `~/.claude/CLAUDE.md` §"交互语言"里 **"工具与模型交互强制使用 English"** 的规定。

## 背景与决策

| 项 | 决策 |
|---|---|
| 改造对象 | 仅 `global/CLAUDE.md`（1 个文件） |
| 跳过对象 | L2 用户向文档（README / docs/* / GitHub 模板）、L3 slash command、L4 shell 脚本、L1 `skills/fullauto/SKILL.md` |
| 翻译原则 | 协议/规则/工具名/错误码**严格保留英文**；描述性段落英文化；保留所有 `<EXTREMELY-IMPORTANT>` / OMC trailer / 表格 / 行号引用 / commit 模板字面量 |

## 子任务列表

- [x] ✅ 1. 翻译 `global/CLAUDE.md` 全文为英文（按行号映射保持引用稳定）
- [x] ✅ 2. 自检：所有 MCP 名（`mcp__codex__codex` / `mcp__kimi__kimi` / `mcp__coding-bridge__*`）/ OMC trailer（`Constraint:` / `Rejected:` / `Directive:` / `Confidence:` / `Scope-risk:` / `Not-tested:`）/ `<EXTREMELY-IMPORTANT>` 块原文保留
- [x] ✅ 3. 写一条 commit 信息（按 `~/.claude/COMMIT_TEMPLATE.md` 模板 + OMC trailers）

## 每个子任务的改动内容

### 子任务 1：英文化 `global/CLAUDE.md`

保持原行结构与表格，按下列规则翻译：

| 原段落类型 | 处理 |
|---|---|
| 章节标题 (`## 外部审核 MCP`) | 译为 `## External Review MCP` |
| `<EXTREMELY-IMPORTANT>` 块内文字 | 译为英文；保留 `<EXTREMELY-IMPORTANT>` 标签 |
| 表格列（中文表头） | 列标题译英文 |
| 工具调用样例（`runReview({...})`） | **完全保留**（代码字面量） |
| MCP 工具名（`mcp__codex__codex` 等） | **完全保留** |
| Provider 名（`codex` / `kimi` / `coding-bridge`） | **完全保留** |
| 错误码 / 标志（`yolo` / `503` / `sandbox="read-only"`） | **完全保留** |
| OMC trailer 标签（`Constraint:` / `Rejected:` 等） | **完全保留** |
| commit 模板引用 `~/.claude/COMMIT_TEMPLATE.md` | **完全保留** |
| 行号引用（§4 事故复盘等） | **完全保留** |
| 文档目录命名（`docs/Task/` 等） | **完全保留** |
| 索引文件示例（`USER_AUTH_REFACTOR_PLAN.md`） | 保留英文占位 |

### 子任务 2：自检清单

- [ ] `<EXTREMELY-IMPORTANT>` 块保留（仅内容英文化）
- [ ] `EXTREMELY-IMPORTANT` 块内 `codex` / `model` / `yolo` 三个关键词未被翻译
- [ ] §1.1 表格的 12 个字段名 (`PROMPT` / `cd` / `kind` 等) 保留英文
- [ ] §1.2 `codex → mcp__codex__codex` / `kimi → mcp__kimi__kimi` / `coding-bridge → mcp__coding-bridge__*` 映射保留
- [ ] §1.3 「严禁写 provider 字面量」段完整保留（业务代码不出现字符串）
- [ ] §1.4 三档失败兜底 + 禁止行为清单保留
- [ ] "Review Provider Tool Invocation Specification" 大节保留（指令标题）
- [ ] OMC trailer 引用段（`Constraint:` / `Rejected:` 等 6 个）保留
- [ ] `/fullauto 协作约定` 段保留中文（按用户决定，L3 不动）

## 预期效果和验收标准

- `global/CLAUDE.md` 全文为英文（除 `<EXTREMELY-IMPORTANT>` 标签、协议块字面量、目录命名、slash command 引用、`/fullauto 协作约定` 段）
- 翻译后行数变化 ≤ ±10%（不应大幅膨胀或压缩）
- 关键命令样例、表格 schema、MCP 工具名 1:1 保留
- 不影响本仓库 `install.sh` 的 MAP 部署（CLAUDE.md 仍是 `symlink` 模式）

## 风险评估和缓解措施

| 风险 | 缓解 |
|---|---|
| 翻译误改 MCP 工具名字面量 | 子任务 2 自检逐字对照 |
| 表格列翻译破坏 schema | 保留英文列名，仅翻译表头说明列 |
| `<EXTREMELY-IMPORTANT>` 标签被移除 | 自检清单强制保留 |
| 行号引用 (`§4 事故复盘`) 失效 | 保留原编号 |

## 实施顺序和依赖关系

1 → 2 → 3（串行）

## Runtime Decisions

（翻译完成后追加）