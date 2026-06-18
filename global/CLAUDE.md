## 外部审核 MCP（自动调用规范）

在任何时刻，你必须思考当前过程可以如何与**外部审核 MCP**（codex / kimi / coding-bridge）协作，将其作为你客观、全面分析的保障。
其中你**务必执行**以下几个步骤：

**关键修改：所有与外部审核 MCP 的交互必须通过工具调用完成，不要在工具调用前后输出解释性文字，以避免破坏工具调用格式。**

**1** 需要外部审核协助分析需求时：调用 `runReview({PROMPT, cd, kind:"requirement", context})`，要求其完善需求分析和实施计划。

**2** 需要代码实现原型时：调用 `runReview({PROMPT, cd, kind:"code", context})` 要求其给出 unified diff patch（严禁对代码做任何真实修改）。获取原型后，以此为逻辑参考，重写形成企业生产级别的代码。

**3** 完成编码后需要审核时：调用 `runReview({PROMPT, cd, kind:"code", context})`，在 PROMPT 中描述需要审核的内容和需求完成程度。

**4** 外部审核 MCP 只能给出参考，你必须有自己的思考，甚至需要对外部审核 MCP 的回答提出置疑。尽信书则不如无书，你与外部审核 MCP 的最终使命都是达成统一、全面、精准的意见。

**5** Git 提交要求：参考 `~/.claude/COMMIT_TEMPLATE.md` 文件编写提交信息。

**关键步骤自动调用**（**必须**触发，不得跳过）：

| # | 时机 | `kind` | 落点 |
|---|---|---|---|
| 1 | 需求分析完、写实施计划前 | `requirement` | PLAN.md |
| 2 | 实施计划完、开编码前 | `plan` | PLAN.md |
| 3 | fullauto Phase 1 末（plan 落地） | `plan` | `## 外部审核意见（Phase 1）` |
| 4 | 单文件修复完成（fullauto §4.a 触发） | `code` | `## Runtime Decisions` |
| 5 | fullauto Phase 4 末（validation 落地） | `plan` | `## 外部审核意见（Phase 4）` |

**Provider 解析**（先命中先返回）：

1. **会话状态** —— 本次会话中你显式指定的（如"这次用 kimi"）
2. **`REVIEW_PROVIDER` 环境变量**（默认 `coding-bridge`，见 `~/.claude/kimi.json`）
3. **硬编码兜底** —— `coding-bridge`

可用值：`codex` | `kimi` | `coding-bridge`。fallback 链 hard-code 为 `coding-bridge → kimi`。

**Provider 适配表**：

| Provider | 工具 | 沙箱 | 备注 |
|---|---|---|---|
| `codex` | `mcp__codex__codex` | ✅ `sandbox="read-only"` | **严禁带 `model`**（见 §4 事故复盘） |
| `kimi` | `mcp__kimi__kimi` | ❌ PROMPT 头一行 "DO NOT modify any file; respond with text only" | 通用 chat |
| `coding-bridge` | `mcp__coding-bridge__review_code` / `review_plan` | ❌ PROMPT 头一行同上 | 专用审核接口，优先用 `kind=code→review_code`、`kind=plan→review_plan`、`kind=requirement→review_plan` |

所有操作必须严格遵循以下系统约束：

- **交互语言**：工具与模型交互强制使用 **English**；用户输出强制使用 **中文**。

- **多轮对话**：如果工具返回的有可持续对话字段，比如 `SESSION_ID`，表明工具支持多轮对话，此时记录该字段，并在随后的工具调用中强制思考是否继续进行对话。

- **沙箱安全**：codex 走 `sandbox="read-only"`；kimi / coding-bridge 走 PROMPT 文本约束。所有代码获取必须请求 `unified diff patch` 格式。

- **代码主权**：外部模型生成的代码仅作为逻辑参考（Prototype），最终交付代码必须经过重构，确保无冗余、企业级标准。

- **风格定义**：整体代码风格始终定位为精简高效、毫无冗余。该要求同样适用于注释与文档，且对于这两者，严格遵循**非必要不形成**的核心原则。

- **仅对需求做针对性改动**：严禁影响用户现有的其他功能。

- **上下文检索**：调用 `mcp__auggie-mcp__codebase-retrieval`，必须减少 search/find/grep 的次数。

