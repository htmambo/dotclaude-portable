---
status: 🔄 进行中
created: 2026-06-18
owner: hoping
scope: dotclaude-portable V0.1
---

# dotclaude-portable V0.1 任务计划

## 目标

V0.1 只做一件事：**把 `~/.claude/` 中"纯文本、机器无关"的部分抽进仓库，并写出一份能"在新机器上 clone → 跑一行命令恢复"的安装脚本**。JSON 合并、hook 路径标准化、CI、Windows 兼容全部留到 V0.2 / V1.0。

## 仓库

- 路径：`/home/hoping/htdocs/dotclaude-portable/`
- 已 `git init`；分支默认 `main`
- 命名：`dotclaude-portable`（dot 前缀对应 `~/.claude/`，portable 表达跨机便携）

## 本阶段同步清单（V0.1）

| 源 | 落点 | 备注 |
|---|---|---|
| `~/.claude/CLAUDE.md` | `global/CLAUDE.md` | 全局指令 |
| `~/.claude/CLAUDE.omc.md` | `global/CLAUDE.omc.md` | OMC 子集 |
| `~/.claude/cc.md` | `global/cc.md` | 速查 |
| `~/.claude/COMMIT_TEMPLATE.md` | `global/COMMIT_TEMPLATE.md` | Git 提交模板 |
| `~/.claude/commands/fix-permissions.md` | `commands/fix-permissions.md` | |
| `~/.claude/commands/fullauto-prune.md` | `commands/fullauto-prune.md` | |
| `~/.claude/commands/tlive.md` | `commands/tlive.md` | |
| `~/.claude/skills/fullauto/SKILL.md` | `skills/fullauto/SKILL.md` | |
| `~/.claude/skills/omc-reference/SKILL.md` | `skills/omc-reference/SKILL.md` | |
| **暂不同步** `~/.claude/hooks/*` | — | V0.2 单独处理路径标准化与 secret 审计 |
| **暂不同步** JSON 配置 | — | V0.2 走 `*.base.json` + jq 合并 |

## 子任务

- [x] 1. `git init` + 目录骨架（`global/` `commands/` `skills/` `templates/` `docs/Usage/` `docs/Analysis/`）
- [x] 2. 建本计划文档
- [ ] 3. 拷贝纯文本文件到 `global/` `commands/` `skills/`
- [ ] 4. 写 `install.sh`：幂等、备份、symlink 原地三分支、shell profile 注入 `$CLAUDE_HOME`
- [ ] 5. 写 `uninstall.sh`：从最近备份恢复 + 清理 `~/.bashrc` 注入
- [ ] 6. 写 `doctor`（gitleaks + 关键词正则兜底）
- [ ] 7. 写 `--check`（symlink 巡检）
- [ ] 8. 写 `README.md`（5 分钟上手 + 卸载说明）
- [ ] 9. 写 `INVENTORY.md`（同步/不同步决策表）
- [ ] 10. 写 `.gitignore`（屏蔽临时与脱敏占位）
- [ ] 11. 在本机 dry-run 验证 `install.sh --dry-run` 输出符合预期
- [ ] 12. 首次提交（按 `~/.claude/COMMIT_TEMPLATE.md` 模板）

## 验收标准（V0.1）

- [ ] 仓库 `global/` `commands/` `skills/` 内容与 `~/.claude/` 对应源文件字节级一致（cp 校验）
- [ ] `./install.sh --dry-run` 在新 clone 状态下输出全部将创建的 symlink 路径
- [ ] `./install.sh doctor` 在干净仓库下报告 0 风险
- [ ] `./install.sh --check` 在已安装状态下报告全部 symlink 健康
- [ ] `./install.sh --uninstall` 还原为首次安装前状态（验证方式：先 `--check` 通过 → 卸载 → 确认 `~/.claude/CLAUDE.md` 还原为备份内容）
- [ ] README 含 5 分钟上手教程

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 拷贝时 `cp` 误把目录当文件 | 严格按文件路径逐个 cp，cp 后 `wc -c` 与源比对 |
| shell profile 注入重复追加 | 注入前 grep 标记 `# dotclaude-portable` 避免重复 |
| symlink 原地替换破坏原文件 | install.sh 三分支：普通文件 → mv 备份再 ln；已是仓库 symlink → 跳过；其他 → 报警 |
| `set -euo pipefail` 在 macOS bash 3.2 报错 | 检测 `BASH_VERSION`，< 4.0 给出提示 |
| 历史 `.claude/` 里有本机独有 patch | install.sh 第一次安装前必须**强制**做完整备份 |

## 依赖

- `bash` ≥ 4.0
- `git`
- `gitleaks`（可选，doctor 找不到时降级到关键词正则）

## 不在本阶段

- JSON 合并（V0.2）
- hook 路径标准化（V0.2）
- pre-commit / gitleaks 强制拦截（V0.2）
- CI / GitHub Actions（V1.0）
- Windows `--copy` 模式（V1.0）
- `UPGRADE.md` 迁移说明（V0.2 视情况）
