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
- PR titles follow the project's commit convention (typically Conventional Commits). If the project uses scoped prefixes, match its actual style — see the project's `AGENTS.md` (or `CLAUDE.md`) for examples.
- If the project has a PR template (e.g. `.github/PULL_REQUEST_TEMPLATE.md`), fill it in. Do not leave placeholder text or paste a generic diff summary.
- The human author — not the agent — must be able to explain the change, its edge cases, and why this approach fits this repository. Agents must not submit PRs the human cannot defend in review.
- Do not stage throwaway scratch or design mockups. Before `git commit`, run `git status` and `git diff --staged --stat` and remove anything that doesn't belong. If the project provides a scratch directory (e.g. `.tmp/`), put scratch work there.

### Commit trigger policy

- **Default**: agent MUST NOT execute `git commit` / `git push` / open a PR /
  merge a PR on its own initiative. These actions only run after the user
  gives an **explicit verb instruction** in the current session, e.g.:
  - "commit it" / "commit this" / "提交" / "commit 一下"
  - "push it" / "open the PR" / "merge it" / "推送" / "开 PR" / "合并"
- **Does NOT count as an explicit instruction**:
  - Generic acknowledgements: "continue", "ok", "go ahead", "looks good",
    "可以", "好的".
  - Implied consent from earlier framing ("do X when you're done" does not
    authorize commit).
- **Helper operations the agent may perform without instruction**:
  - Read-only / reversible commands: `git add`, `git status`, `git diff`,
    `git log`, `git stash` (only when stashing unpushed content).
  - Drafting the commit message, assembling the trailer block, preparing
    the PR description — writing a draft to a file is NOT the same as
    executing `git commit`.

## External Review MCP

**Full protocol: `~/.minimax/EXTERNAL_REVIEW.md` (source `dotclaude-portable/global/EXTERNAL_REVIEW.md`).** It is not auto-loaded. `Read` it before executing any review step; it holds the normative provider resolution, verdict parsing, call signatures, retry ladder, and the 5-round loop. What follows is the always-on core.

### Runtime availability gate (check FIRST)

The External Review MCP may not exist in the current session. Confirm the tools are actually in the tool list before treating any step below as mandatory:

| Tool | Requires |
|---|---|
| `mcp__coding-bridge__review_code` / `review_plan` / `chat` | a configured `coding-bridge` MCP server |
| `mcp__codex__codex` | a configured `codex` MCP server |
| `mcp__auggie-mcp__codebase-retrieval` | a configured `auggie-mcp` MCP server |

- **If configured** → follow the full protocol as written.
- **If absent** → the External Review MCP steps are **inapplicable, not failed**. Do not search for a `runReview` shell command, hook, or `tools/*` script to "make it work" — none exists. Proceed without it, and state once in the final response: `本次未经过 External Review MCP 审查(当前运行时未配置该 MCP)`. Then cross-verify with local static analysis, unit tests, and type checks.
- **Never** fabricate a review verdict, and never report a step as done when the tool is unavailable.

### Mandatory trigger timings

| # | Timing | `kind` |
|---|---|---|
| 1 | After requirements analysis, before writing the plan | `requirement` |
| 2 | After the plan, before starting coding | `plan` |
| 3-pre | End of fullauto Phase 0 (spec landing) | `plan` |
| 3 | End of fullauto Phase 1 (plan landing) | `plan` |
| 4 | Single-file fix complete | `code` |
| 5 | End of fullauto Phase 4 (validation landing) | `plan` |

**Interaction language**: tool↔model in English; user-facing output in Chinese. All MCP interaction happens via tool calls — no explanatory text before or after them.

**`runReview()` does not exist.** It is a verbal alias, not a function, in any runtime. Call the MCP tool directly.

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

> **Scope threshold.** This documentation workflow is a **global default, not an absolute**. Skip it for: single-file fixes, mechanical edits, formatting, dependency bumps, and anything a senior engineer would not write a ticket for. A repo that ships its own task-doc convention **overrides this section entirely** — follow the repo's `AGENTS.md` instead. When in doubt, ask the user rather than creating ceremony.

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

   - For tasks that pass the scope threshold above, a corresponding task plan document must exist before code modification

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
2. Review requirements -> mcp__coding-bridge__review_plan (only if the MCP is configured)
3. Create task plan document
4. Begin executing the first sub-task
5. Update document status after completion
6. Review the code -> mcp__coding-bridge__review_code
7. Continue with the next sub-task
8. Mark "completed" once all sub-tasks are done
9. Archive to Archive/YYYY-MM/ and update README.md
```
### Task Document Lifecycle Management

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

**`README.md` index**: list Active tasks with a status emoji and start date, then archived tasks grouped by month. Keep it a flat, scannable index.
**Archive operation requirements**:

- After task completion, **must immediately** move the document from `Active/` to `Archive/YYYY-MM/`

- **Must immediately** update the task index in `README.md`

- Submit a Git commit after archiving

- Keep the directory structure clean for easy management and lookup

## Runtime-specific includes

> Read this section only if the corresponding runtime feature is actually present. Both blocks below are **inert by default in runtimes that do not provide them**, and must not be treated as instructions to go install or reconstruct them.

### OMC collaboration agreement (import)

- **Claude Code**: the `<!-- OMC:IMPORT:START -->` / `@CLAUDE-omc.md` markers in this file are expanded by Claude Code's import mechanism.
- **Other runtimes** (MiniMax Code and equivalents): the import syntax is **not** resolved, and the referenced file may not exist. Treat any `@FILE.md` line as a **plain-text pointer, not a loaded instruction**. If that content is required, `Read` the file explicitly; if it is missing, continue without it and say so.

### `/fullauto` collaboration agreement

- **Claude Code**: the authoritative content (task slicing, dual index, phase synchronization, §4 external review, §4.a–§4.c single-file granularity, §4.d manual review, §5 commit template, §6/§7 cleanup, §8 zero-ask boundary) lives in the `## Collaboration Agreement` section of `~/.claude/skills/fullauto/SKILL.md`. Before any `/fullauto` task, `Read` that file. Do not duplicate the protocol here — it drifts.
- **Runtimes without a `fullauto` skill** (MiniMax Code and equivalents): **this section is inert.** There is no `/fullauto` command to execute. Do not attempt to read the path, and do not reconstruct the protocol from this pointer. Use the `## Documentation and Task Management` section above as the general task workflow.