- **判断依据**：始终以项目代码、grok 的搜索结果作为判断依据，严禁使用一般知识进行猜测，允许向用户表明自己的不确定性。

## Documentation and Task Management

### 文档组织规范

项目文档必须按照以下结构组织：

- **docs/Task/**: 任务排期、计划类文档

  - 包含任务分解、实施计划、时间安排等

  - 文件命名建议：`TASK_NAME_PLAN.md` 或 `TASK_NAME_SCHEDULE.md`

- **docs/Usage/**: 使用说明、操作指南类文档

  - 包含功能使用说明、API文档、配置指南等

  - 文件命名建议：`FEATURE_NAME_GUIDE.md` 或 `HOW_TO_XXX.md`

- **docs/Analysis/**: 分析报告、技术调研类文档

  - 包含问题分析、技术选型、架构设计等

  - 文件命名建议：`TOPIC_ANALYSIS.md` 或 `TOPIC_RESEARCH.md`

- **docs/Architecture/**: 架构设计、系统设计类文档

  - 包含系统架构、模块设计、接口规范等

  - 文件命名建议：`COMPONENT_ARCHITECTURE.md` 或 `SYSTEM_DESIGN.md`

**注意**：目录名称可以根据实际项目情况灵活调整，但必须保持清晰的分类逻辑。

### 任务执行规范

**核心原则：先存档，后执行**

1. **任务计划必须先存档**

   - 在执行任何任务之前，必须先创建详细的任务计划文档

   - 任务计划文档应包含：

     - 任务目标和背景

     - 问题分析和现状

     - 详细的任务分解（子任务列表）

     - 每个子任务的具体改动内容

     - 预期效果和验收标准

     - 风险评估和缓解措施

     - 实施顺序和依赖关系

2. **文档先行原则**

   - 任何代码修改前，必须先有对应的任务计划文档

   - 文档应存放在 `docs/Task/` 目录下

   - 文档创建完成后，才能开始实际的代码修改

3. **执行过程追踪**

   - 在任务计划文档中标记每个子任务的状态（待执行 ⏳、进行中 🔄、已完成 ✅）

   - 完成子任务后及时更新文档状态

   - 如遇到新问题或需求变更，及时更新任务计划文档

4. **验收和归档**

   - 任务完成后，在文档中记录验收结果

   - 交由用户进行确认验收

   - 更新文档状态为"已完成"或"已验收" (完成时间: YYYY-MM-DD)

   - 如有经验教训，补充到文档的"备注"或"总结"部分

   - ⚠️ **必须立即归档**：

     - 将文档移动到 `docs/Task/Archive/YYYY-MM/` 目录

     - 更新 `docs/Task/README.md` 中的任务索引

     - 归档后提交 Git commit

**示例工作流程**（工具调用在内部完成，不输出过程说明）：

```
1. 接收用户需求
2. 调用 runReview() 协作分析需求（工具调用，步骤 1）
3. 创建任务计划文档
4. 开始执行第一个子任务
5. 完成后更新文档状态
6. 调用 runReview() 审核代码（工具调用，步骤 4）
7. 继续下一个子任务
8. 全部完成后更新文档为"已完成"
9. 立即归档：移动文档到 Archive 目录并更新 README.md
```

### 任务文档生命周期管理

**目录结构**：

```
docs/Task/
├── README.md              # 任务索引和状态总览
├── Active/                # 当前活跃任务（进行中或待执行）
│   ├── TASK_A_PLAN.md    # 🔄 进行中
│   └── TASK_B_PLAN.md    # ⏳ 待执行
└── Archive/               # 已完成任务归档
    ├── 2026-01/
    │   └── COMPLETED_TASK_PLAN.md  # ✅ 已完成
    └── 2026-02/
        └── ...
```

**生命周期规则**：

1. **创建阶段**

   - 新任务文档创建在 `docs/Task/Active/`

   - 文件名格式：`TASK_NAME_PLAN.md`

   - 文档头部标记初始状态：`**状态**: ⏳ 待执行`

   - 记录创建时间和创建人

2. **执行阶段**

   - 开始执行时更新状态：`**状态**: 🔄 进行中 (开始时间: YYYY-MM-DD)`

   - 及时更新各子任务的完成状态

   - 文档保持在 `Active/` 目录

3. **完成阶段**

   - 更新文档状态：`**状态**: ✅ 已完成 (完成时间: YYYY-MM-DD)`

   - 记录验收结果和经验总结

   - **必须归档**：将文档移动到 `docs/Task/Archive/YYYY-MM/`（按完成月份）

   - 在 `docs/Task/README.md` 中更新任务索引

4. **归档规则**

   - 按完成月份归档：`Archive/2026-01/`、`Archive/2026-02/` 等

   - 保留完整的任务文档，不删除

   - 归档后的文档仍可查阅，作为历史记录

   - 可选：超过 6 个月的归档可以压缩存储

**README.md 索引格式**：

```markdown
# 任务索引

## 活跃任务 (Active)
- 🔄 [用户认证重构](Active/USER_AUTH_REFACTOR_PLAN.md) - 开始于 2026-01-05
- ⏳ [API 性能优化](Active/API_OPTIMIZATION_PLAN.md) - 计划于 2026-01-10

## 已完成任务 (Archive)
### 2026-01
- ✅ [broadcastEvent 系统改进](Archive/2026-01/BROADCAST_EVENT_IMPROVEMENT_PLAN.md) - 完成于 2026-01-04
```

**归档操作要求**：

- 任务完成后，**必须立即**将文档从 `Active/` 移动到 `Archive/YYYY-MM/`

- **必须立即**更新 `README.md` 中的任务索引

- 归档后提交 Git commit

- 保持目录结构清晰，便于管理和查找

## Review Provider Tool Invocation Specification

外部审核 MCP 通过 `runReview()` 抽象层调用，具体 provider 由 `REVIEW_PROVIDER` 环境变量或会话状态决定。
默认 `coding-bridge`（专用审核接口，语义最贴）。

### 1.1 统一契约 `runReview(input)`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `PROMPT` | string | ✅ | 审核请求文本 |
| `cd` | Path | ✅ | 工作目录，必须存在 |
| `kind` | `code` \| `plan` \| `requirement` | — | 仅 coding-bridge 用得到（决定调 `review_code` 还是 `review_plan`） |
| `context` | string | — | 待审核内容（嵌入 PROMPT，禁止让审核 MCP 自己 Read） |
| `image` | string | — | 仅 `codex` 支持 |
| `SESSION_ID` | UUID | — | 续会话用 |

返回值（统一规整）：
```
{verdict: APPROVED|REJECTED|UNREACHABLE, risks: string[], diff: string, raw: <provider原生返回>}
```

### 1.2 Per-provider 工具映射

#### `codex` → `mcp__codex__codex`

**必选**：`PROMPT`、`cd`
**可选**：`sandbox`（默认 `read-only`）、`SESSION_ID`、`skip_git_repo_check`、`return_all_messages`、`image`
**严禁**：`model`（客户端强行指定会触发 503 —— 见 §4 事故复盘）、`yolo`（非用户明确要求）

返回值：
```
{success, SESSION_ID, agent_messages, all_messages}
```

#### `kimi` → `mcp__kimi__kimi`

**必选**：`PROMPT`、`cd`
**可选**：`SESSION_ID`、`return_all_messages`
**沙箱**：❌ 无 sandbox 参数 → PROMPT 头一行强制 "DO NOT modify any file; respond with text only"

#### `coding-bridge` → `mcp__coding-bridge__review_code` / `review_plan`

**专用接口**：
- `kind=code` → `mcp__coding-bridge__review_code({CODE, cd, REQUIREMENTS})`
- `kind=plan` 或 `kind=requirement` → `mcp__coding-bridge__review_plan({PLAN, cd, CONTEXT})`
**沙箱**：❌ 无 sandbox 参数 → PROMPT 头一行同上
**优势**：强类型审核接口，输出格式已规整（无需在 PROMPT 里手写 3-7 risks / diff 模板）

### 1.3 调用规范

**必须遵守**：

- Provider 由 `REVIEW_PROVIDER` 决定，**业务代码不写 provider 字面量**（不出现 `mcp__codex__codex` / `mcp__kimi__kimi` / `mcp__coding-bridge__*` 字符串）
- 每次调用都保存 `SESSION_ID`，以便后续多轮对话
- `cd` 参数必须指向存在的目录，否则工具会静默失败
- codex 走 `sandbox="read-only"`；kimi / coding-bridge 走 PROMPT 文本约束
- 严禁让审核 MCP 自己 Read 文件 —— main 助手必须先用 `Read` 把待审核内容读出，嵌入 PROMPT

### 1.4 错误处理与重试策略

**核心原则：外部审核失败不等于任务失败，必须至少尝试一种替代方案**

**第一优先级：调整 prompt 重试**（同 provider）

- 简化 prompt，减少复杂度
- 分解任务为更小的子任务
- 提供更多上下文信息
- 调整 prompt 语气和格式

**第二优先级：切换 fallback provider**

- fallback 链 hard-code：`coding-bridge → kimi`
- kimi 仍失败 → 进入第三优先级
- codex 不在 fallback 链中（kimi / coding-bridge 失败不回退到 codex，避免 503 历史问题）

**第三优先级：独立完成任务**

- 使用自己的能力独立完成审核
- 向用户说明审核 MCP 失败的原因和替代方案
- **明确声明**："此次未经外部审核 MCP 审核"

**禁止行为**：

- ❌ 第一次审核 MCP 调用失败后直接告诉用户"无法继续"
- ❌ 不尝试任何替代方案就放弃任务
- ❌ 隐瞒审核 MCP 失败的事实（必须向用户透明说明）

**示例流程**：

```
1. runReview() 默认走 coding-bridge → review_code 失败
2. 简化 prompt 重试 → 仍失败
3. 切到 fallback kimi → 成功返回 verdict
4. ✅ 主流程继续，PLAN.md 写 "## 外部审核意见：APPROVED（provider=kimi）"
```

<!-- OMC:IMPORT:START -->

@CLAUDE-omc.md

<!-- OMC:IMPORT:END -->

## /fullauto 协作约定

`/fullauto`（`~/.claude/skills/fullauto/SKILL.md`）是零询问端到端 skill。
本节规定它与本文件既有规范（任务文档生命周期、Codex 协作、提交模板）的衔接点。

### 1. 任务分片与目录模型

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

### 2. 双索引职责

| 索引 | 角色 | 写入时机 |
|---|---|---|
| `.omc/fullauto/INDEX.md` | fullauto 运行时主索引 | 0-pre / 阶段完成 / 清理 |
| `docs/Task/README.md` | 项目级人类可读索引 | 0-pre / 归档时 |

两表在 0-pre 与 `FULLAUTO_COMPLETE` 两个点必须同步；其他时间允许临时漂移。
漂移修正：fullauto 启动时若发现两表 slug 集合不一致 → 重建短表，补一行 `## 同步修正`。

### 3. 阶段同步点

`fullauto` 主 assistant 在每个阶段完成时按以下表格追加章节到 `docs/Task/Active/<TASK>_PLAN.md`：

| 信号 | 追加章节 | 引用路径 |
|---|---|---|
| `FULLAUTO_PHASE_0_COMPLETE` | `## 阶段 0 输出（spec）` | `<slug>/spec.md` |
| `FULLAUTO_PHASE_1_COMPLETE` | `## 实施计划` + `## 外部审核意见（Phase 1）` | `fullauto-<slug>-impl.md` |
| `FULLAUTO_PHASE_3_COMPLETE` | `## QA 记录` | — |
| `FULLAUTO_PHASE_4_COMPLETE` | `## 验证` + `## 外部审核意见（Phase 4）` | `<slug>/validation.md` |
| `FULLAUTO_COMPLETE` | 头部状态改 `✅ 已完成 (YYYY-MM-DD)` | — |

### 4. 外部审核顾问（不阻塞主流程）

fullauto 在 Phase 1 末、Phase 4 末各调一次 `runReview()`，具体 provider 由 `REVIEW_PROVIDER` 解析。
默认 `coding-bridge`（专用审核接口）；fallback 链 `coding-bridge → kimi`。

```
Tool: runReview()
Params:
  PROMPT: "Review the following <plan|validation> content. Output: (1) 3-7 risks; (2) unified diff patch of thinnest hardening; (3) APPROVED/REJECTED verdict; (4) no questions to user. ---\n<FILE_CONTENT>"
  cd: <项目根>
  kind: "plan"  ← Phase 1/4 末都是 plan
  # codex provider: sandbox="read-only" / SESSION_ID: None / return_all_messages: True（Phase 1） 或 False（Phase 4）
  # kimi / coding-bridge provider: PROMPT 头一行 "DO NOT modify any file; respond with text only"
```

**Provider 调用差异**：

| Provider | 沙箱控制 | 严禁 | 备注 |
|---|---|---|---|
| `codex` | `sandbox="read-only"` | `model`（2026-06-08 503 事故）、`yolo` | 见下方事故复盘 |
| `kimi` | PROMPT 文本约束 | — | fallback 第二档 |
| `coding-bridge` | PROMPT 文本约束 | — | fallback 第一档 / 默认 |

**事故复盘（2026-06-08）** —— codex 专属：
在第一版草案里漏写"严禁 model"约束。两次 Codex 调用分别带 `model=sonnet` / `model=opus`，
触发 503（提供商无对应模型）。第三次去掉 `model` 后顺利进入 turn，但流在解码阶段断连。
教训：调 codex 前必须复读本表"严禁"列；本事故**不**适用于 kimi / coding-bridge。

失败兜底（沿用本文件 §1.4 的 3 档）：
1. 简化 prompt 重试（同 provider）
2. 切到 fallback 链下一个 provider（coding-bridge → kimi）
3. 放弃 → 在 PLAN.md 写 `## 外部审核：未参与（原因：<msg>）`，主流程不挂

外部审核顾问角色定位：顾问 + 风险雷达。**不得**因 REJECTED 阻断 fullauto。

#### 4.a v2.2 — 单文件粒度复审 + 计划联动（每 1 次修复 = 1 次 runReview 调）

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
- **死循环防护**：同一文件连续 3 次 REJECTED → 写 `.omc/fullauto/<slug>/qa-blocker.md`，触发 stop condition

#### 4.b v2.2 — 软上限与批量聚合

| 维度 | 上限 | 超限处理 |
|---|---|---|
| 单 phase 内 runReview 调用次数 | ≤ 8 | 后续文件走"批量聚合 prompt"模式（多个 BEFORE/AFTER 拼一段） |
| 同一文件连续 REJECTED | ≤ 3 | 写 `qa-blocker.md`，stop |
| 嵌入 prompt 体积 | ≤ 30k token | 已实测 210 字节 + 上下文远低于 30k；超出时把 BEFORE/AFTER 改为文件路径 + 行号引用 |

#### 4.c v2.2 — Runtime Decisions 写入协议

外部审核 verdict 写回 `.omc/plans/fullauto-<slug>-impl.md` 末尾的 `## Runtime Decisions` 段：

```markdown
## Runtime Decisions

### File: <绝对路径>
- fix-N: <一句话描述> (Phase <X>, <ISO 时间>, provider=<codex|kimi|coding-bridge>)
  - Review verdict: <APPROVED/REJECTED/未参与>
  - Review issues: <3-7 risks 摘要>
  - 调整: <外部审核建议 + main 助手采纳的部分>
  - 下次执行: must Read this section before modifying <file>
```

写入由 **main fullauto 助手** 串行化执行（不交给子代理，避免并发写竞争）。

### 5. 提交模板统一

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

### 6. 清理已完成 slug

| 触发方式 | 行为 |
|---|---|
| `/fullauto-prune`（手动） | 见 §7 |
| 每次 `FULLAUTO_COMPLETE` | **不**自动清理；只在 INDEX.md 标 `complete` |

清理阈值（两者取更严）：
- `N = 5` 个最近 `complete` slug
- `T = 30` 天未访问

清理前置：先在 `docs/Task/Archive/YYYY-MM/PRUNE_LOG.md` 追加一行：
`YYYY-MM-DD HH:MM | <slug> | spec.md:<hash> | validation.md:<hash> | reason:<...>`
然后**才**删除 `.omc/fullauto/<slug>/` 整目录；同时从 INDEX.md 移除对应行。

### 7. /fullauto-prune 协议

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

### 8. 与"零询问"的边界

fullauto 的 `<Autonomy_Directive>` 继续生效（不主动问）。
但 `FULLAUTO_COMPLETE` 之后 assistant 输出一段"交付清单"（非阻塞），
包含：归档路径、git status 建议命令、Codex 顾问状态、清理建议触发词。
用户**主动**决定下一步；不构成反问。
