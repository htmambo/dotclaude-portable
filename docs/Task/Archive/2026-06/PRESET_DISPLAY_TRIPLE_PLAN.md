# 预设显示三段格式精简

**Status**: ✅ Completed (completion time: 2026-06-27)
**Author**: Claude Code

## 背景与目标

上一轮给预设 json 加了 title/description，但显示把 title/url/model/description 全拼在一行，信息冗余（文件名 + title + url + description 堆叠）。用户要求精简为三段格式：

`[title?:filename] - [是否当前] - [description?:baseurl]`

- 段1（label）：有 title 用 title，不显示文件名；无 title 回退文件名。
- 段2（中段）：active 时显示「当前在用」，非 active 时整段省略（不占位）。
- 段3（tail）：有 description 用 description，无则回退 base_url（·model）。

## 任务分解

- [x] ✅ 子任务 1：`_scanPresets()` —— label 改为 `title || file`，description 改为 `metaDesc || urlModel`。
- [x] ✅ 子任务 2：`_renderSubRow()`（TTY）—— active 中段 `当前在用 — `，渲染 `label — 当前在用 — tail`；非 active `label — tail`。
- [x] ✅ 子任务 2b：降级 `chooseVertical` —— 非 TTY 列表同样插入 active 中段。
- [x] ✅ 子任务 3：降级路径 `configureMainPreset()`「当前在用」提示 —— `title || file`，有 title 不附文件名。
- [x] ✅ 子任务 4：语法校验 + 干跑验证。

## 验收记录

- `node --check tools/configure.mjs` 通过。
- 非 TTY 三段格式：active 项 `自建中转·火山 — 当前在用 — 自建 ai.imzhp.top 代理，火山后端`；非 active `讯飞星火 — 科大讯飞星火...`。
- 无 title/description 回退：`_zztest_notitle.json — test.example.com`（label=file，tail=base_url）。
- 降级「当前在用」提示：`自建中转·火山（env 与 settings.json 完全匹配）`（有 title 不附文件名）。
- review 面板不受影响：仍 `迅飞 KEY — SPARK_API_KEY = 已设置`（item 无 active → 中段省略）。
- active 仍正确命中 selfhuoshan.json。

## 验收标准

- `node --check tools/configure.mjs` 通过。
- 非 TTY 路径列表项形如 `selfhuoshan.json — 自建中用·火山...`（label=title 时无文件名）；active 项中段含「当前在用」。
- 降级路径「当前在用」提示有 title 时只显示 title。
- review/apply 面板不受影响（item 无 active → 中段省略；desc 仍走原 `envKey = status` replace）。

## 风险评估

- **风险**：`_renderSubRow` 被 review/apply/preset 三面板共用。
  - **缓解**：active 中段仅在 `it.active===true` 插入，review/apply 项无 active → falsy → 不插入，行为不变。
- **风险**：desc 的 `descText.replace(/^[^=]+=\s*/, '')` 误吃预设 tail 前缀。
  - **缓解**：6 个预设 description/metaDesc 均不含 `=`，replace no-op；已核实。

## 实现顺序

子任务 1/2/3（代码，同文件串行）→ 4（验证）。
