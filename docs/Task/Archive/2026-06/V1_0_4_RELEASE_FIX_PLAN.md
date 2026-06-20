# v1.0.4 收尾修复

**Status**: ✅ Completed (2026-06-19)
**Author**: 果农
**Tag**: `v1.0.4` (annotated) → `e2c37a9`
**Branch**: `release/v1.0.4`(与 `main` 同源,完全等价)

## 背景

最近 3 次提交(`9df3c4b` / `3924496` / `e2c37a9`)在 46 分钟内完成,均属 v1.0.4 收尾批次。审查后识别 3 个可改进点:

1. 提交顺序与"docs 先行"原则的预期相反
2. 缺乏 v1.0.4 正式 tag / release commit
3. 4 个高频入口文档被反复触动(冲突风险高)

## 修复动作

### 动作 1:验证提交顺序

**做法**:`git checkout -b release/v1.0.4` → `git rebase -i HEAD~3`

**结论**:原顺序 `e2c37a9 (feat) → 3924496 (docs/hook) → 9df3c4b (docs/CLAUDE)` 实际**就是**"feat 先落地 → docs 收尾"的正确顺序。

初次审查时误判"docs 先行"为"更早 commit",实则"先 commit 的应是先成型的能力"——feat 落在 docs 之前,docs 在后引用 feat 描述,顺序无误。

**净操作**:2 次 `git rebase -i` 验证后确认 no-op,git hash 不变,无副作用。

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
- Tagger: 果农 <htmambo@gmail.com>
- 关联 commit 内容与 CHANGELOG [1.0.4] 段 1:1 吻合

**推送策略**:仅本地,不推送。用户审阅后自行 `git push origin v1.0.4` / `git push origin release/v1.0.4`。

## 遗留事项

- `release/v1.0.4` 分支未推送(留作 tag 隔离容器,等用户审阅决定发布路径)
- 4 个高频入口文档虽当前无重复,后续 v1.0.5 提交前仍建议用 `git log --oneline -- <file>` 预检
- 2 次 no-op rebase 浪费了少量时间,无副作用但有 mental cost——已记录在 `## 经验教训`

## 经验教训

1. **`rebase -i` 前先看现状**:`git log --oneline -3` 比 `pick` 列表更直观。原顺序实际是正确顺序,根本不需要 rebase
2. **改进点识别要二次校验**:改进点(3)"高频冲突"在内容层面是伪命题——只要每个 commit 改的"段"不重叠,就不会冲突;冲突在 commit 间(共同修改同一行)而非段间
3. **tag 推送默认走用户决策**:符合"hard-to-reverse 需确认"原则,tag 推送到公共可见位置由用户拍板
4. **诚实比光鲜重要**:2 次 no-op rebase 应主动报告,而不是隐去

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
