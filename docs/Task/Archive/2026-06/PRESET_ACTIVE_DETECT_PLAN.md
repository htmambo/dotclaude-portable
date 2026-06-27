# 主供应商预设「当前在用」识别修复

**Status**: ✅ Completed (completion time: 2026-06-27)
**Author**: Claude Code

## 背景与目标

`tools/configure.mjs` 的「Claude Code 主供应商预设」子菜单需要标出当前正在使用的 json 预设。

现状：`_panelPreset()`（L1211-1215）与降级路径 `configureMainPreset()`（L643-650）只比对 `ANTHROPIC_BASE_URL` 一个键来判断「当前在用」，存在歧义 —— 多个预设可能共用同一个代理 URL（如 `selfminimax.json` 与 `selfhuoshan.json` 同为 `https://ai.imzhp.top`，仅 token 不同）。

实测（2026-06-27，当前 `settings.json` 真实在用 `selfhuoshan.json`，token 尾 `hgSzJF`）：
- 旧逻辑（仅 URL）按 mtime 倒序 `findIndex` 命中 `selfminimax.json`（mtime 14:02 > 14:00，排在前面）→ **误判**。
- 新逻辑（preset.env 是 settings.env 的 (key,value) 子集）唯一命中 `selfhuoshan.json` → 正确。

**目标**：将「当前在用」判据从「URL 相等」升级为「`preset.env` 每键每值都等于 `settings.env` 对应键值（子集匹配）」，在 TUI 列表与降级路径两处均能正确标出。

## 问题分析

1. `settings.env` 是多预设合并的最终态（含 token 等明文 secret），是判定「真实在用」的唯一权威来源。
2. 预设文件是「想写入的配置」，其 `env` 是 `settings.env` 的子集说明该预设已完整应用。
3. token 等字段是 secret，**仅内部比对、绝不回显明文**（`description` 字段已只展示 base_url+model，不含 token）。
4. 多个预设 URL 相同时，完整子集匹配可消除歧义。

## 任务分解

- [x] ✅ 子任务 1：`_scanPresets()` 增加 `active` 字段 —— 计算每个 preset 是否为 `settings.env` 的 (key,value) 子集。
- [x] ✅ 子任务 2：`_panelPreset()` 用 `active` 重写 `defaultIdx`（命中 active 项；多个 active 取第一个，理论上唯一）。
- [x] ✅ 子任务 3：降级路径 `configureMainPreset()` 增加「当前在用」提示（基于 `_scanPresets().active`）。
- [x] ✅ 子任务 4：渲染器 `_renderSubRow()` 对 `it.active===true` 的项追加 `[当前在用]` 标记（review/apply 面板无 active → 无害）。
- [x] ✅ 子任务 5：语法校验 `node --check` + 干跑逻辑验证。

## 验收标准

- `node -e` 模拟：以当前真实 `settings.json` 跑 `_scanPresets()`，`selfhuoshan.json` 的 `active===true`，其余 `false`。
- `node --check tools/configure.mjs` 通过。
- 改动不破坏 review / apply / 子模块等其它 pick 面板（`_renderSubRow` 共用，`active` 缺省为 undefined/falsy）。

## 风险评估

- **风险**：`_renderSubRow` 被 review/preset/apply 三面板共用。
  - **缓解**：仅在 `it.active===true` 时追加标记，其余项无影响；review/apply 的 option 不带 `active`，等同 falsy。
- **风险**：token 明文泄露。
  - **缓解**：`active` 仅布尔比对结果；不进入 `description`，不改变任何回显。
- **风险**：settings.env 缺某预设的某个键导致子集判否。
  - **接受**：这正是「该预设未完整应用」的正确语义。

## 实现顺序

子任务 1 → 2/3（依赖 active）→ 4 → 5。
