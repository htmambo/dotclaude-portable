---
name: fullauto
description: 从创意到可用代码的端到端全自动执行（危险、不可预知的操作依然会询问）。当希望全程无人值守、且不希望被打断反问时，使用本 skill 替代 /oh-my-claudecode:autopilot。触发词：fullauto / full auto / build me / create me / make me / handle it all / 帮我做一个 / 全自动 / 端到端实现。
argument-hint: "<产品创意或任务描述>"
level: 4
fullauto_version: 2.1
---

<Autonomy_Directive priority="absolute">
**ZERO-ASK MODE IS PERMANENTLY ENABLED.** This skill never pauses to ask the user for clarification, confirmation, or approval. Hard rules:

1. **NEVER call `AskUserQuestion`.** It is disabled for this entire session.
2. **NEVER emit "Do you want to proceed?", "Should I continue?", "Which option?", or any prompt that pauses for user input.**
3. **NEVER request confirmation, options, or choices from the user.** Pick one and act.
4. When input is ambiguous, choose the most reasonable default (prefer the simpler, more conventional, lower-risk option), record it under `## Assumptions Made` or `## Decisions Made` in the output document, and continue.
5. When multiple valid approaches exist, decide based on project context (existing code, conventions, ecosystem norms), log the decision, and proceed.
6. If a child agent attempts to escalate to the user, intercept: (a) attempt the safer default, (b) document the trade-off, (c) keep executing.
7. **The only legitimate stop conditions** are: explicit user `cancel` keyword, 3× repeated QA error, hard max iterations, or terminal phase failure. An interactive prompt is NEVER one of them.

This directive overrides any conflicting default behavior in any nested agent or skill.
</Autonomy_Directive>

<Bash_Discipline priority="high">
The Autonomy_Directive stops the assistant from asking the user, but Claude Code's harness still has a permission gate that asks "do you want to..." for shell commands and file ops. This discipline minimizes those prompts so fullauto can actually run hands-off.

1. **No `cd` in commands.** It doesn't persist across Bash calls anyway.
   Use one of:
   - Flag form: `npm --prefix /abs/path run build`, `pytest --rootdir /abs/path`, `git -C /abs/path ...`
   - Subshell only as last resort: `(cd /abs && cmd)` — still triggers one prompt, but contains it.

2. **No `mkdir -p` / `touch`.** The `Write` tool creates parent directories automatically. For shell contexts needing dirs, use Python:
   `python -c "from pathlib import Path; Path('/abs/dir').mkdir(parents=True, exist_ok=True)"`

3. **No destructive commands** (`rm -rf`, `mv` overwriting, `chmod`, `chown`) unless explicitly in the approved plan. Prefer Python `shutil` or `os.replace`.

4. **No `sudo`.** No system-level writes (`/etc`, `/usr`, `/var`, `/opt`).

5. **No long `&&` chains of unrelated commands.** Each segment may trigger its own permission prompt. Split into independent calls, or use `;` when order is irrelevant.

6. **Prefer project tooling over shell composition:**
   - `python -m pkg` (not `python /abs/path/to/cli.py`)
   - `pytest tests/test_x.py::test_y` (not `cd tests && python -m unittest ...`)
   - `ruff check src/` (not `find src -name '*.py' | xargs ...`)

7. **Use `run_in_background: true` for slow commands** (`npm install`, `pip install`, `pytest`, `mypy`, `ruff`, `hatch build`, `cargo build`, `go build`) — avoids both timeouts and output-length prompts.

8. **No heredocs** (`cat > file <<EOF`, `bash <<<`). Use the `Write` tool or `python -c` instead. Heredocs count as a separate command and trigger their own prompt.

9. **One Bash call = one logical action.** Reading two files via two `Read` calls beats one `cat a b | grep` pipeline.

10. **Absolute paths everywhere** when the command crosses project boundaries. Relative paths only inside the executor's known cwd (e.g., the package being built).

This discipline MUST be appended to EVERY executor / debugger / designer / analyst / architect / critic / reviewer prompt alongside the Autonomy_Directive header.
</Bash_Discipline>

<Prompt_Template>
Canonical wrapper for every subagent prompt dispatched in fullauto:

```
[Autonomy_Directive verbatim from top of this file]

[Bash_Discipline verbatim from this file]

[Task-specific prompt here, ending with: "Return a ≤100-word summary: what changed, files touched, verification, blockers."]
```

The main fullauto assistant reads `<Autonomy_Directive>` and `<Bash_Discipline>` from its own context and re-injects them verbatim into every `Task()` call. Subagents receive a fully self-contained prompt — they do not need to re-read this skill file.
</Prompt_Template>

<Purpose>
`/fullauto` is a self-contained, fully autonomous alternative to `/oh-my-claudecode:autopilot`. It takes a brief product idea (2-3 lines) and runs the full lifecycle hands-off: requirements analysis → technical design → planning → parallel implementation → QA → multi-perspective validation.

**Why this exists instead of just using autopilot:** the upstream autopilot skill occasionally surfaces clarifying questions (e.g. "would you like to run a deep interview first?", "do you want to proceed?"). `/fullauto` is the no-questions variant — it picks, documents, and continues.
</Purpose>

<Use_When>
- User wants end-to-end autonomous execution from an idea to working code
- User says "fullauto", "full auto", "fullauto it", "build me", "create me", "make me", "handle it all", "I want a/an...", "帮我做一个", "全自动", "端到端实现", "无人值守做"
- Task requires multiple phases: planning, coding, testing, validation
- User explicitly does NOT want interactive prompts or clarification questions
</Use_When>

<Do_Not_Use_When>
- User wants to explore options or brainstorm — use `plan` skill
- User says "just explain" or "what would you suggest" — respond conversationally
- User wants a single focused code change — use `ralph` or executor directly
- Task is a small bug fix — use direct executor delegation
</Do_Not_Use_When>

