---
description: 清理 /fullauto 已完成 slug 目录（N=5 / T=30d 阈值，审计先行后删除）
argument-hint: "[N=5] [T=30d]"
---

任务：按阈值清理 `.omc/fullauto/<slug>/` 目录。**先写审计行，再删目录**。

**关键执行要求**：
- ❌ **不要**自动触发——本命令仅在用户显式输入 `/fullauto-prune` 时执行
- ❌ **不要**询问"是否继续"——按协议直接执行，输出总结
- ❌ **不要**删 `status: active` 或 `status: failed` 行对应的目录
- ❌ **不要**动 `docs/Task/Archive/YYYY-MM/<TASK>_PLAN.md` 任何文件
- ❌ **不要**动 `.omc/plans/fullauto-<slug>-impl.md`（如存在）
- ❌ **不要**在脚本里带 `model` 参数调 `mcp__codex__codex`（本命令不调 Codex）

## 参数解析

- `N`：保留最近 N 个 `complete` slug（默认 5）
- `T`：截止天数（默认 30d）
- 两个阈值取更严者

## 执行步骤

1. **读 `.omc/fullauto/INDEX.md`**：解析每行，识别 `status: complete` 的 slug 行
2. **磁盘对账**：
   - 索引有、目录无 → 标记为 `drift`，跳过清理（输出到总结，**不删**）
   - 索引无、目录有 → 标记为 `orphan`，加入清理候选（informational）
3. **排序**：对 `complete` 行按磁盘 `<slug>/spec.md` 的 mtime 降序排序（不用目录 mtime——目录 mtime 会被 INDEX.md 引用更新时改写，不稳定）
4. **阈值过滤**：
   - 保留前 N 个
   - 其余中 mtime > T 天的全部入清理队列
   - 其余中 mtime ≤ T 天的保留（用户可调小 N 触发）
5. **写审计行**（**先于删除**）：
   - 目标文件：`docs/Task/Archive/YYYY-MM/PRUNE_LOG.md`（若不存在则创建并加头部）
   - 头部格式：
     ```
     # Fullauto Prune Log

     | 时间 | slug | spec.md (sha256:8) | validation.md (sha256:8) | reason |
     | --- | --- | --- | --- | --- |
     ```
   - 每条清理一行：
     ```
     | YYYY-MM-DD HH:MM | <slug> | <hash> | <hash> | <mtime-rank-N OR age>Td> |
     ```
6. **删 INDEX.md 行**：从 `.omc/fullauto/INDEX.md` 移除对应 slug 行
7. **删磁盘目录**：
   - 用 `python -c "import shutil; shutil.rmtree('/abs/.omc/fullauto/<slug>')"` 而非 `rm -rf`（避免误删）
   - 只删 `complete` 状态且已写审计行的目录
8. **输出 1 段总结**（非阻塞，**不询问**）：
   ```
   /fullauto-prune 总结:
   - 清理: <X> 个
   - 保留: <Y> 个
   - drift（人工核查）: <D> 个
   - orphan（informational）: <O> 个
   - 审计日志: docs/Task/Archive/YYYY-MM/PRUNE_LOG.md
   - 建议: 复审 drift 列表并手动修正 INDEX.md
   ```

## drift 处理（边界）

- 索引有 slug 行但磁盘目录已不存在 → 输出到 `## drift 列表` 段，**不清理**
- 用户后续可以手动 `rm` INDEX.md 对应行（**命令本身不删 drift 行**）
- 原因：drift 可能是 fullauto 异常退出或人工误删，需要人工判断

## 与零询问原则的边界

本命令是显式触发——只有用户输入 `/fullauto-prune` 才执行。
执行过程中与执行后**不**询问"是否继续"——按协议直接执行完即输出总结。
这与 `/fullauto` 的 `<Autonomy_Directive>` 一致。
