# 预设 json 增加 title/description 厂商描述

**Status**: ✅ Completed (completion time: 2026-06-27)
**Author**: Claude Code

## 背景与目标

「Claude Code 主供应商预设」子菜单目前仅以文件名 + base_url + model 列出预设，不够直观。给每个预设 json 顶部增加 `title` / `description` 元数据描述厂商，并在 configure.mjs 列表与「当前在用」提示中展示，缺失时回退原行为。

## 安全性核查（核心）

- `~/.claude` 是真实目录、在仓库之外（`/home/hoping/.claude` ≠ 仓库根），预设 json 为**用户文件、不进本仓库 git**。
- 仓库 `global/json/` 下**没有** provider 预设模板源，provider 预设完全是用户自建。
- 预设顶层**已存在大量未使用 key**（`permissions`/`hooks`/`statusLine`/`enabledPlugins` 等），`configure.mjs` 合并时**只取 `preset.env` + `preset.model`**。故 `title`/`description` 与既有元数据一样是惰性元数据，**从不合并进 settings.json**。
- Claude Code 运行时只读具名文件（settings.json / .mcp.json / ~/.claude.json），从不扫描任意命名 json（否则 permissions/hooks 早已被应用）。
- `active` 子集判定**只遍历 env 键**，顶层新增 title/description 不影响 active 判定。

**结论**：安全，不影响 Claude 使用。

## 厂商信息（6 个预设，权威扫描 2026-06-27）

| 文件 | title | description | base_url | model |
|---|---|---|---|---|
| huoshan.json | 火山引擎（ARK）| 字节跳动火山方舟，glm-5.2 直连 | ark.cn-beijing.volces.com | glm-5.2[1m] |
| minimax.json | MiniMax | MiniMax M3，Anthropic 兼容接口 | api.minimaxi.com/anthropic | MiniMax-M3 |
| selfminimax.json | 自建中转·MiniMax | 自建 ai.imzhp.top 代理，MiniMax 后端 | ai.imzhp.top | opus[1m] |
| selfhuoshan.json | 自建中转·火山 | 自建 ai.imzhp.top 代理，火山后端 | ai.imzhp.top | opus[1m] |
| xunfei.json | 讯飞星火 | 科大讯飞星火 coding api，astron-code | maas-coding-api.cn-huabei-1.xf-yun.com | astron-code-latest |
| default.json | 默认（官方）| 官方直连占位，仅作参考 | （被 PRESET_EXCLUDE 排除，不在列表）| claude-opus-4-6 |

注：default.json 在 `PRESET_EXCLUDE` 中，不展示，但仍加元数据以备未来启用。

## 任务分解

- [x] ✅ 子任务 1：`_scanPresets()` 读取 `title`/`description`，融入返回项；列表 desc 优先显示 title（缺失回退 shortUrl·model）。
- [x] ✅ 子任务 2：降级路径 `configureMainPreset()`「当前在用」提示展示 title。
- [x] ✅ 子任务 3：用脚本（不读取/不回显 token）给 6 个预设 json 顶部插入 `title`/`description`（保持其它结构与缩进）。
- [x] ✅ 子任务 4：语法校验 + 干跑验证（列表显示 title、active 判定不变）。

## 验收记录

- `node --check tools/configure.mjs` 通过。
- 6 个预设 json 全部合法：title/description 置顶、env 键数不变（self/selfhuoshan 各 10、其余 14）、尾换行保留。
- 非 TTY 路径输出 `✓ 当前在用：自建中转·火山（selfhuoshan.json）`；列表每项显示 `title（url·model） · description`。
- `default.json` 仍被 `PRESET_EXCLUDE` 排除，未出现在列表。
- `active` 判定仍正确命中 selfhuoshan.json（env 子集判定不受顶层元数据影响）。

## 备注

- 预设 json 为用户文件（`~/.claude` 在仓库外），不进本仓库 git；提交仅含 `tools/configure.mjs` + 任务文档。
- `selfhuoshan.json` / `selfminimax.json` 的 description 含「自建 ai.imzhp.top 代理」与 url 冗余，属轻微措辞，不影响功能，暂保留。

## 验收标准

- `node --check tools/configure.mjs` 通过。
- 干跑：6 预设列表 desc 含厂商 title；`selfhuoshan.json` 仍 active=true。
- 预设 json 仍为合法 JSON（`JSON.parse` 通过），env 段与其它 key 不变。

## 风险评估

- **风险**：手编 json 破坏格式。
  - **缓解**：用脚本 `JSON.parse`→改写→`JSON.stringify` 回写（保持 2 空格缩进 + 尾换行），天然保证合法。
- **风险**：title/description 误入 settings.json。
  - **缓解**：合并逻辑只取 env/model，已核查；不改动合并代码。

## 实现顺序

子任务 1/2（代码）→ 3（json 写入，依赖 title 文案确定）→ 4。