<How_It_Differs_From_Autopilot>
| Aspect | `/oh-my-claudecode:autopilot` | `/fullauto` |
|---|---|---|
| Vague input | Offers redirect to `/deep-interview` (interactive) | Picks defaults, logs to `## Assumptions Made`, continues |
| Multi-option situations | May invoke `AskUserQuestion` | Decides autonomously, logs to `## Decisions Made` |
| Mid-phase confirmations | Possible ("proceed?") | Disabled — execution is continuous |
| Phase progression | Driven by OMC enforcement hook | Self-driven via state file + signal tokens |
| Storage | `.omc/autopilot/`, `.omc/state/autopilot-state.json` | `.omc/fullauto/` (own state, no conflict) |
| OMC update resilience | N/A (it IS OMC) | Not affected — this skill lives in `~/.claude/skills/`, outside OMC's cache |
</How_It_Differs_From_Autopilot>

<Architecture>
This skill does NOT depend on the OMC autopilot enforcement hook or its `prompts.js` runtime. It is a self-contained state machine:

- **State file**: `.omc/fullauto/<slug>/state.json` — tracks current phase, iteration, artifacts
- **Phase output artifacts**:
  - `.omc/fullauto/<slug>/spec.md` — Phase 0 spec (requirements + technical design)
  - `.omc/fullauto/<slug>/open-questions.md` — internal decisions log (NOT for user prompting)
  - `.omc/plans/fullauto-<slug>-impl.md` — Phase 1 implementation plan
  - `.omc/fullauto/<slug>/validation.md` — Phase 4 verdicts
- **Phase completion signals** (text tokens in your response): `FULLAUTO_PHASE_0_COMPLETE`, `FULLAUTO_PHASE_1_COMPLETE`, `FULLAUTO_PHASE_2_COMPLETE`, `FULLAUTO_PHASE_3_COMPLETE`, `FULLAUTO_PHASE_4_COMPLETE`, `FULLAUTO_COMPLETE`
- **No external hook enforcement** — you (the assistant) drive phase progression by reading state, deciding the next phase, and emitting the appropriate signal token when done.

This architecture means: OMC updates, cache invalidation, or plugin reinstalls have zero impact on `/fullauto`.
</Architecture>

<Slug_And_Index_Model>
每个 fullauto 任务独占子目录，模板与命名规则见 `~/.claude/CLAUDE.md` §1-§2。
0-pre 阶段必须执行的步骤在下面 `<Steps>` 中展开。
路径约定（v2.1 起强制）：
- 状态/产物：`.omc/fullauto/INDEX.md` + `.omc/fullauto/<slug>/{state.json, spec.md, open-questions.md, validation.md, qa-blocker.md}`
- 计划：`.omc/plans/fullauto-<slug>-impl.md`
- 任务文档：`docs/Task/Active/<TASK>_PLAN.md` ↔ `docs/Task/Archive/YYYY-MM/<TASK>_PLAN.md`
</Slug_And_Index_Model>

<Review_Advisor>
Phase 1 末、Phase 4 末、单文件修复后各调一次 `runReview()`。
具体 provider 由 `REVIEW_PROVIDER` 解析（默认 `coding-bridge`，fallback `coding-bridge → codex`）。
参数与失败兜底见 `~/.claude/CLAUDE.md` §1.4 + §4；本节给出**自包含**硬约束，
子代理被派发时本节必须随 prompt 一起出现。

**Provider 解析**：会话状态 > `REVIEW_PROVIDER` 环境变量 > 硬编码 `coding-bridge`。
**严禁写 provider 字面量** —— 业务代码不出现 `mcp__codex__codex` / `mcp__coding-bridge__*`。

**⛔ 严禁让审核 MCP 自己读文件。** 流断多发生在工具调用解码阶段。
main fullauto 助手必须先用 Read 把 plan/validation/file 全文读出，嵌入 PROMPT。
`PROMPT` 模板：

```
Review the following <plan|validation|code> content. Output:
(1) 3-7 risks;
(2) unified diff patch of thinnest hardening;
(3) APPROVED/REJECTED verdict;
(4) no questions to user.
---
<FILE_CONTENT_EMBEDDED_HERE>
```

**Per-provider 参数**：
- `codex` → `sandbox=read-only`（默认）/ `SESSION_ID`（续会话用）/ `return_all_messages` / `skip_git_repo_check` / `image`；**严禁带 `model`**（2026-06-08 503 事故）、`yolo`
- `coding-bridge` → PROMPT 头一行强制 "DO NOT modify any file; respond with text only"；`SESSION_ID` 可选

失败兜底 3 档（与本节 §4 「失败兜底」对齐）：
  1. 简化 prompt 重试（同 provider）
  2. 切到 fallback 链下一个 provider（`coding-bridge → codex`）
  3. 放弃 → 写 `## 外部审核：未参与（原因：...）`，主流程不挂

verdict 与 diff 追加到 `docs/Task/Active/<TASK>_PLAN.md` 对应 `## 外部审核意见` 小节。
**REJECTED 不阻塞**主流程。

**v2.2 单文件粒度**（除 Phase 1/4 末的 plan/validation 复审外）：
- 粒度：单文件 = 1 次修复 = 1 次 runReview 调
- 触发点：Phase 2 / Phase 3 / Phase 4 修复循环的**每一次**文件修改完成后
- 详细协议与软上限见本节 §4.a / §4.b / §4.c
- PROMPT 模板：见本节 §4.a "PROMPT 模板" 段
- verdict 写回 `.omc/plans/fullauto-<slug>-impl.md` 的 `## Runtime Decisions` 段
- 死循环防护：同一文件连续 5 次 REJECTED → 写 `qa-blocker.md`，触发 stop（受 global/CLAUDE.md §1.5 全局 5 轮上限约束；per-file 5 次与 timing 5 轮任一先达即 stop）
- 串行化：Runtime Decisions 写入由 main fullauto 助手**亲自执行**，不交给子代理（避免并发写竞争）
</Review_Advisor>

<Prune_Skill>
入口：`/fullauto-prune [N=5] [T=30d]`（独立命令，定义在 `~/.claude/commands/fullauto-prune.md`）。
**绝不**自动触发；只在用户显式调用时执行。
行为：见 `~/.claude/CLAUDE.md` §7。
</Prune_Skill>

