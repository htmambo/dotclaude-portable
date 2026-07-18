# 循环审核协议（Review Loop Protocol）实施计划

**Status**: ✅ Completed (completion time: 2026-07-19)
**Owner**: 果农 + Claude
**Slug**: review-loop-protocol

## 任务目标

将 External Review MCP 从"单次审核 + 字面量闸门"升级为"审核-修复-重审"循环，直至 verdict=APPROVED 或达上限 5 轮（耗尽则暂停队列、告知用户介入，禁止静默降级）。

## 背景与现状

| 组件 | 现状 | 缺口 |
|---|---|---|
| `hooks/review-watchdog.mjs` (PostToolUse Write\|Edit) | 正则检测本轮是否调过 review | 不看 verdict，REJECTED 也算"调过"放行 |
| `hooks/nudge-review.sh` (commit-msg) | 校验 message 含 `Review: APPROVED` 字面量 | 不校验 transcript 真实 verdict，可伪造绕过 |
| `global/CLAUDE.md` §1.4 | "工具不可达"重试（换 provider） | 无"verdict=REJECTED->修复->重审"循环语义；5 时点皆单次 |

## 用户确认决策

1. 循环上限 5，耗尽暂停队列 + 明确告知用户介入（不静默降级）。
2. APPROVED 带 suggestions 算通过（suggestions 记录不阻塞）。
3. 改动点 3（nudge-review 硬闸门）一起做。

## 真实样本发现（R1 前置验证）

从 transcript 提取 coding-bridge 真实 tool_result（存 `docs/samples/`）：

- **统一外壳**：`tool_result.content[0].text` 为 JSON 字符串 `{"result":{"success":true,"SESSION_ID":"...","agent_messages":"..."}}`
- **review_plan**：`agent_messages` 是 markdown，verdict 嵌在正文（`## (3) Verdict\n\n**REJECTED**`），**无结构化字段**。
- **review_code**：`agent_messages` 标题 `## 审查结论：NEEDS_CHANGES`--**verdict 词集含 NEEDS_CHANGES**，非仅 APPROVED/REJECTED。
- **kimi**（fallback，非循环主路径）：`agent_messages` 为 ``` ```json ``` ``` fence 内 JSON，含结构化 `{verdict, risks, notes}`。

**解析器契约**（据此修订）：
1. 解析 `content[0].text` 为 JSON -> `result.agent_messages`。
2. 在 `agent_messages` 提取 verdict：先试 ``` ```json ``` ``` fence 内 JSON 的 `verdict` 字段；否则多级 markdown LAST-match（加粗 > 标题 > 裸词，各级取最后一个，规避正文前言误判）。
3. 无法解析 -> `UNKNOWN` -> 视为 NOT_APPROVED（fail-closed）。

## 子任务

- ✅ ST1: `global/CLAUDE.md` 新增 §1.5「Review Loop Protocol」
- ✅ ST2: `hooks/review-watchdog.mjs` 升级 verdict 感知 + sessionId 落盘 + 3 态（NO_REVIEW/IN_FLIGHT/HAS_RESULT）
- ✅ ST3: `hooks/nudge-review.sh` 升级 transcript 校验 + session 发现 3 档 + heredoc 传参 + 依赖检测
- ✅ ST4: `skills/fullauto/SKILL.md` 3× 守卫同步为 5 + 引用 §1.5
- ✅ ST5: `docs/samples/` 存真实 tool_result 样本
- ✅ ST6: 端到端 dry run（5 场景）

## 验证结果（ST6 dry run）

| 场景 | 结果 |
|---|---|
| (a) verdict 解析三形态 | review_plan=REJECTED ✅ / review_code=NEEDS_CHANGES ✅（样本契约 ALL PASS） |
| (b) 5 轮耗尽用户通知 | 主助手行为，§1.5 规范约束（非 hook 可测） |
| (c) 无 session 降级 | 临时仓库 -> "TRANSCRIPT VERIFICATION SKIPPED" + exit 0 ✅ |
| (d) 伪造 APPROVED+真 REJECTED | nudge-review abort exit 1 ✅（硬闸门生效） |
| (e) SKILL.md 注释一致 | 166/369/445 加 §1.5 注，6 处 3->5，无残留 ✅ |

补充验证：
- review-watchdog 对真实 transcript 输出 `verdict=REJECTED` + §1.5 循环提醒 ✅
- sessionId 落盘 `~/.claude/state/last-session-<encoded>` ✅
- nudge-review 无 Review 字段 -> abort ✅ / N/A 豁免 -> 放行 ✅ / heredoc 读取 sessionId ✅
- 实施中修复 2 个 bug：extractVerdict 单正则误判（正文先提及 APPROVED）-> 多级 last-match；nudge-review ENCODED sed 少前导 `-` -> transcript 路径错位。

