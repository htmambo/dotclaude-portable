# Changelog

All notable changes to **dotclaude-portable** are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows
[SemVer](https://semver.org/).

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
- macOS 未实测
- 本机 shell profile 注入靠 `~/.bashrc` / `~/.zshrc`，fish / nushell 用户需自行处理

[1.0.0]: https://github.com/htmambo/dotclaude-portable/releases/tag/v1.0.0