<Steps>

## 0-pre — 挂载与分片

**Goal:** 初始化任务分片——`<slug>/` 目录、Active 计划、双索引全部就位。

1. **生成 slug**：
   - 从 idea 抽 kebab-case（lowercase + 数字 + 连字符），≤30 字符
   - 排除保留名 `INDEX` / `state` / `template`，匹配则追加 `-<n>`
   - 已有 `.omc/fullauto/<slug>/` → 追加 `-2/-3/...`，决策写入 `## Decisions Made`

2. **初始化 state**：
   - 路径：`.omc/fullauto/<slug>/state.json`
   - schema：
     ```json
     {
       "phase": "expansion",
       "iteration": 1,
       "task_slug": "<slug>",
       "idea": "<user idea>",
       "started_at": "<ISO 8601>",
       "decisions": [],
       "assumptions": [],
       "qa_cycles": 0,
       "validation_rounds": 0
     }
     ```

3. **创建 `docs/Task/Active/<TASK>_PLAN.md`**（CLAUDE.md 7 段模板 + 顶部指针）：
   ```
   **状态**: 🔄 进行中 (开始时间: YYYY-MM-DD)
   > 对应 fullauto 状态：.omc/fullauto/<slug>/state.json

   ## 任务目标
   <idea>

   ## 问题分析
   ## 子任务列表
   ## 每个子任务的改动内容
   ## 预期效果和验收标准
   ## 风险评估和缓解措施
   ## 实施顺序和依赖关系
   ```

4. **更新 `docs/Task/README.md`** "活跃任务"段 + **`.omc/fullauto/INDEX.md`** "active"段。
   - 索引文件若不存在 → 创建（schema 见 §INDEX_FORMAT）
   - 若 INDEX.md 已有 active 段 ≥4 行（>3）→ 输出 `> ⚠️ 当前 N 个 fullauto 并行，注意上下文拥堵`

5. **旧路径迁移**（仅执行一次，启动时检测）：
   ```
   if exists(.omc/fullauto/state.json) and not exists(.omc/fullauto/<slug>/state.json):
     move .omc/fullauto/state.json → .omc/fullauto/<slug>/state.json
     在 state.json 加 "migrated_from": "legacy-flat" 字段
     在 docs/Task/Active/<TASK>_PLAN.md 顶部加：
       ## Changelog
       - <时间> 旧 .omc/fullauto/state.json 已迁移并删除
   ```

6. **Signal:** 无（0-pre 不发信号；下一步进入 Phase 0）。

---

## 协作约定（权威源）

<!-- DO NOT EDIT OUTSIDE THIS FILE. ~/.claude/CLAUDE.md 仅保留指针，本节是 /fullauto 协作约定的唯一权威源。 -->

`/fullauto` 与全局 `~/.claude/CLAUDE.md` 既有规范（任务文档生命周期、外部审核 MCP、提交模板）的衔接点。CLAUDE.md 不再维护本节，避免双份漂移。

### §1. 任务分片与目录模型

每个 fullauto 任务独占一个 `<task-slug>/` 子目录，slug 在 0-pre 阶段从 idea 生成：

| 项 | 规则 |
|---|---|
| 字符 | kebab-case，小写字母/数字/连字符 |
| 长度 | ≤30 字符 |
| 冲突 | 已有同名目录 → 自动追加 `-2`、`-3` …，决策写入 `## Decisions Made` |
| 保留名 | `INDEX` / `state` / `template` 触发 `-<n>` 后缀 |

文件落点：
- 运行时：`.omc/fullauto/INDEX.md` + `.omc/fullauto/<slug>/{state.json, spec.md, open-questions.md, validation.md, qa-blocker.md}`
- 计划：`.omc/plans/fullauto-<slug>-impl.md`
- 任务文档：`docs/Task/Active/<TASK>_PLAN.md` ↔ `docs/Task/Archive/YYYY-MM/<TASK>_PLAN.md`

### §2. 双索引职责

| 索引 | 角色 | 写入时机 |
|---|---|---|
| `.omc/fullauto/INDEX.md` | fullauto 运行时主索引 | 0-pre / 阶段完成 / 清理 |
| `docs/Task/README.md` | 项目级人类可读索引 | 0-pre / 归档时 |

两表在 0-pre 与 `FULLAUTO_COMPLETE` 两个点必须同步；其他时间允许临时漂移。
漂移修正：fullauto 启动时若发现两表 slug 集合不一致 → 重建短表，补一行 `## 同步修正`。

### §3. 阶段同步点

`fullauto` 主 assistant 在每个阶段完成时按以下表格追加章节到 `docs/Task/Active/<TASK>_PLAN.md`：
**所有 `<slug>/` 路径均指 `.omc/fullauto/` 子目录**（如 `<slug>/spec.md` ≡ `.omc/fullauto/<slug>/spec.md`）。

| 信号 | 追加章节 | 引用路径 |
|---|---|---|
| `FULLAUTO_PHASE_0_COMPLETE` | `## 阶段 0 输出（spec）` + `## 外部审核意见（Phase 0）` | `<slug>/spec.md`（→ `.omc/fullauto/<slug>/spec.md`） |
| `FULLAUTO_PHASE_1_COMPLETE` | `## 实施计划` + `## 外部审核意见（Phase 1）` | `fullauto-<slug>-impl.md`（→ `.omc/plans/fullauto-<slug>-impl.md`） |
| `FULLAUTO_PHASE_3_COMPLETE` | `## QA 记录` | — |
| `FULLAUTO_PHASE_4_COMPLETE` | `## 验证` + `## 外部审核意见（Phase 4）` | `<slug>/validation.md`（→ `.omc/fullauto/<slug>/validation.md`） |
| `FULLAUTO_COMPLETE` | 头部状态改 `✅ 已完成 (YYYY-MM-DD)` + 同步 `.omc/fullauto/INDEX.md` 与 `docs/Task/README.md` | — |

### §4. 外部审核顾问（不阻塞主流程）

