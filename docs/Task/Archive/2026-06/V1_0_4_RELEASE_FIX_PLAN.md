# v1.0.4 收尾修复

**Status**: ✅ Completed (2026-06-19)
**Author**: 果农
**Tag**: `v1.0.4` (annotated) → `e2c37a9`
**Branch**: `release/v1.0.4`(与 `main` 同源,完全等价)

## 外部 Review 意见 (2026-06-20)

调用 `mcp__coding-bridge__review_code` 审查本归档,得到 verdict = **REJECTED (含 2 P0 + 1 P1)**。

| # | 等级 | 问题 | 实际核验 | 处置 |
|---|---|---|---|---|
| 1 | P0 | "46 分钟内完成" 时间表述易误读 | 原 3 commit 时间线 04:23→04:28→05:09 实为 46 分钟,**但未限定"原 3 commit"** | 已修订下方"背景"段 |
| 2 | P0 | tag 拓扑描述歧义 | 归档未交代"先 release 分支 → 落 tag → 落归档 commit → main ff" 的时间顺序,易让人误以为 `f0632b6` 与 tag 同一对象 | 已修订下方"动作 3"与"文件变更"段,补时间线 |
| 3 | P1 | "2 次 no-op rebase" 被粉饰为"验证确认" | 实质是误读顺序后做的 2 次徒劳 rebase | 已修订下方"动作 1"与"经验教训"段,降为平实描述 |
| 4 | P2 | 索引排序无规则 | review 自行判定"无需修改" | 暂不处理 |
| 5 | P2 | OMC trailer 6 项合规 | review 判定"齐全且闭合" | 暂不处理 |

provider = `coding-bridge`,SESSION_ID 留存备查。

---

## 背景

**原 3 次提交** `9df3c4b` (06-19 04:23) → `3924496` (06-19 04:28) → `e2c37a9` (06-19 05:09) 在 **46 分钟内**完成,均属 v1.0.4 收尾批次。**归档 commit `f0632b6` 是在 06-20 17:53 落地的后置追溯**,与前 3 个 commit 不在同一天。

审查后识别 3 个可改进点:

1. 提交顺序与"docs 先行"原则的预期相反
2. 缺乏 v1.0.4 正式 tag / release commit
3. 4 个高频入口文档被反复触动(冲突风险高)

## 修复动作

### 动作 1:验证提交顺序

**做法**:`git checkout -b release/v1.0.4` → `git rebase -i HEAD~3`

**结果**(如实记录):**误读顺序**——初次审查时把"docs 先行"原则误解为"原 3 commit 中 docs 应该在更早位置",于是尝试 `git rebase -i` 调整顺序。**实际**原顺序 `e2c37a9 (feat) → 3924496 (docs/hook) → 9df3c4b (docs/CLAUDE)` 已经是"feat 先落地 → docs 收尾"的正确顺序("先 commit 的应是先成型的能力"——feat 落地后 docs 引用 feat 描述)。

**净操作**:执行 2 次 `git rebase -i`,因 `pick` 列表顺序与现状一致(本就是正确顺序),git 视为无需操作,直接完成,hash 不变,无副作用。**这是 2 次无效操作,无产出**。

### 动作 2:梳理 4 个高频入口文档

抽取 `git show HEAD` 内容,逐文件 grep 关键段:

| 文档 | 关键段 | 出现次数 | 结论 |
|---|---|---|---|
| `CHANGELOG.md` | `[1.0.4] - 2026-06-19` | 1 | ✅ 单一权威 |
| `README.md` | "5 步上手段" | 1 | ✅ 单一权威 |
| `README.md` | "Hooks (1 已落地)" | 1 | ✅ 单一权威 |
| `README.md` | `install-memory-mcp` 行 | 1 | ✅ 单一权威 |
| `docs/Task/README.md` | 3 个 1.0.4 归档索引 | 各 1 | ✅ 单一权威 |
| `docs/Usage/INSTALL.md` | `install-memory-mcp` 命令清单行 | 1 | ✅ 单一权威 |
| `docs/Usage/INSTALL.md` | "MCP memory 修复" 段 | 1 | ✅ 单一权威 |
| `docs/Usage/INSTALL.md` | "Hook 部署" 段 | 1 | ✅ 单一权威 |

**结论**:无重复段,无需二次合并。原改进点(3)被证伪。

