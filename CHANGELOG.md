# Changelog

All notable changes to **dotclaude-portable** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows
[SemVer](https://semver.org/).

## [1.0.4] - 2026-06-19

### Added

- `hooks/review-watchdog.mjs` (96 lines): PostToolUse hook listening on Write|Edit tools
  - When a code file (`.py` `.ts` `.js` `.tsx` `.jsx` `.go` `.rs` `.java` `.kt` `.swift` `.c` `.cpp` `.h` `.sh` `.sql`, plus `pyproject.toml` / `package.json` / `Cargo.toml` / `go.mod` / `tsconfig.json` / `requirements.txt` / `Pipfile`) is touched, scans the current session transcript for `runReview` / `review_code` / `review_plan` / `mcp__coding-bridge__` references
  - If none detected → emits a stderr advisory (`exit 0`, non-blocking)
  - Skips: paths under `docs/` or `.omc/`, and any `*.md` / `*.markdown` file
  - Auto-deploy: `install.sh`'s `HOOK_FILES` dynamically discovers `hooks/*.mjs` / `hooks/*.sh` (no MAP change required)
- `install.sh` subcommand `install-memory-mcp`: auto-patch `~/.claude/.mcp.json` to set `MEMORY_FILE_PATH=$HOME/.claude/memory/memory.jsonl`, fixing `@modelcontextprotocol/server-memory` v0.6.3's default-storage-in-npx-cache-dir issue (data not shared across processes / restarts). Idempotent, supports `--dry-run`, one-time `.bak` of `mcp.json`
- Doc sync: `README.md` / `docs/Analysis/INVENTORY.md` / `docs/Architecture/SYSTEM_DESIGN.md` / `docs/Usage/{INSTALL,UPGRADE}.md` updated from "9 hooks pending V0.3" to actual state

## [1.0.0] - 2026-06-18

### Added

- 同步纯文本规则：`global/CLAUDE.md` / `global/COMMIT_TEMPLATE.md`
- 2 个 user command：`commands/fix-permissions.md` / `commands/fullauto-prune.md`
- 1 个 user skill：`skills/fullauto/SKILL.md`
- 3 个 base JSON 配置：`global/json/{execution_config,mcp,.omc-version}.base.json`
- `install.sh` 子命令：`--dry-run` / `--force` / `--copy` / `--uninstall` / `doctor` / `--check` / `--rollback N` / `install-pre-push` / `install-statusline`
- `do_install_statusline`：**仅深度合并 statusLine 字段**，本机 settings.json 其他字段（含 sk- token）原样保留
- 4 个 MCP（`context7` / `filesystem` / `mcp-deepwiki` / `memory`）走 npx 自动拉，无需预装
- `global/json/statusline.base.json`：`npx -y ccstatusline-zh@2.2.20`（锁定版本避免漂移）
- `scripts/setup-plugins.sh`：跨机器一次装 3 marketplace + 7 plugin
- 7 plugin 清单：`oh-my-claudecode` / `frontend-design` / `rust-analyzer-lsp` / `php-lsp` / `typescript-lsp` / `context7` / `code-review`
- 3 marketplace 源：`claude-code-plugins` / `omc` / `superpowers-marketplace`
- secret 防御纵深：
  - `tools/scan-secrets.py`：7 类 token 模式（sk- / AKIA / ghp_ / xoxb- / telegram / sk-ant- / 长 hex）+ 敏感 key 上下文
  - `.gitignore` 黑/白名单：`global/json/*` 全屏蔽，例外 `*.base.json`；模式化屏蔽 `**/settings*.json` / `**/provider*.json` / `**/.omc-config*.json`
  - pre-push hook：自动部署在 `.git/hooks/pre-push`，`git push` 时强制扫
  - `tests/fixtures/`：正/负样本（假 token + 干净样本）
- CI：`/.github/workflows/ci.yml` Ubuntu 容器跑 dry-run / doctor / install / check / rollback / uninstall / scan-secrets
- 本地 smoke：`tests/ci/smoke.sh`（用 FAKE_HOME 隔离，不污染本机 `~/.claude`）
- 跨平台：Windows `MINGW*` / `MSYS*` / `CYGWIN*` 自动 fallback 到 `--copy` 模式

### Fixed

- `prune_backups` 在 BACKUP_ROOT 空目录时 `ls glob + pipefail + set -e` 触发的静默退出 bug（改用 `find + mapfile`）
- `HOOK_FILES` 静态硬编码 → 动态从 `hooks/` 目录读（空目录不误报 missing）
- pre-push hook `REPO_ROOT` 路径计算少一层 `..` 的 bug

### Security

- 9 类含 token 的 JSON 全部识别为"永不入库"（实测：扫描器在自抄 token 的 INVENTORY.md 上成功 fail）
- statusLine 合并逻辑从 `tgt.update(base)` 改为**仅深度合并 statusLine**（防止 base 文件被误填其他字段时连带覆盖）

### Known Limitations

- 9 个 hook 脚本暂未同步（`hooks/` 仅有占位）—— 本机 `~/.claude/hooks/` 已被清理，源文件待 V0.3 从历史快照恢复
  _(已部分解决：见 [1.0.4] `review-watchdog.mjs` 落地)_
- macOS 未实测
- 本机 shell profile 注入靠 `~/.bashrc` / `~/.zshrc`，fish / nushell 用户需自行处理

## [1.0.3] - 2026-06-18

### Documentation

- 文档化已知冲突：OMC `omc-setup` 会 patch `~/.claude/CLAUDE.md`，破坏本仓库的 symlink
- `README.md` 加 "已知冲突：OMC 与本仓库的 `CLAUDE.md`" section，含解决方案（先 install 后 setup-plugins / 装完立即 --check）
- `docs/Analysis/INVENTORY.md` 加"已知冲突"段，标记受影响的 plugin
- 引用 `docs/Analysis/SUPERPOWERS_VS_OMC.md`（v1.0.1 已加）

### Background

基于本机实测 superpowers 6.0.2（2.4 MB / 14 skill / 201 文件）vs OMC 4.14.6（373 MB / 41 skill / 19 agent / 17k 文件）的对比分析。OMC 是多 agent 执行框架，体积大、侵入性强；superpowers 是方法论库，体积小、不改 `CLAUDE.md`。

## [1.0.2] - 2026-06-18

### Security

- `install.sh` `do_install_statusline` 应用 v3 外部审核 4 项修复：
  - mkdir 失败 → exit 1（之前静默继续，可能破坏悬空 symlink）
  - 损坏 JSON → FATAL abort（之前降级为 `{}` 覆盖原文件）
  - npx 包名提取用 Python 替代 `echo | awk`（消除命令注入面）
  - 备份时间戳用 Python `datetime`（跨 BSD date 兼容）
- 原子写：`os.replace(tmp, target)` 防断电导致 settings.json 损坏
- 驳回 v3 外部审核的 P2.5 建议（屏蔽 `tests/fixtures/secret-samples.json`）：该文件是负样本必须保留

## [1.0.1] - 2026-06-18

### Added

- 社区标准文件：`LICENSE` (MIT) / `CHANGELOG.md` / `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md`
- GitHub templates：`.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md` + `PULL_REQUEST_TEMPLATE.md`
- `.github/workflows/release.yml`：tag `v*` 触发，自动从 CHANGELOG 提取对应版本段生成 release notes
- `docs/Architecture/SYSTEM_DESIGN.md`：模块图 / 红线 / 备份 / 限制
- README badges：License / Version / CI / Release
- `.gitignore` 加 `__pycache__/` 屏蔽 Python 编译产物

### Fixed

- pre-push hook `REPO_ROOT` 路径计算少一层 `..` 的 bug（`/..` → `/../..`）

[1.0.4]: https://github.com/htmambo/dotclaude-portable/releases/tag/v1.0.4
[1.0.3]: https://github.com/htmambo/dotclaude-portable/releases/tag/v1.0.3
[1.0.2]: https://github.com/htmambo/dotclaude-portable/releases/tag/v1.0.2
[1.0.1]: https://github.com/htmambo/dotclaude-portable/releases/tag/v1.0.1
[1.0.0]: https://github.com/htmambo/dotclaude-portable/releases/tag/v1.0.0