fullauto 在 Phase 1 末、Phase 4 末各调一次 `runReview()`，具体 provider 由 `REVIEW_PROVIDER` 解析。
默认 `coding-bridge`（专用审核接口）；fallback 链 `coding-bridge → codex`。

```
Tool: runReview()
Params:
  PROMPT: "Review the following <plan|validation> content. Output: (1) 3-7 risks; (2) unified diff patch of thinnest hardening; (3) APPROVED/REJECTED verdict; (4) no questions to user. ---\n<FILE_CONTENT>"
  cd: <项目根>
  kind: "plan"  ← Phase 1/4 末都是 plan
  # codex provider: sandbox="read-only" / SESSION_ID: None / return_all_messages: True（Phase 1） 或 False（Phase 4）
  # coding-bridge provider: PROMPT 头一行 "DO NOT modify any file; respond with text only"
```

**Provider 调用差异**：

| Provider | 沙箱控制 | 严禁 | 备注 |
|---|---|---|---|
| `codex` | `sandbox="read-only"` | `model`（2026-06-08 503 事故）、`yolo` | 见下方事故复盘 |
| `coding-bridge` | PROMPT 文本约束 | — | fallback 第一档 / 默认 |

**事故复盘（2026-06-08）** —— codex 专属：
在第一版草案里漏写"严禁 model"约束。两次 Codex 调用分别带 `model=sonnet` / `model=opus`，
触发 503（提供商无对应模型）。第三次去掉 `model` 后顺利进入 turn，但流在解码阶段断连。
教训：调 codex 前必须复读本表"严禁"列；本事故**不**适用于 coding-bridge。

失败兜底（沿用本文件 §1.4 的 3 档）：
1. 简化 prompt 重试（同 provider）
2. 切到 fallback 链下一个 provider（coding-bridge → codex）
3. 放弃 → 在 PLAN.md 写 `## 外部审核：未参与（原因：<msg>）`，主流程不挂

外部审核顾问角色定位：顾问 + 风险雷达。**不得**因 REJECTED 阻断 fullauto。

#### §4.a v2.2 — 单文件粒度复审 + 计划联动（每 1 次修复 = 1 次 runReview 调）

**豁免**：纯文档/配置/单行 typo 改动可豁免 `runReview`，由 main 助手自查并在 plan 留 stamp（`self-checked: <原因>`）。其他代码改动一律触发。

除 §4 的 Phase 1/4 末 plan/validation 复审外，v2.2 起**每个文件**被修复后都触发一次 `runReview()` 复审：

- **粒度**：单文件 = 1 次修复 = 1 次 runReview 调（不是合并 N 个文件）
- **触发点**：
  - Phase 2：executor 改完 1 个文件
  - Phase 3：debugger 修完 1 个文件
  - Phase 4：3 reviewer REJECT 后，executor 修完 1 个文件
- **PROMPT 模板**（BEFORE/AFTER 嵌入，`kind="code"`）：
  ```
  Review the following single-file fix output.
  Output: (1) 3-7 risks; (2) unified diff patch of thinnest hardening;
  (3) APPROVED/REJECTED verdict; (4) no questions to user.

  ## File
  <绝对路径> (N lines, M bytes)

  ## Phase
  <2/3/4> — <executor/debugger/3-reviewer>

  ## Fix context
  <1-2 句：原 issue + 修了什么>

  ## File content (BEFORE / AFTER)
  ```python
  # BEFORE
  <原内容>
  ```
  ```python
  # AFTER (当前状态)
  <修复后内容>
  ```

  ## Previous review verdicts on this file
  <如有：上一次 REJECTED + 修复方向>
  ```
- **verdict 处理**：
  - APPROVED → 写 `## 外部审核复审 APPROVED` 段，进入下一文件
  - REJECTED → 写 `## 外部审核复审 REJECTED` 段 + diff 写回 `.omc/plans/fullauto-<slug>-impl.md` 的 `## Runtime Decisions` 段；下一文件执行前**必须 Read** 该段
  - 失败 → 写 `## 外部审核：未参与` 段，主流程不挂
- **不阻塞**（与 §4 一致）：REJECTED 不阻断主流程，但 plan 留下印记，下一文件必须 Read
- **死循环防护**：同一文件连续 5 次 REJECTED → 写 `.omc/fullauto/<slug>/qa-blocker.md`，触发 stop condition

#### §4.b v2.2 — 软上限与批量聚合

| 维度 | 上限 | 超限处理 |
|---|---|---|
| 单 phase 内 runReview 调用次数 | ≤ 8 | 后续文件走"批量聚合 prompt"模式（多个 BEFORE/AFTER 拼一段） |
| 同一文件连续 REJECTED | ≤ 5 | 写 `qa-blocker.md`，stop（§1.5 全局 5 轮） |
| 嵌入 prompt 体积 | ≤ 30k token | 已实测 210 字节 + 上下文远低于 30k；超出时把 BEFORE/AFTER 改为文件路径 + 行号引用 |

**批量聚合下的 REJECTED 计数**：批量 prompt 内 N 个文件任一 REJECTED，phase 总数 +N；但 `qa-blocker` 仍按 §4.a 单文件连续 REJECTED 次数计，不与批量聚合叠加。

#### §4.c v2.2 — Runtime Decisions 写入协议

外部审核 verdict 写回 `.omc/plans/fullauto-<slug>-impl.md` 末尾的 `## Runtime Decisions` 段：

```markdown
## Runtime Decisions

### File: <绝对路径>
- fix-N: <一句话描述> (Phase <X>, <ISO 时间>, provider=<codex|coding-bridge>)
  - Review verdict: <APPROVED/REJECTED/未参与>
  - Review issues: <3-7 risks 摘要>
  - 调整: <外部审核建议 + main 助手采纳的部分>
  - 下次执行: must Read this section before modifying <file>
```

写入由 **main fullauto 助手** 串行化执行（不交给子代理，避免并发写竞争）。

#### §4.d 手工模式代码改动 review 触发规则

**适用范围**：除 `/fullauto` 端到端流程外的所有手工会话（含直接 executor / debugger / 普通修复流）。

