# Architecture

> dotclaude-portable 的系统设计文档。Code Review 优先看本文与 [INVENTORY.md](../Analysis/INVENTORY.md)。

## 一句话定位

把 `~/.claude/` 中"机器无关、可审计、不含 secret"的那部分抽到 git 仓库，跨机器**一行命令**恢复。

## 设计目标

| 目标 | 达成方式 |
|---|---|
| 跨机器便携 | install.sh symlink 模式 + npx 自动拉 MCP |
| 零 secret 泄露 | `.gitignore` 黑/白名单 + `scan-secrets.py` + pre-push hook |
| 幂等 | `.dotclaude-portable.version` 标记 + `--check` 巡检 + `--rollback N` 快照 |
| 不污染本机个性化 | statusLine 仅深度合并 statusLine；含 token 的 settings.json 不入库 |
| 可审计 | 仓库纯文本 + 25 个文件，体积 < 250 KB |
| 自动化 | GitHub Actions CI + 本地 `tests/ci/smoke.sh` |

## 关键边界（红线）

**绝不含 token 入库**：

```
settings.json            ← 含 sk-...  → ❌ 永不入库（仅 statusLine 字段独立脱敏）
settings.self            ← 含 sk-...  → ❌ 永不入库
settings.local.json      ← 机器局部   → ❌ 永不入库
default.json             ← 含 sk-...  → ❌ 永不入库
providers.json           ← 含 sk-ant-... → ❌ 永不入库
.omc-config.json         ← 含 telegram bot token + nvm 路径 → ❌ 永不入库
minimax.json / selfminimax.json / baidu.json / anyrouter.json
                         ← secret    → ❌ 永不入库
mcp-needs-auth-cache.json ← 鉴权缓存  → ❌ 永不入库
```

**纵深防御**：

1. `.gitignore` 黑/白名单（`global/json/*` 全屏蔽，例外 `*.base.json`）
2. `tools/scan-secrets.py` 主动扫（7 类 token 模式 + 敏感 key 上下文）
3. `install.sh doctor` 调扫描器
4. `pre-push` hook：`git push` 前强制扫
5. `tests/fixtures/` 正/负样本验证扫描器不被误报

## 模块图

```
dotclaude-portable/
├── install.sh               # 主入口，dispatch 到 do_*
│   ├── do_install           # MAP 遍历 + 备份 + 部署
│   ├── do_install_statusline # 仅深度合并 statusLine 到本机 settings.json
│   ├── do_install_pre_push  # 在 .git/hooks/pre-push 装拦截器
│   ├── do_uninstall         # 恢复最新 backup
│   ├── do_check             # symlink 健康巡检
│   ├── do_rollback N        # 回滚到第 N 个 snapshot
│   └── do_doctor            # 调 scan-secrets.py
├── uninstall.sh             # 转发到 install.sh --uninstall
├── tools/scan-secrets.py    # Python 写的 secret 扫描器
├── scripts/setup-plugins.sh # 跨机器装 3 marketplace + 7 plugin
├── tests/ci/smoke.sh        # 本地 8 步端到端
├── .github/workflows/ci.yml # GitHub Actions CI
├── global/                  # 同步到 ~/.claude/
│   ├── CLAUDE.md            # 全局指令
│   ├── COMMIT_TEMPLATE.md
│   └── json/
│       ├── execution_config.base.json  # 纯结构
│       ├── mcp.base.json               # 4 个 MCP，路径用 ${HOME}
│       ├── .omc-version.base.json      # 纯版本号
│       └── statusline.base.json        # npx -y ccstatusline-zh（latest）
├── commands/                # user slash commands
├── skills/                  # user skills
├── hooks/                   # review-watchdog.mjs（PostToolUse hook, 已落地）
└── docs/
    ├── Analysis/INVENTORY.md    # 同步/不同步决策表
    ├── Usage/{INSTALL,UPGRADE}.md
    └── Architecture/SYSTEM_DESIGN.md  # 本文件
```

## install.sh MAP（清理后真实状态）

| 源 | 落点 | 类型 |
|---|---|---|
| `global/CLAUDE.md` | `CLAUDE.md` | symlink |
| `global/COMMIT_TEMPLATE.md` | `COMMIT_TEMPLATE.md` | symlink |
| `global/json/execution_config.base.json` | `execution_config.json` | 渲染 cp（仅本机无时） |
| `global/json/mcp.base.json` | `.mcp.json` | 渲染 cp（`${HOME}` 占位） |
| `global/json/.omc-version.base.json` | `.omc-version.json` | 渲染 cp |
| `commands/fix-permissions.md` | `commands/fix-permissions.md` | symlink |
| `commands/fullauto-prune.md` | `commands/fullauto-prune.md` | symlink |
| `skills/fullauto/SKILL.md` | `skills/fullauto/SKILL.md` | symlink |
| `global/json/statusline.base.json` | 合并到 `settings.json.statusLine` | `install-statusline`（深度合并，仅动 statusLine） |

## 跨机器补全（不入仓）

| 范围 | 工具 | 触发 |
|---|---|---|
| 4 个 MCP | npx 自动拉 | 首次 Claude Code 启动时 |
| `ccstatusline-zh` | `./install.sh install-statusline` | install.sh 不自动调（避免污染已有 statusLine），用户显式跑 |
| 7 个 plugin + 3 marketplace | `./scripts/setup-plugins.sh` | 用户显式跑 |

## 备份与回滚

```
~/.claude.backups/
├── 20260618_120000/    ← 最新 snapshot（install 触发）
├── 20260617_223000/    ← 上一个
└── 20260615_180000/    ← 最旧（自动 prune）
```

- 首次安装：原文件 `mv` 进 snapshot
- 后续安装：跳过整盘备份，仅对冲突文件做 `.bak.<时间戳>` 单文件备份
- 保留：最近 3 个 snapshot

## CI / 测试

GitHub Actions 在 push / PR 时跑：

```
1. install.sh --dry-run
2. install.sh doctor
3. install.sh --force  (FAKE_HOME)
4. install.sh --check
5. install.sh --rollback 1
6. install.sh --uninstall
7. python3 tools/scan-secrets.py .
```

本地等价：`./tests/ci/smoke.sh`（用 `tests/ci/_work/fake-home` 隔离）。

## 已知限制

- 其他 hook 暂未同步（待从历史快照或 OMC 备份恢复，或按需补齐）；当前 `review-watchdog.mjs` 已落地
- macOS 未实测
- fish / nushell 用户需自行处理 shell profile 注入
