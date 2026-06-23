**Status**: 🔄 进行中 (开始时间: 2026-06-23)
> 对应 fullauto 状态：.omc/fullauto/hook-size-warn/state.json

## 任务目标
根据 coding-bridge 外部审查返回的 finding,修复 `hooks/guard-read-size.mjs` 与 `hooks/warn-context.mjs` 的中等等级问题,使 hook 在 edge case 下更鲁棒。

## 问题分析

### 外部审查返回的 finding 摘要 (provider=coding-bridge)
| 严重度 | 描述 | 采纳 |
|---|---|---|
| 🔴 | `guard-read-size.mjs` 的 deny JSON 结构"不符合协议" | ❌ **误判**,已交叉验证 OMC `bridge.ts:2365-2369/2415-2419` 用同一 `hookSpecificOutput` 嵌套,合规 |
| 🟡 | `file.split('.').pop()` 对 `archive.tar.gz` 取到 `gz` 而非 `tar.gz`;当前 MEDIA 列表无复合扩展,影响为零,但未来扩展列表时易踩雷 | ✅ |
| 🟡 | `warn-context.mjs` 缺多级预警;若 transcript 已飙到 30MB+ 用户仍只收到一条温和提醒 | ✅ |
| 🟢 | 路径遍历探测面 / stdin 阻塞读 / 多级魔数检测 | ❌ 低优,跳过 |

### 跨验证证据
- `~/.claude/plugins/marketplaces/omc/src/hooks/bridge.ts:2365-2369`:production PreToolUse deny 写法与本 hook 一致
- `~/.claude/plugins/marketplaces/omc/src/hooks/setup/types.ts:23`:同形态类型定义
- `~/.claude/plugins/marketplaces/omc/src/hooks/setup/index.ts:39,345,501,523`:多实例采用同结构

## 子任务列表
1. **修复 guard-read-size.mjs 扩展名解析** — 用 `path.extname()` 替代 `file.split('.').pop()`,处理 `.tar.gz` / `.min.js` 等复合扩展
2. **扩展 warn-context.mjs 为三档预警** — `>24MB` 温和 / `>28MB` 强烈 / `>30MB` 紧急

## 每个子任务的改动内容

### 子任务 1 — guard-read-size.mjs
- `import { readFileSync, statSync } from 'node:fs'` → 加 `'node:path'` 的 `extname`
- `const ext = (file.split('.').pop() || '').toLowerCase()` → `const ext = extname(file).slice(1).toLowerCase()`
- `path.extname()` 直接处理 `.tar.gz` → 返回 `.gz`(实际规则:`.tar.gz` 的最后扩展名是 `.gz`),所以仍需在 MEDIA 列表中明示 `.gz` 才能命中;**真实防护点**:无扩展名文件 `foo`(无点号) 走 `txt` 分支不再误判为 `txt` 扩展,功能等价
- 新增 MEDIA 显式包含 `.gz`/`.zip` 等常见压缩档 — 避免 base64 后膨胀意外命中 `txt` 通道

### 子任务 2 — warn-context.mjs
- 三档阈值常量 `WARN_SOFT = 24*MB`、`WARN_HARD = 28*MB`、`WARN_CRITICAL = 30*MB`
- 输出三档不同 message,critical 档明确说"提交可能直接失败"
- 保持原有 `systemMessage` 字段结构

## 预期效果和验收标准
- ✅ `node --check hooks/guard-read-size.mjs` 通过
- ✅ `node --check hooks/warn-context.mjs` 通过
- ✅ `extname()` 用法正确处理以下文件:`archive.tar.gz`(返回 `.gz`)、`Makefile`(返回 `''`)、`README`(返回 `''`)、`a.b.c`(返回 `.c`)
- ✅ 三档阈值各自触发不同 message
- ✅ 现有 deny JSON 结构(已被外部审查误判为 bug,实则合规)保持不变

## 风险评估和缓解措施
- **风险**:扩展名列表加入新类型可能误命中。**缓解**:只加 `.gz`/`.zip`,体积阈值用现有 IMG_MAX(2MB)。
- **风险**:transcript 实际可能 30MB+ 仍走 systemMessage 而非 deny。**缓解**:hook 协议限制下 deny 不适合在 UserPromptSubmit 阶段阻断用户输入(中断会话体验),保留 systemMessage 提示是合理设计。

## 实施顺序和依赖关系
1. (无依赖)修复 guard-read-size.mjs
2. (无依赖)扩展 warn-context.mjs

两个文件互不依赖,可并行。

## 阶段 0 输出(spec)
- 路径:.omc/fullauto/hook-size-warn/(state.json 已就位,本任务规模无需另写 spec.md)
- 包含:## Decisions Made(误判驳回)/ ## Assumptions Made(中等等级全采纳、低优跳过)

## 外部审核意见(Phase 0)
- provider: coding-bridge (SESSION_ID=cb7e513a-61a3-47eb-884e-b0a48db0b6c3)
- verdict: 见 review_code 输出(已交叉验证 protocol 合规,主 finding 为误判)
- 风险点 / diff:见本文件"问题分析"段表格

## Runtime Decisions

### File: hooks/guard-read-size.mjs
- fix-1: 路径扩展名解析鲁棒化 (Phase 2, 2026-06-23, provider=coding-bridge)
  - Review verdict: APPROVED (SESSION_ID=357466a9-1606-4b12-9795-8fa7768a530b)
  - Review issues: 缺 isFile() 守卫(目录/字符设备误放行)/ MEDIA 列表不全(漏 tar/bz2/7z 等)
  - 调整: 已采纳 — 加 `if (!stat.isFile()) process.exit(0)` + MEDIA 增补 tar/bz2/7z/rar/xz/zst
  - 下次执行: 维持 isFile 守卫
- 自行实测验证: 目录、`/dev/null`、`archive.tar`、`archive.tar.gz`、`file:null`、`file:42` 六类边界全部行为正确

### File: hooks/warn-context.mjs
- fix-1: 三档预警扩展 (Phase 2, 2026-06-23, provider=coding-bridge)
  - Review verdict: APPROVED (SESSION_ID=c03af0da-9d1a-444f-882d-75debacc0609)
  - Review issues: 24MB 边界 `<=` 导致 size==24MB 静默,与原版 `size > WARN` 语义不一致
  - 调整: 已采纳 — `size <= WARN_SOFT` 改为 `size < WARN_SOFT`,消除 24MB 边界盲区
  - 下次执行: 维持 `>=` 三档 + `<` 早退
- 自行实测验证: 23.99MB 静默 / 24MB 整 soft / 28MB 整 hard / 30MB 整 critical,边界 inclusive 全部正确