**触发点**：main 助手在 `Write` / `Edit` 工具调用触及**代码文件**后，必须在**同一次响应内**调一次 `runReview({kind:"code"})` 复审本次改动。若单次响应涉及多文件改动，PROMPT 的 File/Phase/Fix context 块按文件顺序拼合，作为单次聚合审查。

**代码文件判定**：
- ✅ 触发：`.py` `.ts` `.js` `.tsx` `.jsx` `.go` `.rs` `.java` `.kt` `.swift` `.c` `.cpp` `.h` `.sh` `.sql` 等源代码
- ✅ 触发：`tests/` 目录下任何文件
- ✅ 触发：`pyproject.toml` / `package.json` / `Cargo.toml` / `go.mod`（依赖/构建配置改动可能影响行为）
- ❌ 不触发：`docs/**/*.md`（纯文档）
- ❌ 不触发：`.omc/**/*.md` / `.omc/**/*.json`（运行时元数据）
- ❌ 不触发：仅涉及空白符、注释内容、import 顺序且无逻辑语义变化的单次改动（若改动包含逻辑行，则必须触发）
- ❌ 不触发：`*.md` README / CHANGELOG

**豁免通道**（与 §4.a 一致）：
- 纯文档/配置/单行 typo 改动走 self-checked stamp：在变更位置加 `<!-- self-checked: <原因> -->` 注释，并在当次响应中说明理由
- 其他豁免需用户在当次响应中显式说"跳过本次 review"

**PROMPT 模板**（与 §4.a 对齐）：
```
Review the following single-file fix output.
Output: (1) 3-7 risks; (2) unified diff patch of thinnest hardening;
(3) APPROVED/REJECTED verdict; (4) no questions to user.

## File
<绝对路径> (N lines, M bytes)

## Phase
handwritten — <executor/debugger/direct-fix>

## Fix context
<1-2 句：原 issue + 修了什么>

## File content (BEFORE / AFTER)
```python
# BEFORE
<原内容>
```
```python
# AFTER (当前状态)
<修复后内容>
```

## Previous review verdicts on this file
<如有：上一次 REJECTED + 修复方向>
```

**verdict 写回**：
- 在 `docs/Task/Active/<TASK>_PLAN.md` 末尾追加 `## Runtime Decisions` 段（同 §4.c schema）
- APPROVED → 写 `## 外部审核复审 APPROVED`，继续当前任务
- REJECTED → 写 `## 外部审核复审 REJECTED` + 采纳 diff 修复或记录理由后再继续
- 失败 → 写 `## 外部审核：未参与（原因：...）`，主流程不挂

**死循环防护**：同一文件连续 5 次 REJECTED → 抛错并请求用户决策（手工模式不自动 stop，因无 qa-blocker 机制；用户决定继续还是回滚）。REJECTED 计数器按 (文件路径, 会话ID) 隔离，手工模式与 fullauto 模式的计数器互不干扰，但同一文件在手工模式下的连续 REJECTED 累计至 5 次仍触发阻断（受 global/CLAUDE.md §1.5 全局 5 轮上限约束）。

**软上限**：单次会话内 `runReview(kind=code)` ≤ 8 次；超出走批量聚合。批量聚合不与 §4.a 单文件 REJECTED 计数叠加（因跨流程）。

### §5. 提交模板统一

`~/.claude/COMMIT_TEMPLATE.md` 是唯一权威模板。
OMC git trailers（`Constraint:` / `Rejected:` / `Directive:` / `Confidence:` / `Scope-risk:` / `Not-tested:`）
以引言块形式放入 body 末尾：

```
> OMC trailers:
> Constraint: <...>
> Rejected: <alt> | <reason>
> ...
```

归档动作（move + 双 README 同步 + 删除 state.json）本身按这份模板走一次 commit。

### §6. 清理已完成 slug

| 触发方式 | 行为 |
|---|---|
| `/fullauto-prune`（手动） | 见 §7 |
| 每次 `FULLAUTO_COMPLETE` | **不**自动清理；只在 INDEX.md 标 `complete` |

清理阈值（两者取更严）：
- `N = 5` 个最近 `complete` slug
- `T = 30` 天未访问

清理前置：先在 `docs/Task/Archive/YYYY-MM/PRUNE_LOG.md` 追加一行：
`YYYY-MM-DD HH:MM | <slug> | spec.md:<hash> | validation.md:<hash> | reason:<...>`
其中 `<hash>` 取 `sha256(file_content)[:8]`（hex 前 8 位）。
然后**才**删除 `.omc/fullauto/<slug>/` 整目录；同时从 INDEX.md 移除对应行。

### §7. /fullauto-prune 协议

入口：用户输入 `/fullauto-prune [N=5] [T=30d]`。
1. 读 `.omc/fullauto/INDEX.md`，筛选 `status: complete` 的行
2. 与磁盘 `.omc/fullauto/<slug>/` 目录存在性对账：缺失 → 标记为 `drift`，不清理
3. 排序：mtime 降序；**mtime 取 `<slug>/` 目录下 `spec.md` 的 mtime**（最稳定，代表任务"最近活跃"信号）；保留前 N=5，其余进入候选
4. 候选中 mtime > T 天的全部进入清理队列
5. 候选中 mtime ≤ T 天的保留（用户可调小 N 触发）
6. 写入 `docs/Task/Archive/YYYY-MM/PRUNE_LOG.md`
7. 删除 `INDEX.md` 中对应行
8. 删除磁盘 `<slug>/` 目录
9. 输出 1 段总结：清理数量、保留数量、drift 数量

### §8. 与"零询问"的边界

fullauto 的 `<Autonomy_Directive>` 继续生效（不主动问）。
但 `FULLAUTO_COMPLETE` 之后 assistant 输出一段"交付清单"（非阻塞），
包含：归档路径、git status 建议命令、Codex 顾问状态、清理建议触发词。
用户**主动**决定下一步；不构成反问。

---

## Phase 0 — Expansion: idea → spec

**Goal:** Turn the user's idea into a detailed spec at `.omc/fullauto/<slug>/spec.md`.

