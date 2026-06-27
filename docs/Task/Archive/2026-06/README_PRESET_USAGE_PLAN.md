# README 写入「主供应商预设」使用说明

**Status**: ✅ Completed (completion time: 2026-06-27)
**Author**: Claude Code

## 背景与目标

本轮（title/description 元数据 + 三段格式 + 「当前在用」子集识别）已落地，但文档分散且过时：
- `README.md` 当前无「主供应商预设」章节。
- `docs/Usage/CONFIGURE.md` 仍写 5 个旧预设（minimax/.../default）+ 旧表格，未含动态扫描任意命名 json、`title`/`description` 元数据、三段显示格式、「当前在用」(key,value) 子集识别等新特性。

目标：在 README 合适位置插入完整的「## Claude Code 主供应商预设」使用说明（含注意事项），并同步更新 CONFIGURE.md 过时段落，避免双源漂移。

## 插入位置

README L59（「日常更新」段末）后、L61（「## 跨项目用 nudge-review」）前。

## 任务分解

- [x] ✅ 子任务 1：README 插入「## Claude Code 主供应商预设」章节（L61，5 个 ### 子节）。
- [x] ✅ 子任务 2：同步重写 `docs/Usage/CONFIGURE.md` 主供应商预设段（去掉固定 5 预设表格 + 菜单列表 L13 改动态扫描）。
- [x] ✅ 子任务 3：校验 README 标题层级连贯、双源术语一致、无 secret 泄露。

## 验收记录

- README 标题层级连贯：`## Claude Code 主供应商预设` → 5 个 `###` → `## 跨项目用 nudge-review`。
- README/CONFIGURE.md 关键术语一致：动态扫描 / title·description / 三段 / 当前在用 / 子集匹配。
- README 链接 `[docs/Usage/CONFIGURE.md](docs/Usage/CONFIGURE.md)` 指向存在。
- 无明文 token（grep `sk-[A-Za-z0-9]{20,}` 无命中）。

## 验收标准

- README 新章节覆盖：动态扫描两个来源、title/description 元数据惰性 key、三段格式、(key,value) 子集识别「当前在用」、合并语义（仅 env+model）、重启生效、token 手动维护。
- CONFIGURE.md 与 README 不冲突，描述一致。
- 无任何 token 明文出现在文档。

## 风险评估

- **风险**：README 与 CONFIGURE.md 双源漂移。
  - **缓解**：README 写精炼版 + 指向 CONFIGURE.md 详版；CONFIGURE.md 同步更新过时表格。两者描述一致。
- **风险**：文档误写 token。
  - **缓解**：仅写 base_url 主机名，不写 token；沿用既有文档口径。