## External Review Opinion

### Round 1/5 - REJECTED

- provider: coding-bridge (review_plan), SESSION_ID: f77e866d-69ef-431a-8b9b-c13582000c17
- 3 阻断项 + 4 改进项：

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| R1 | verdict 解析契约未先验证 | 严重 | ✅ 已前置：抓真实样本，定解析契约 |
| R2 | commit-msg 无 session env，硬门失效 | 高 | ST3 引入 session 发现 3 档：env -> 落盘文件 -> mtime 最新 |
| R3 | SKILL.md 3× 守卫与 5 轮冲突 | 中高 | ST4 同 PR 将 3× 同步为 5 + 引用 §1.5 |
| R4 | bash+jq/python3 可移植性 | 中 | ST3 启动检测依赖，无则降级 + 显著警告 |
| R5 | 5 轮耗尽 vs Autonomy_Directive | 中 | §1.5 明确：耗尽归类为"hard max iterations"合法 stop |
| R6 | review scope 判定模糊 | 中 | ST2 退化策略：session 有未清 REJECTED 则任何 Write/Edit warn |
| R7 | Round 计数并发 | 低中 | §1.5 定：主助手单 writer，hook 只读 |

### Round 2/5 - REJECTED（7 risks，verdict 段被 token 上限截断，从 2 BLOCKER 推断）

- provider: coding-bridge (review_code), SESSION_ID: fe64aff6-2143-45e5-baa6-43524c64a794

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| BLOCKER-1 | b1/b2 first-match，正文前言 APPROVED 击穿 fail-closed | 严重 | ✅ b1/b2 改 last-match（matchAll + [-1]） |
| BLOCKER-2 | `python3 -c` 内嵌变量注入 + 空输出未校验 | 严重 | ✅ 改 heredoc 传参 + `[[ -n "$sid" ]]` 非空校验 |
| HIGH-3 | transcript 路径编码未覆盖 `.` 等特殊字符 | 高 | ❌ 不接受：`~/.claude/projects/` 实际目录名 + 原 watchdog 生产验证，编码只处理 `/` |
| HIGH-4 | parseLastReviewVerdict 未处理 in-flight tool_use | 高 | ✅ 区分 NO_REVIEW/IN_FLIGHT/HAS_RESULT 三态 |
| MED-5 | §1.5 文档 2 步 vs 实现 4 级漂移 | 中 | ✅ §1.5 verdict contract 对齐 4 级 |
| MED-6 | 双计数器缺复位时机 + 触发方埋点 | 中 | ✅ §1.5 补"timing 关闭复位 + 耗尽须声明触发 cap" |
| MED-7 | `set -euo pipefail` 与静默降级耦合 | 中 | ✅ discover_session_id 用 `set +e`/`set -e` 包裹 |

### Round 3/5 - APPROVED ✅

- provider: coding-bridge (review_code), SESSION_ID: dca48570-8a0e-47e1-b584-35c1db9aac38
- verdict: **APPROVED**。6 项修复确认到位，HIGH-3 接受（生产证据）。
- 3 个非阻塞备注作 follow-up（见下）。

## 验收标准

- [x] CLAUDE.md §1.5 条款完整：判据 / 上限 / 耗尽处置 / 覆盖声明 / 与 §1.4 边界 / verdict 契约 4 级 / 计数器复位。
- [x] review-watchdog.mjs 解析 verdict（多级 last-match），3 态处理，REJECTED 后提示；落盘 sessionId。
- [x] nudge-review.sh 校验 transcript verdict；session 发现 3 档（heredoc 传参）；依赖缺失降级 + 警告；`set +e` 包裹。
- [x] SKILL.md 3× -> 5（6 处），引用 §1.5（166/369/445 加注）。
- [x] Dry run: (a) 样本契约 ALL PASS; (c) 无 session 降级+警告; (d) 伪造 APPROVED+真 REJECTED 中止; (e) SKILL.md 注释一致。(b) 主助手行为规范约束。

## Follow-up（非阻塞，后续迭代）

- **R1** (Low): `matchAll` 正则需 `g` flag（无则抛 TypeError），Python `re.finditer` 不需 flag--两端差异建议在注释点一句。
- **R2** (Low): ```` ```json ```` fence 仍 first-match，多 fence 场景建议统一 last-match（当前 kimi 单 fence，风险低）。
- **R3** (Info): `discover_session_id` (c) mtime 分支已确认实现（Round 3 CODE 片段省略致审核者疑问）。

## 风险评估

- 改动均增量性，回滚 = 删 §1.5 + `git checkout` 两 hook + 还原 SKILL.md 6 处。
- 无数据迁移；hook 仍 exit 0 非阻塞，最坏情况是警告噪音，不卡 commit。