1. Read or initialize state:
   ```
   If .omc/fullauto/<slug>/state.json exists, read it and resume at the recorded phase/iteration.
   Otherwise, write initial state: {phase: "expansion", iteration: 1, idea: "<user idea>"}
   ```

2. Spawn Analyst (Opus) — `Task(subagent_type="oh-my-claudecode:analyst", model="opus", prompt=...)`

   The Analyst prompt MUST include BOTH the Autonomy_Directive AND Bash_Discipline (see <Prompt_Template>). Tell the Analyst to:
   - Extract functional/non-functional/implicit requirements
   - For any ambiguity, write `## Assumptions Made` (do NOT ask the user)
   - Return a complete self-contained document

3. Spawn Architect (Opus) — `Task(subagent_type="oh-my-claudecode:architect", model="opus", prompt=...)`

   The Architect prompt MUST include BOTH the Autonomy_Directive AND Bash_Discipline (see <Prompt_Template>). Tell the Architect to:
   - Produce tech stack with rationale, architecture overview, file tree, deps, API contracts
   - For any design choice with multiple valid options, write `## Decisions Made` (do NOT ask)
   - Return a complete implementable spec

4. Combine Analyst + Architect outputs → write to `.omc/fullauto/<slug>/spec.md`. Ensure both `## Assumptions Made` and `## Decisions Made` sections are present (even if empty, with the heading).

5. Update state: `phase: "expansion" → "planning"`, `spec_path: ".omc/fullauto/<slug>/spec.md"`.

6. **同步**：在 `docs/Task/Active/<TASK>_PLAN.md` 追加：
   ```
   ## 阶段 0 输出（spec）
   - 路径：.omc/fullauto/<slug>/spec.md
   - 包含：## Assumptions Made / ## Decisions Made
   ```

7. **外部审核顾问**（不阻塞）：
   - 调用 `runReview()`（provider 默认 `coding-bridge`，见 `<Review_Advisor>` 段）：
     - PROMPT: "Review `<slug>/spec.md` against the original user requirement. Output: (1) 3-7 risks (esp. spec deviations from intent); (2) unified diff patch of thinnest hardening; (3) APPROVED/REJECTED verdict; (4) no questions to user.\n\n## Original Requirement\n<用户原始需求摘要>"
     - cd: <项目根>; kind: "plan"
     - codex provider: sandbox=read-only / SESSION_ID: None / return_all_messages: True
     - coding-bridge provider: PROMPT 头一行 "DO NOT modify any file; respond with text only"
   - 把 verdict + diff 追加到 `docs/Task/Active/<TASK>_PLAN.md` 新增的 `## 外部审核意见（Phase 0）` 小节
   - 失败按 3 档兜底
   - **REJECTED 不阻塞** Phase 1 启动

8. **Signal**: emit text token `FULLAUTO_PHASE_0_COMPLETE` at the end of your response.

---

## Phase 1 — Planning: spec → implementation plan

**Goal:** Create `.omc/plans/fullauto-<slug>-impl.md`.

1. Read spec from `.omc/fullauto/<slug>/spec.md`.

2. Spawn Architect (Opus, direct mode) — `Task(subagent_type="oh-my-claudecode:architect", model="opus", prompt="...")`. Prompt must include BOTH Autonomy_Directive AND Bash_Discipline (see <Prompt_Template>). Ask for:
   - Task breakdown (atomic, with file paths, complexity estimate)
   - Dependency graph (parallel groups, ordering)
   - Acceptance criteria per task
   - Risk register with mitigations
   - Log any design forks to `## Decisions Made` — do NOT ask

3. Spawn Critic (Opus) — `Task(subagent_type="oh-my-claudecode:critic", model="opus", prompt="...")`. Prompt must include BOTH Autonomy_Directive AND Bash_Discipline (see <Prompt_Template>). Ask for OKAY/REJECT verdict. If REJECT, the skill handles fix-and-retry itself (do NOT ask the user).

4. If Critic rejects, iterate: feed feedback back to Architect (max 5 rounds). Stay fully autonomous.

5. Save final approved plan to `.omc/plans/fullauto-<slug>-impl.md`.

6. **外部审核顾问**（不阻塞）：
   - 调用 `runReview()`（provider 默认 `coding-bridge`，见 `<Review_Advisor>` 段）：
     - PROMPT: "Review `.omc/plans/fullauto-<slug>-impl.md`. Output: (1) 3-7 risks; (2) unified diff patch of thinnest hardening; (3) APPROVED/REJECTED verdict; (4) no questions to user."
     - cd: <项目根>; kind: "plan"
     - codex provider: sandbox=read-only / SESSION_ID: None / return_all_messages: True
     - coding-bridge provider: PROMPT 头一行 "DO NOT modify any file; respond with text only"
   - 把 verdict + diff 追加到 `docs/Task/Active/<TASK>_PLAN.md` 的 `## 外部审核意见（Phase 1）` 小节
   - 失败按 3 档兜底（见 `<Review_Advisor>`）
   - **REJECTED 不阻塞** Phase 2 启动

7. **同步**：在 `docs/Task/Active/<TASK>_PLAN.md` 追加：
   ```
   ## 实施计划
   - 路径：.omc/plans/fullauto-<slug>-impl.md

   ## 外部审核意见（Phase 1）
   - provider: <coding-bridge|codex>
   - verdict: <APPROVED/REJECTED/未参与>
   - 风险点 / diff：<见上>
   ```

8. Update state: `phase: "planning" → "execution"`.

9. **Signal**: emit `FULLAUTO_PHASE_1_COMPLETE`.

---

## Phase 2 — Execution: plan → working code

**Goal:** Implement every task in the plan.

1. Read plan from `.omc/plans/fullauto-<slug>-impl.md`.

