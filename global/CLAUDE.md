**Version**: v2.4.0 (2026-09-05)

## Working Principles

- Think from first principles. Start from real requirements, code facts, and verification results; if the goal is unclear, discuss it with the user first.
- Code is the source of truth for behavior; **rule documents** (`CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, the project's PR template) are authoritative for workflow. Don't read other Markdown to reverse-engineer code that's right there.
- Keep changes focused. Don't slip in unrelated refactors or formatting churn along the way.
- Commit messages and PR descriptions must not include `Co-Authored-By:` lines, AI tool attribution, or references to the authoring agent. Use the project's trailer convention instead (e.g. the `OMC trailers` block: `Constraint:` / `Rejected:` / `Directive:` / `Confidence:` / `Scope-risk:` / `Not-tested:`).

## Workflow Requirements

- Prefer `rg` / `rg --files` over `grep` / `find` when reading code.
- Follow existing file/module boundaries and local conventions before introducing new patterns.
- For any **new** public-facing text or test data, use neutral placeholders (`example.com`, `example.test`, `YOUR_API_KEY`) instead of real internal hosts, paths, or credentials. Projects may exempt specific files (e.g. portable config payloads) by listing them in the project's `CLAUDE.md`.
  Before opening a PR, audit the diff with `rg` over changed paths; if the project ships a secret-scanning tool, run that too.
- PR titles follow the project's commit convention (typically Conventional Commits). If the project uses scoped prefixes, match its actual style — see the project's `CLAUDE.md` for examples.
- If the project has a PR template (e.g. `.github/PULL_REQUEST_TEMPLATE.md`), fill it in. Do not leave placeholder text or paste a generic diff summary.
- The human author — not the agent — must be able to explain the change, its edge cases, and why this approach fits this repository. Agents must not submit PRs the human cannot defend in review.
- Do not stage throwaway scratch or design mockups. Before `git commit`, run `git status` and `git diff --staged --stat` and remove anything that doesn't belong. If the project provides a scratch directory (e.g. `.tmp/`), put scratch work there.

## External Review MCP (Auto-Invocation Specification)

> **Critical clarification: `runReview()` is a verbal alias, NOT an implemented function.**
>
> Throughout this document you will see references to "call `runReview({...})`". This is shorthand for "use the External Review MCP". There is **no `runReview()` function** in the runtime — neither in shell, nor in `tools/`, nor in any hook. The actual call sites are **direct MCP tool invocations** by the main assistant:
>
> | `kind` | Actual tool call |
> |---|---|
> | `"code"` | `mcp__coding-bridge__review_code({CODE, cd, REQUIREMENTS})` |
> | `"plan"` / `"requirement"` | `mcp__coding-bridge__review_plan({PLAN, cd, CONTEXT})` |
> | generic chat / fallback | `mcp__coding-bridge__chat({PROMPT, cd})` |
> | fallback `codex` provider | `mcp__codex__codex({PROMPT, cd})` (forbidden `model` / `yolo`) |
>
>
> **Why this clarification exists**: an earlier audit (2026-06-27) found that the literal string `runReview` only appears in documentation, in `hooks/review-watchdog.mjs` (which *grep-detects* it in transcripts, not implements it), and in `tools/configure.mjs` (which only writes `.env` fields). No runtime code dispatches `REVIEW_PROVIDER` to a provider. If you read "call `runReview()`" and try to invoke a function, you will waste a turn — call the MCP tool directly.

At any moment, you must consider how the current process can collaborate with the **External Review MCP** (codex / coding-bridge) as a guarantee for your objective and comprehensive analysis.
You **must execute** the following steps:

<EXTREMELY-IMPORTANT>
**Calling `codex` strictly forbids the `model` parameter** (root cause of the 2026-06-08 503 incident).
**Calling `codex` strictly forbids the `yolo` parameter** (unless explicitly required by the user).
See §4 Incident Retrospective for details.
</EXTREMELY-IMPORTANT>

**Key change: All interactions with the External Review MCP must be completed via tool calls. Do not output explanatory text before or after tool calls, to avoid breaking the tool call format.**

**1** When you need external review assistance to analyze requirements: call `runReview({PROMPT, cd, kind:"requirement", context})` and ask it to refine the requirements analysis and implementation plan.

**2** When you need a code prototype: call `runReview({PROMPT, cd, kind:"code", context})` and ask for a unified diff patch (strictly forbidden to make any real modifications to code). After obtaining the prototype, use it as logical reference to rewrite into enterprise production-grade code.

**3** When you need review after coding is complete: call `runReview({PROMPT, cd, kind:"code", context})`, describing in PROMPT what needs to be reviewed and the degree of requirement completion.

**4** The External Review MCP can only provide reference. You must have your own thinking, and even question the External Review MCP's answers. Blind faith in books is worse than having no books; both you and the External Review MCP share the ultimate mission of reaching unified, comprehensive, and precise opinions.

**5** Git commit requirements: write the commit message following the `~/.claude/COMMIT_TEMPLATE.md` file.
Note: `COMMIT_TEMPLATE.md` already contains the OMC trailer block at its end (`Constraint:` / `Rejected:` / `Directive:` / `Confidence:` / `Scope-risk:` / `Not-tested:`); **all commits must preserve this block**.

**Mandatory step auto-invocation** (**must** trigger, cannot be skipped):

| # | Timing | `kind` | Landing Point |
|---|---|---|---|
| 1 | After requirements analysis, before writing the implementation plan | `requirement` | PLAN.md |
| 2 | After the implementation plan, before starting coding | `plan` | PLAN.md |
| 3-pre | End of fullauto Phase 0 (spec landing) | `plan` | `## External Review Opinion (Phase 0)` |
| 3 | End of fullauto Phase 1 (plan landing) | `plan` | `## External Review Opinion (Phase 1)` |
| 4 | Single-file fix complete (fullauto §4.a / manual §4.b trigger) | `code` | `## Runtime Decisions` |
| 5 | End of fullauto Phase 4 (validation landing) | `plan` | `## External Review Opinion (Phase 4)` |

**Provider resolution** (first match wins):

1. **Session state** — explicitly specified by you in this session (e.g., "this time use codex")
2. **`REVIEW_PROVIDER` environment variable** (default `coding-bridge`)
3. **Hard-coded fallback** — `coding-bridge`

Allowed values: `codex` | `coding-bridge`. Fallback chain is hard-coded as `coding-bridge → codex`.

**Provider Adaptation Table**:

| Provider | Tool | Sandbox | Notes |
|---|---|---|---|
| `codex` | `mcp__codex__codex` | ✅ `sandbox="read-only"` | **Strictly forbid `model`** (see §4 Incident Retrospective) |
| `coding-bridge` | `mcp__coding-bridge__review_code` / `review_plan` | ❌ PROMPT first line same as above | Dedicated review interface with strongly-typed `kind` parsing (`code` → `review_code`; `plan` / `requirement` → `review_plan`) |

All operations must strictly follow the system constraints below:

- **Interaction language**: tool↔model interaction **must** use **English**; user-facing output **must** use **Chinese**.

- **Multi-turn dialogue**: if a tool return contains a continuous-conversation field such as `SESSION_ID`, it indicates the tool supports multi-turn dialogue. Record this field and force consideration of whether to continue the conversation in subsequent tool calls.

- **Sandbox safety**: codex uses `sandbox="read-only"`; coding-bridge use PROMPT text constraints. All code acquisitions must request `unified diff patch` format.

- **Code sovereignty**: code generated by external models is only a logical reference (Prototype); final delivered code must be refactored to ensure no redundancy and meet enterprise-grade standards.

- **Style definition**: the overall code style is always positioned as concise, efficient, and without redundancy. This requirement also applies to comments and documentation, and for these two, strictly follow the core principle of **"do not create unless necessary"**.

- **Only make targeted changes to requirements**: strictly forbidden to affect other existing user functionality.

- **Context retrieval**: when calling `mcp__auggie-mcp__codebase-retrieval`, you must reduce the number of search/find/grep invocations.

- **Basis for judgment**: always use project code and the actual returned results from external retrieval/review MCP as the basis for judgment. Strictly forbidden to guess with general knowledge. You may express your uncertainty to the user.

## Documentation and Task Management

### Documentation Organization Specification

Project documentation must be organized according to the following structure:

- **docs/Task/**: task scheduling and planning documents

  - Contains task breakdown, implementation plan, time arrangement, etc.

  - File naming suggestion: `TASK_NAME_PLAN.md` or `TASK_NAME_SCHEDULE.md`

- **docs/Usage/**: usage instructions and operation guides

  - Contains feature usage instructions, API documentation, configuration guides, etc.

  - File naming suggestion: `FEATURE_NAME_GUIDE.md` or `HOW_TO_XXX.md`

- **docs/Analysis/**: analysis reports and technical research documents

  - Contains problem analysis, technical selection, architecture design, etc.

  - File naming suggestion: `TOPIC_ANALYSIS.md` or `TOPIC_RESEARCH.md`

- **docs/Architecture/**: architecture design and system design documents

  - Contains system architecture, module design, interface specifications, etc.

  - File naming suggestion: `COMPONENT_ARCHITECTURE.md` or `SYSTEM_DESIGN.md`

**Note**: directory names can be flexibly adjusted based on actual project circumstances, but clear classification logic must be maintained.

### Task Execution Specification

**Core principle: archive first, execute later**

1. **Task plan must be archived first**

   - Before executing any task, a detailed task plan document must be created

   - The task plan document should contain:

     - Task objectives and background

     - Problem analysis and current state

     - Detailed task breakdown (sub-task list)

     - Specific change content for each sub-task

     - Expected effect and acceptance criteria

     - Risk assessment and mitigation measures

     - Implementation order and dependency relationships

2. **Documentation-first principle**

   - Before any code modification, there must be a corresponding task plan document

   - The document should be stored under the `docs/Task/` directory

   - Actual code modification can only begin after the document is created

3. **Execution process tracking**

   - Mark the status of each sub-task in the task plan document (pending ⏳, in progress 🔄, completed ✅)

   - Update the document status promptly after completing sub-tasks

   - Update the task plan document promptly when encountering new issues or requirement changes

4. **Acceptance and archiving**

   - Record acceptance results in the document after task completion

   - Submit to the user for confirmation and acceptance

   - Update the document status to "completed" or "accepted" (completion time: YYYY-MM-DD)

   - If there are lessons learned, add them to the document's "Remarks" or "Summary" section

   - ⚠️ **Must archive immediately**:

     - Move the document to the `docs/Task/Archive/YYYY-MM/` directory

     - Update the task index in `docs/Task/README.md`

     - Submit a Git commit after archiving

**Example workflow** (tool calls complete internally, no process description output):

```
1. Receive user requirement
2. Call runReview() to collaborate on requirement analysis (tool call, step 1)
3. Create task plan document
4. Begin executing the first sub-task
5. Update document status after completion
6. Call runReview() to review code (tool call, step 4)
7. Continue with the next sub-task
8. Update document to "completed" after all are done
9. Archive immediately: move document to Archive directory and update README.md
```

### Task Document Lifecycle Management

**Directory structure**:

```
docs/Task/
├── README.md              # Task index and status overview
├── Active/                # Currently active tasks (in progress or pending)
│   ├── TASK_A_PLAN.md    # 🔄 In progress
│   └── TASK_B_PLAN.md    # ⏳ Pending
└── Archive/               # Archived completed tasks
    ├── 2026-01/
    │   └── COMPLETED_TASK_PLAN.md  # ✅ Completed
    └── 2026-02/
        └── ...
```

**Lifecycle rules**:

1. **Creation phase**

   - New task documents are created in `docs/Task/Active/`

   - File name format: `TASK_NAME_PLAN.md`

   - Document header marks initial status: `**Status**: ⏳ Pending`

   - Record creation time and creator

2. **Execution phase**

   - Update status when starting execution: `**Status**: 🔄 In progress (start time: YYYY-MM-DD)`

   - Update sub-task completion status promptly

   - Document remains in the `Active/` directory

3. **Completion phase**

   - Update document status: `**Status**: ✅ Completed (completion time: YYYY-MM-DD)`

   - Record acceptance results and experience summary

   - **Must archive**: move the document to `docs/Task/Archive/YYYY-MM/` (by completion month)

   - Update the task index in `docs/Task/README.md`

4. **Archive rules**

   - Archive by completion month: `Archive/2026-01/`, `Archive/2026-02/`, etc.

   - Preserve complete task documents; do not delete

   - Archived documents remain accessible as historical records

   - Optional: archives older than 6 months can be compressed for storage

**README.md index format**:

```markdown
# Task Index

## Active Tasks
- 🔄 [User Auth Refactor](Active/USER_AUTH_REFACTOR_PLAN.md) - Started 2026-01-05
- ⏳ [API Performance Optimization](Active/API_OPTIMIZATION_PLAN.md) - Planned for 2026-01-10

## Completed Tasks (Archive)
### 2026-01
- ✅ [broadcastEvent System Improvement](Archive/2026-01/BROADCAST_EVENT_IMPROVEMENT_PLAN.md) - Completed 2026-01-04
```

**Archive operation requirements**:

- After task completion, **must immediately** move the document from `Active/` to `Archive/YYYY-MM/`

- **Must immediately** update the task index in `README.md`

- Submit a Git commit after archiving

- Keep the directory structure clean for easy management and lookup

## Review Provider Tool Invocation Specification

The External Review MCP is invoked through the `runReview()` abstraction layer; the specific provider is determined by the `REVIEW_PROVIDER` environment variable or session state.
Default is `coding-bridge` (dedicated review interface, semantics match best).

### 1.1 Unified Contract `runReview(input)`

| Field | Type | Required | Description |
|---|---|---|---|
| `PROMPT` | string | ✅ | Review request text |
| `cd` | Path | ✅ | Working directory, must exist |
| `kind` | `code` \| `plan` \| `requirement` | — | Only coding-bridge uses it (decides whether to call `review_code` or `review_plan`) |
| `context` | string | — | Content to be reviewed (embedded in PROMPT; forbidden to let the review MCP Read by itself) |
| `image` | string | — | Only `codex` supports |
| `SESSION_ID` | UUID | — | For continuing the session |
| `kind` compatibility | — | `codex` **ignore**; only `coding-bridge` parses (`code` → `review_code`; `plan` / `requirement` → `review_plan`) |

Return value (unified normalization):
```
{verdict: APPROVED|REJECTED|UNREACHABLE, risks: string[], diff: string, raw: <provider native return>}
```

### 1.2 Per-provider Tool Mapping

#### `codex` → `mcp__codex__codex`

**Required**: `PROMPT`, `cd`
**Optional**: `sandbox` (default `read-only`), `SESSION_ID`, `skip_git_repo_check`, `return_all_messages`, `image`
**Strictly forbidden**: `model` (forcing it client-side triggers 503 — see §4 Incident Retrospective), `yolo` (unless explicitly required by the user)

Return value:
```
{success, SESSION_ID, agent_messages, all_messages}
```

#### `coding-bridge` → `mcp__coding-bridge__review_code` / `review_plan`

**Dedicated interface**:
- `kind=code` → `mcp__coding-bridge__review_code({CODE, cd, REQUIREMENTS})`
- `kind=plan` or `kind=requirement` → `mcp__coding-bridge__review_plan({PLAN, cd, CONTEXT})`
**Sandbox**: ❌ No sandbox parameter → PROMPT first line same as above
**Advantage**: strongly-typed review interface; output format is already normalized (no need to manually write 3-7 risks / diff templates in PROMPT)

### 1.3 Invocation Specification

**Must observe**:

- The provider is determined by `REVIEW_PROVIDER`. **The provider literal lives only in the main assistant's MCP tool call** (per §1.0) — no runtime shell script, hook, or `tools/*` script dispatches by `REVIEW_PROVIDER`. If you find yourself wanting to "wrap" the call, you're reinventing the verbal alias — just call the MCP tool directly.
- Save `SESSION_ID` on every call for subsequent multi-turn dialogue
- The `cd` parameter must point to an existing directory, otherwise the tool will silently fail
- codex uses `sandbox="read-only"`; coding-bridge use PROMPT text constraints
- Strictly forbidden to let the review MCP Read files by itself — the main assistant must first use `Read` to read the content to be reviewed and embed it in PROMPT

### 1.4 Error Handling and Retry Strategy

**Core principle: External review failure does not equal task failure; at least one alternative must be attempted**

**First priority: adjust prompt and retry** (same provider)

- Simplify the prompt to reduce complexity
- Break the task into smaller sub-tasks
- Provide more context information
- Adjust the tone and format of the prompt

**Second priority: switch fallback provider**

- Fallback chain is hard-coded: `coding-bridge → codex`. codex MCP strictly forbids `model` (see §4 Incident Retrospective) — do not pass it when falling back.

**Third priority: complete the task independently**

- Call local static analysis / unit tests / third-party tools for cross-verification; **the main assistant must not unilaterally self-review**
- Explain the reason for the review MCP failure and alternatives to the user
- **Explicitly declare**: "This time has not been reviewed by the External Review MCP"

**Prohibited actions**:

- ❌ Telling the user "cannot continue" directly after the first review MCP call fails
- ❌ Giving up the task without trying any alternative
- ❌ Concealing the fact that the review MCP failed (must transparently explain to the user)

**Example flow**:

```
1. runReview() defaults to coding-bridge → review_code fails
2. Simplify prompt and retry → still fails
3. Switch to fallback codex (`mcp__codex__codex`, no `model` param) → verdict returned
4. ✅ Main flow continues; PLAN.md writes "## External Review Opinion: APPROVED (provider=codex)"
```

### 1.5 Review Loop Protocol (verdict-driven fix-re-review)

**Core principle: a review is closed only by `verdict == APPROVED`, not by a single call.** §1.4 governs tool-unreachable retries (switch provider); this section governs verdict-not-pass retries (fix and re-review). The two are orthogonal - a NOT_APPROVED verdict is never retried by switching provider, and an UNREACHABLE tool is never "fixed" by editing code.

**Pass criterion & verdict vocabulary**:

- `APPROVED` (with or without minor `suggestions`) = pass. Suggestions are recorded in PLAN.md but do not block.
- `REJECTED` or `NEEDS_CHANGES` = NOT_APPROVED. The provider MUST list `risks[]`; the main assistant MUST address every risk, then re-invoke the same-`kind` review.
- `UNKNOWN` (verdict unparseable from tool_result) = treated as NOT_APPROVED (fail-closed).

**Loop upper bound**: `REVIEW_MAX_ROUNDS=5` (env overridable). Each round's verdict is written to PLAN.md `## External Review Opinion` section as `Round N/5`. The main assistant is the single writer of the round counter; hooks are read-only observers and MUST NOT increment it. Counters reset when the timing closes (APPROVED or exhaustion). On exhaustion, the report MUST state which cap triggered (timing 5-round vs per-file 5× breaker) so the user can distinguish a single-file deadlock from a global timing timeout.

**Exhaustion handling** (round 5 still NOT_APPROVED):

- MUST stop and surface residual `risks[]` to the user; the current task queue is paused pending user intervention.
- This stop is classified as a `hard max iterations` legitimate stop condition under the fullauto `Autonomy_Directive` (NOT an interactive prompt - it is a terminal stop, not a clarification request).
- Forbidden: silently downgrading to "best-effort" close-out, dropping the loop early, or concealing residual risks.

**Applicable timings** (see auto-invocation table in the spec header):

- Code-kind timings (#4 single-file fix, #5 Phase 4 validation) loop by default.
- Plan-kind timings (#1 requirement, #2 plan, #3-pre / #3 / #5 Phase 0 / 1 / 4) default to 1 round; append a round only on REJECTED / NEEDS_CHANGES.

**Verdict extraction contract** (parser-authoritative; real samples under `docs/samples/`):

1. Parse `tool_result.content[0].text` as JSON -> `result.agent_messages`.
2. Extract verdict in order: (a) ` ```json ` fence JSON `verdict` field (codex form); (b) multi-level markdown LAST-match (coding-bridge form - each level takes the LAST occurrence to avoid false-hit on verdict words quoted in preamble): bold `**VERDICT**` > title `审查结论: VERDICT` / `Verdict: VERDICT` > bare word `APPROVED|REJECTED|NEEDS_CHANGES`.
3. Unparseable -> `UNKNOWN` -> NOT_APPROVED (fail-closed).

**Override declaration**: this protocol takes precedence over the `REJECTED does not block main flow` default in `~/.claude/skills/fullauto/SKILL.md` `Review_Advisor`. The SKILL.md `same-file 3× REJECTED -> qa-blocker stop` guard is superseded by this 5-round cap (counted at the review-timing scope, not per-file).

**Scope-matching degradation** (watchdog): when the review's file scope cannot be reliably extracted from the tool call, degrade to fail-closed - any unresolved NOT_APPROVED in the current session warns on any Write/Edit of a code file.

<!-- OMC:IMPORT:START -->

@CLAUDE-omc.md

<!-- OMC:IMPORT:END -->

## /fullauto Collaboration Agreement

> **Authoritative source migration**: the content of this section (task slicing, dual index, phase synchronization points, §4 external review, §4.a–§4.c single-file granularity, §4.d manual mode review, §5 commit template, §6/§7 cleanup protocol, §8 zero-ask boundary) has been migrated to the `## Collaboration Agreement` section of `~/.claude/skills/fullauto/SKILL.md`.
>
> **Strictly forbidden to maintain this protocol in this file**—to avoid dual-source drift. If adjustments are needed, please directly modify SKILL.md; this section remains as a pointer.
>
> **Strong guidance**: before any `/fullauto` task execution, you must first `Read ~/.claude/skills/fullauto/SKILL.md` to load the `## Collaboration Agreement` section (load on demand trigger).
