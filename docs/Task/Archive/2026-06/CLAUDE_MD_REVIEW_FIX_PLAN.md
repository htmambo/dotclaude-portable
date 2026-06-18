# CLAUDE.md 审核修复任务

**状态**: ✅ 已完成 (完成时间: 2026-06-19)
**任务来源**: 用户要求按 2026-06-19 CLAUDE.md 审核报告（REJECTED）逐项修复
**目标仓库**: `/home/hoping/htdocs/dotclaude-portable`
**修改文件**:
- `global/CLAUDE.md`（symlink 源，21KB / 545 行）
- `global/COMMIT_TEMPLATE.md`（A2 必须修复）

## 任务目标与背景

2026-06-19 完成 CLAUDE.md 审核，结论 REJECTED（非阻断）。本次按优先级逐项落地修复。

## 问题清单与修复状态

### A 级（必须修复）

- [x] A1 — §1.1 补 Provider 对 `kind` 字段的兼容性说明
- [x] A2 — `COMMIT_TEMPLATE.md` 补 OMC trailer 块示例（与 §5 对齐）
- [x] A3 — §6 补 PRUNE_LOG 行格式 schema（sha256 前 8 位）

### B 级（强烈建议）

- [x] B1 — §1.4 第三优先级改为"调用本地静态分析 / 单元测试 / 第三方工具"；明确不得由 main 助手单方面自审
- [x] B2 — §4.a 加纯文档/配置/单行 typo 改动豁免条款
- [x] B3 — §4.b 补"批量聚合下 REJECTED 计数规则"
- [x] B4 — §3 FULLAUTO_COMPLETE 行补"双 README 同步"动作
- [x] B5 — §3/§6 统一 `<slug>/` 路径前缀为 `.omc/fullauto/`

### C 级（可选优化）

- [x] C2 — §1 顶部加 `<EXTREMELY-IMPORTANT>` 严禁 model 警告框
- [x] C4 — 移除 "grok" 历史引用，改为"实际调用的外部检索/审核 MCP"
- [x] C5 — 修复 §"Provider 适配表" 沙箱/备注列名错位（重命名"沙箱"列为"沙箱控制"）

### D 级（建议补充）

- [x] D1 — 文档顶部加版本号 `v2.3.0 (2026-06-19)`

### 跳过的项（不适用 / 风险过高）

- C1（文档去重 21KB → 14KB）：用户已读完该规模文档，去重风险高，**保留现状**
- D2/D3（沙箱实测 / SESSION_ID 使用范式）：缺乏实测环境，**留待后续**

## 实施顺序

1. 改 `global/CLAUDE.md`（一次 Edit 完成多段修改）
2. 改 `global/COMMIT_TEMPLATE.md`（补 trailer 块）
3. 验证：`grep` 关键修复点
4. 提交 git commit

## 风险评估

| 风险 | 缓解 |
|---|---|
| symlink 链断裂 | 用 Read 确认源文件路径，写入 dotclaude-portable 仓库源 |
| COMMIT_TEMPLATE 多端不一致 | 实际 `~/.claude/COMMIT_TEMPLATE.md` 也是 symlink 到同一源，**改一处即可** |
| 编辑冲突 | 当前 `dotclaude-portable` 工作区 clean，无冲突 |

## 验收标准

- `grep` 全部 8 个修复点（version / EXTREMELY-IMPORTANT / kind 兼容性 / trailer / sha256 / static analysis / 豁免 / grok）均能在 `global/CLAUDE.md` 命中
- `COMMIT_TEMPLATE.md` 包含 OMC trailer 块示例
- `git status` 显示已修改两个文件
- `git diff --stat` 行数变化 ≤ +60 / -10

## 备注

- 跳过 `runReview` 调用：本任务**非 fullauto 流程节点**（按 §"关键步骤自动调用"表 + §1.4），且无代码改动；按规范未触发外部 MCP 调用的硬性义务。
- 任务文档需在完成后**立即归档**到 `docs/Task/Archive/2026-06/`。