2. Group tasks by dependency. Spawn independent tasks in parallel:

   ```
   // Simple: Task(subagent_type="oh-my-claudecode:executor-low", model="haiku", prompt=...)
   // Standard: Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt=...)
   // Complex: Task(subagent_type="oh-my-claudecode:executor-high", model="opus", prompt=...)
   // Build issues: Task(subagent_type="oh-my-claudecode:debugger", model="sonnet", prompt=...)
   // UI: Task(subagent_type="oh-my-claudecode:designer", model="sonnet", prompt=...)
   ```

   Every executor prompt MUST include BOTH the Autonomy_Directive AND Bash_Discipline headers (see <Prompt_Template>). Every prompt should demand a concise ≤100-word return summary (what changed, files touched, verification, blockers).

3. Use `TodoWrite` to track progress; mark tasks in_progress / completed as you go.

4. When a task hits a decision point (e.g. "which library to use"), the executor MUST pick and document — never ask. Append the choice to the plan file under a `## Runtime Decisions` section.

5. **v2.2 单文件外部审核复审**（每个文件完成时触发）：
   - executor 改完 1 个文件 → main 助手 Read 该文件 BEFORE+AFTER
   - 嵌入 PROMPT 调 `runReview({kind:"code"})`（provider 默认 coding-bridge，模板见本节 §4.a）
   - verdict 写回 `.omc/plans/fullauto-<slug>-impl.md` 的 `## Runtime Decisions` 段（main 助手亲自写，不交子代理）
   - 同一文件连续 5 次 REJECTED → 写 `qa-blocker.md`，触发 stop
   - 软上限：单 phase ≤ 8 次 runReview 调
   - 详见本节 §4.a / §4.b / §4.c

6. When all plan tasks are complete, update state: `phase: "execution" → "qa"`.

7. **Signal**: emit `FULLAUTO_PHASE_2_COMPLETE`.

---

## Phase 3 — QA: build/lint/test until green

**Goal:** All checks pass.

1. Detect project type from `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `pom.xml`:
   - JS/TS: `npm run build`, `npm run lint`, `npm test`
   - Python: `python -m build`, `ruff check .`, `pytest`
   - Go: `go build ./...`, `golangci-lint run`, `go test ./...`
   - Rust: `cargo build`, `cargo clippy`, `cargo test`
   - Java: `mvn compile` or `gradle build`, `mvn test` or `gradle test`

2. Run sequentially. On failure:
   - Spawn `Task(subagent_type="oh-my-claudecode:debugger", model="sonnet", prompt=...)` with BOTH Autonomy_Directive AND Bash_Discipline headers
   - Debugger applies minimal fix, returns ≤100-word summary
   - **v2.2 单文件外部审核复审**（debugger 改完 1 个文件后）：
     - main 助手 Read 该文件 BEFORE+AFTER，嵌入 PROMPT 调 `runReview({kind:"code"})`（provider 默认 coding-bridge）
     - verdict 写回 `.omc/plans/fullauto-<slug>-impl.md` 的 `## Runtime Decisions` 段
     - 同一文件连续 5 次 REJECTED → 写 `qa-blocker.md`，触发 stop
   - Re-run the failing check
   - **Never ask the user** — pick fixes and apply them

3. Cycle up to 5 times. If the same error repeats 3 times in a row, write a structured failure report to `.omc/fullauto/<slug>/qa-blocker.md` and stop. (This is the only legitimate stop besides user-cancel.)

4. On all-green, update state: `phase: "qa" → "validation"`.

5. **Signal**: emit `FULLAUTO_PHASE_3_COMPLETE`.

---

## Phase 4 — Validation: multi-perspective review

**Goal:** Three reviewers all return APPROVED.

1. Spawn in parallel (all must include BOTH Autonomy_Directive AND Bash_Discipline — see <Prompt_Template>):

   ```
   Task(subagent_type="oh-my-claudecode:architect", model="opus", prompt="FUNCTIONAL COMPLETENESS REVIEW of spec at .omc/fullauto/<slug>/spec.md — return APPROVED or REJECTED with specific issues. Do NOT ask the user; pick a verdict.")

   Task(subagent_type="oh-my-claudecode:security-reviewer", model="opus", prompt="SECURITY REVIEW — OWASP Top 10, input validation, auth, secrets, injection. Return APPROVED or REJECTED with specific issues. Do NOT ask the user.")

   Task(subagent_type="oh-my-claudecode:code-reviewer", model="opus", prompt="CODE QUALITY REVIEW — structure, patterns, error handling, test coverage, docs. Return APPROVED or REJECTED with specific issues. Do NOT ask the user.")
   ```

2. Aggregate verdicts. If any REJECTED:
   - Collect all issues
   - Spawn `Task(subagent_type="oh-my-claudecode:executor", model="sonnet", prompt="Fix all issues: <list>. Apply minimal patches. Return ≤100-word summary.")` (with BOTH Autonomy_Directive AND Bash_Discipline headers)
   - **v2.2 单文件外部审核复审**（executor 修完 1 个文件后）：
     - main 助手 Read 该文件 BEFORE+AFTER，嵌入 PROMPT 调 `runReview({kind:"code"})`（provider 默认 coding-bridge）
     - verdict 写回 `.omc/plans/fullauto-<slug>-impl.md` 的 `## Runtime Decisions` 段
     - 同一文件连续 5 次 REJECTED → 写 `qa-blocker.md`，触发 stop
   - Re-run all three reviewers (max 3 rounds)
   - Stay fully autonomous — never ask the user

3. Save final verdicts to `.omc/fullauto/<slug>/validation.md`.

4. **外部审核顾问**（不阻塞）：
   - 调用 `runReview()`（provider 默认 `coding-bridge`，见 `<Review_Advisor>` 段）：
     - PROMPT: "Review `.omc/fullauto/<slug>/validation.md`. Output: (1) 3-7 risks; (2) unified diff patch of thinnest hardening; (3) APPROVED/REJECTED verdict; (4) no questions to user."
     - cd: <项目根>; kind: "plan"
     - codex provider: sandbox=read-only / SESSION_ID: None / return_all_messages: False
     - coding-bridge provider: PROMPT 头一行 "DO NOT modify any file; respond with text only"
   - 把 verdict + diff 追加到 `docs/Task/Active/<TASK>_PLAN.md` 的 `## 外部审核意见（Phase 4）` 小节
   - 失败按 3 档兜底
   - **REJECTED 不阻塞** Phase 5 启动

