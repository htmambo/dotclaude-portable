# Project Working Agreement (dotclaude-portable)

This file is auto-loaded by Claude Code when working in this repository. It
supplements the user's universal rules (`global/CLAUDE.md`, symlinked to
`~/.claude/CLAUDE.md`) and the human-facing docs (`CONTRIBUTING.md`, `README.md`,
`CHANGELOG.md`).

The conventions below apply **only to work on this repo itself** (commits,
PRs, files staged here). They do **not** ship to end users via `install.sh`.

## Project-Specific Conventions

- **Commit convention**: scoped Conventional Commits, matching this repo's actual style. Examples: `fix(install):`, `feat(install):`, `chore(mcp):`, `chore(docs):`, `refactor(tools):`. Concrete: `fix(install): 修复 install-lsp-servers 评审发现的退出码问题`.
- **PR template**: `.github/PULL_REQUEST_TEMPLATE.md` exists — fill it in for every PR. Link the related issue (or explain the problem if there is none), then describe what changed and why.
- **Trailer block**: every commit must end with the OMC trailers block (`Constraint:` / `Rejected:` / `Directive:` / `Confidence:` / `Scope-risk:` / `Not-tested:`). The block is required, not an attribution.
- **Secret scan before PR**: run `python3 tools/scan-secrets.py .` (already wired into the pre-push hook). The global neutral-placeholder rule is enforced by this scan.
- **Portable payload exemption**: `global/json/*.base.json` is the portable config shipped to end users via `install.sh`. It is intentionally real and is **exempt** from the global neutral-placeholder rule.
- **Forbidden artifacts at repo root**:
  - any `*.html` file that is not a Vite `index.html` entrypoint
  - `*-designs.html`, `*-mockup.html`, `*-demo.html` (under root or any `design/` directory)
  - Put scratch work under `.tmp/` (gitignored). The repo root must not accumulate scratch files.
- **Code style**: see `CONTRIBUTING.md` §代码风格 — bash 4.0+ with `set -euo pipefail`, Python 3.6+ with `from __future__ import annotations`, comments are 非必要不形成.

## See also

- `global/CLAUDE.md` — universal working principles + External Review MCP + fullauto agreement (symlinked to `~/.claude/CLAUDE.md`)
- `CONTRIBUTING.md` — development workflow, PR checklist, code style
- `CHANGELOG.md` — Keep-a-Changelog format, SemVer (`### BREAKING` for breaking changes)