### 动作 3:落 v1.0.4 annotated tag

**时间线**(原归档未交代完整,补全):
1. `git checkout -b release/v1.0.4`(此时 `main = e2c37a9`)
2. `git tag -a v1.0.4 -m "..." HEAD` → 落在 `e2c37a9` 上
3. `git add ... && git commit` → 落归档 commit `f0632b6`(仍在 release 分支)
4. `git checkout main && git merge --ff-only release/v1.0.4` → `main` 推进到 `f0632b6`

```bash
git tag -a v1.0.4 -m "v1.0.4 - 2026-06-19

feat(install.sh): add install-memory-mcp subcommand
  - Auto-patch ~/.claude/.mcp.json with MEMORY_FILE_PATH=\$HOME/.claude/memory/memory.jsonl
  - Fixes @modelcontextprotocol/server-memory v0.6.3 cache-dir issue
  - Idempotent, --dry-run aware, one-time .bak

docs(hook): sync docs for review-watchdog.mjs
  - 6 user-facing docs updated from '9 hooks pending V0.3' to actual state
  - install.sh unchanged (HOOK_FILES dynamic scan)

docs(global/CLAUDE.md): translate to English
  - L1 infrastructure layer English, L2/L5 Chinese retained
  - 385 -> 365 lines (-5.2%, within ±10%)
  - All protocol literals preserved (OMC trailer / MCP tool names / sandbox flags)" HEAD
```

**tag 验证**:
- 类型:`tag` (annotated,非 lightweight)
- 指向:`e2c37a939d4d52f79e7ff58050615173f9711f71`
- Tagger: 果农 <htmambo@gmail.com> (tag 时间 `1781949094 +0800`)
- 关联 commit 内容与 CHANGELOG [1.0.4] 段 1:1 吻合
- **与归档 commit `f0632b6` 无任何关系**——归档是后置追溯文档,不属于 v1.0.4 本身

**推送策略**:仅本地,不推送。用户审阅后自行 `git push origin v1.0.4` / `git push origin release/v1.0.4`。

## 遗留事项

- `release/v1.0.4` 分支未推送(留作 tag 隔离容器,等用户审阅决定发布路径)
- 4 个高频入口文档虽当前无重复,后续 v1.0.5 提交前仍建议用 `git log --oneline -- <file>` 预检
- 2 次 no-op rebase 浪费了少量时间,无副作用但有 mental cost——已记录在 `## 经验教训`

## 经验教训

1. **`rebase -i` 前先看现状**:`git log --oneline -3` 比 `pick` 列表更直观。**实操错误**:本次直接进 rebase 后才发现原顺序正确
2. **改进点识别要二次校验**:改进点(3)"高频冲突"在内容层面是伪命题——只要每个 commit 改的"段"不重叠,就不会冲突;冲突在 commit 间(共同修改同一行)而非段间
3. **tag 推送默认走用户决策**:符合"hard-to-reverse 需确认"原则,tag 推送到公共可见位置由用户拍板
4. **诚实比光鲜重要**:2 次无效 rebase 应主动报告(本次外部 review 命中了"粉饰"问题,说明原归档措辞偏向自夸)

## 文件变更

- 新增:`docs/Task/Archive/2026-06/V1_0_4_RELEASE_FIX_PLAN.md` (本文件)
- 修改:`docs/Task/README.md` (+1 行索引)
- 新 tag:`v1.0.4` (annotated, local only)
- 新分支:`release/v1.0.4` (local only, 与 main 同源)

## 测试状态

- [x] `git show v1.0.4` 元数据完整
- [x] `git diff main release/v1.0.4` 无差异
- [x] 4 个高频文档关键段 grep 唯一性确认
- [x] 归档目录结构合规

> OMC trailers:
> Constraint: 仅本地 tag / 分支;不向 origin 推送
> Rejected: git push origin v1.0.4 自动外发 | tag 推送到公共仓库属于 hard-to-reverse,留用户决策
> Directive: 用户明确要求"只打本地 tag, 不推送 (推荐)"
> Confidence: 中 | 2 次 no-op rebase 已说明原顺序本就是正确顺序
> Scope-risk: narrow | 仅落本地 tag + 新增归档文件,未触任何运行时代码
> Not-tested: tag 未推送,无法跨机器验证;tag 内容已逐字校对