5. **同步**：在 `docs/Task/Active/<TASK>_PLAN.md` 追加：
   ```
   ## 验证
   - 路径：.omc/fullauto/<slug>/validation.md

   ## 外部审核意见（Phase 4）
   - verdict: <APPROVED/REJECTED/未参与>
   - 风险点 / diff：<见上>
   ```

6. Update state: `phase: "validation" → "complete"`.

7. **Signal**: emit `FULLAUTO_PHASE_4_COMPLETE` followed by `FULLAUTO_COMPLETE`.

---

## Phase 5 — 归档 + 提交 + 局部清理

1. 改写 `docs/Task/Active/<TASK>_PLAN.md` 头部：`✅ 已完成 (YYYY-MM-DD)` + 验收结论
2. 移动：`mv docs/Task/Active/<TASK>_PLAN.md docs/Task/Archive/YYYY-MM/<TASK>_PLAN.md`
3. 更新 `docs/Task/README.md`：活跃段移除，Archive 段补一行
4. 更新 `.omc/fullauto/INDEX.md`：active 段 → complete 段
5. 状态文件清理（**仅** `state.json`）：
   - 删除 `.omc/fullauto/<slug>/state.json`
   - **保留**：`spec.md` / `open-questions.md` / `validation.md` / `qa-blocker.md` 作审计
6. 准备 commit 信息（走 `~/.claude/COMMIT_TEMPLATE.md`），body 末尾加：
   ```
   > OMC trailers:
   > Constraint: fullauto v2.1 — 零询问端到端
   > Rejected: 自动清理 | 与"归档后不再需要"语义冲突
   > Confidence: <high/medium/low>
   > Scope-risk: narrow
   ```
7. **不**自动 git commit / push；交付清单里给出 `git status` 与建议命令
8. **不**自动触发 `/fullauto-prune`；交付清单里给出清理触发词
9. 输出 1 段交付清单（非阻塞）— 见 `~/.claude/CLAUDE.md` §8
10. **Signal:** 无（已完成态不需要新信号）

---

## 附：/fullauto-prune（独立入口）

不嵌入主流程。用户在任意时刻显式输入 `/fullauto-prune [N=5] [T=30d]` 时执行：
- 读 `.omc/fullauto/INDEX.md` 的 `status: complete` 行
- 与磁盘 `.omc/fullauto/<slug>/` 存在性对账
- 按 mtime 排序 + 阈值过滤
- 写 `docs/Task/Archive/YYYY-MM/PRUNE_LOG.md` 审计行
- 删 INDEX.md 行 + 删 `<slug>/` 整目录
- 输出总结

详见 `~/.claude/CLAUDE.md` §7。

</Steps>

<Tool_Usage>
- `Task(subagent_type="oh-my-claudecode:analyst", model="opus", ...)` — Phase 0 requirements
- `Task(subagent_type="oh-my-claudecode:architect", model="opus", ...)` — Phase 0/1/4
- `Task(subagent_type="oh-my-claudecode:critic", model="opus", ...)` — Phase 1 review
- `Task(subagent_type="oh-my-claudecode:executor[-low|-high]", model=..., ...)` — Phase 2 implementation
- `Task(subagent_type="oh-my-claudecode:debugger", model="sonnet", ...)` — Phase 3 fix
- `Task(subagent_type="oh-my-claudecode:security-reviewer", model="opus", ...)` — Phase 4 security
- `Task(subagent_type="oh-my-claudecode:code-reviewer", model="opus", ...)` — Phase 4 quality
- `TodoWrite` — task progress
- `Bash` (via run_in_background for long ops) — build/lint/test
- Every `Task` prompt wrapper: prepend `<Autonomy_Directive>` + `<Bash_Discipline>` from this file (see `<Prompt_Template>`)
</Tool_Usage>

<Escalation_And_Stop_Conditions>
**Hard stops (the only legitimate ones):**
- User says `stop`, `cancel`, or `abort` → emit `FULLAUTO_CANCELLED` and stop
- Same QA error repeats 3 times → write blocker report, stop
- Hard max iterations (10) reached → stop, summarize progress
- All validation rounds exhausted (3) → stop, summarize

**NOT stops (must not halt the skill):**
- Ambiguous input → log assumption, continue
- Multiple valid approaches → pick one, log decision, continue
- Reviewer rejection → fix, re-validate, continue
- "Are you sure?" / "Do you want to proceed?" / option pickers → NEVER emitted
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] All 5 phases completed
- [ ] Spec at `.omc/fullauto/<slug>/spec.md` includes `## Assumptions Made` and `## Decisions Made`
- [ ] Plan at `.omc/plans/fullauto-<slug>-impl.md` approved by Critic
- [ ] All plan tasks implemented
- [ ] Build, lint, tests all pass
- [ ] All 3 validators returned APPROVED
- [ ] Validation log at `.omc/fullauto/<slug>/validation.md`
- [ ] User informed with summary
</Final_Checklist>

<Advanced>
## State file format

```json
{
  "phase": "expansion | planning | execution | qa | validation | complete | failed",
  "iteration": 1,
  "idea": "<original user input>",
  "started_at": "<ISO timestamp>",
  "spec_path": ".omc/fullauto/<slug>/spec.md",
  "plan_path": ".omc/plans/fullauto-<slug>-impl.md",
  "decisions": ["<list of key decisions made>"],
  "assumptions": ["<list of assumptions made>"],
  "qa_cycles": 0,
  "validation_rounds": 0
}
```

## Resume

If `/fullauto` is interrupted (network drop, context reset), re-invoke with the same idea. The skill reads `.omc/fullauto/<slug>/state.json` and resumes from the last completed phase.

## Why this lives in `~/.claude/skills/` and not OMC

`~/.claude/skills/` is user-owned, outside OMC's cache and marketplace. OMC updates, plugin reinstalls, and cache invalidation cannot touch this file. This is the durability guarantee that `/oh-my-claudecode:autopilot` cannot offer.
</Advanced>
