# dotclaude-portable

便携式同步 `~/.claude/` 中"机器无关"的配置：纯文本规则、commit 模板、commands、skills，以及 3 个**不含 secret** 的 JSON 配置（含 `.mcp.json`）。换机器后 **clone + 一行命令** 即可恢复。

## 5 分钟上手

```bash
# 1. 拉仓库
git clone <your-remote>/dotclaude-portable.git
cd dotclaude-portable

# 2. 先 dry-run
./install.sh --dry-run

# 3. 真安装
./install.sh
./install.sh --force      # 强制覆盖
./install.sh --copy       # 拷贝模式（Windows 兜底）

# 4. 验证
./install.sh --check
./install.sh doctor       # secret 扫描

# 5. 跨机器补全
./install.sh install-statusline   # 把 ccstatusline-zh 注入本机 settings.json
./scripts/setup-plugins.sh        # 装 3 marketplace + 7 plugin
```

卸载 / 回滚：

```bash
./install.sh --uninstall  # 或 ./uninstall.sh
./install.sh --rollback 1 # 1=最新，2=上一个，3=再上一个
```

## 同步范围（清理后）

| 仓库路径 | 落点（相对 `~/.claude/`） | 类型 |
|---|---|---|
| `global/CLAUDE.md` | `CLAUDE.md` | symlink |
| `global/COMMIT_TEMPLATE.md` | `COMMIT_TEMPLATE.md` | symlink |
| `global/json/execution_config.base.json` | `execution_config.json` | 渲染 cp（仅本机无时） |
| `global/json/mcp.base.json` | `.mcp.json` | 渲染 cp（`${HOME}` 占位） |
| `global/json/.omc-version.base.json` | `.omc-version.json` | 渲染 cp |
| `commands/fix-permissions.md` | `commands/fix-permissions.md` | symlink |
| `commands/fullauto-prune.md` | `commands/fullauto-prune.md` | symlink |
| `skills/fullauto/SKILL.md` | `skills/fullauto/SKILL.md` | symlink |
| `global/json/settings.statusline.base.json` | 合并到 `settings.json` 的 `statusLine` 字段 | `install-statusline` 子命令 |

### 4 个 MCP（`global/json/mcp.base.json`）

- `context7` / `filesystem` / `mcp-deepwiki` / `memory`
- 全部用 `npx -y <pkg>` 启动，**首次使用 npx 自动下载**，无需预装
- 跨机器只需 `node` + `npx`；`install.sh` 渲染 `.mcp.json` 后生效

### `ccstatusline-zh`（非 plugin，是 statusLine 命令）

- `settings.json` 含 sk- token 永不入库 → statusLine 单独脱敏
- 用 `./install.sh install-statusline` 把 base 合并到本机 `settings.json`
- 不污染 env / permissions 等含 token 的其他字段

### 7 个 plugin（`enabledPlugins`）

- 不进 dotclaude-portable 仓库（每个 plugin 都有独立 git source，体积大）
- 跨机器装：`./scripts/setup-plugins.sh`
- 维护 3 个 marketplace + 7 个 plugin（oh-my-claudecode / frontend-design / 3 个 LSP / context7 / code-review）

## 永不入库（实测含 secret 或本机局部）

- `settings.json` / `settings.self` / `default.json` / `providers.json` — 全部含 `sk-...` 真实 API token
- `settings.local.json` — 本机临时权限列表
- `.omc-config.json` — 含 telegram bot token + 本机 nvm 路径
- `kimi.json` / `minimax.json` / `selfminimax.json` / `baidu.json` / `anyrouter.json` / `mcp-needs-auth-cache.json`
- 所有缓存/历史/运行态/插件目录

完整决策表见 `docs/Analysis/INVENTORY.md`。

## 安全防御

1. `.gitignore` 黑名单 + 白名单：`global/json/*` 全屏蔽，例外 `*.base.json`；模式化屏蔽 `**/settings*.json` / `**/provider*.json` / `**/.omc-config*.json` 等
2. `tools/scan-secrets.py`：7 类 token 模式（sk- / AKIA / ghp_ / xoxb- / telegram / sk-ant- / 长 hex）+ 敏感 key 上下文
3. `install.sh doctor`：调扫描器，命中即 fail
4. `install.sh install-pre-push`：在 `.git/hooks/pre-push` 装拦截器（`git push` 时强制扫）
5. `tests/fixtures/`：正/负样本（假 token + 干净样本）

## 关键设计

- **默认 symlink**：仓库 `git pull` 即生效；不放心可用 `--copy`
- **首次安装自动备份**：原文件移到 `~/.claude.backups/<时间戳>/`，最多保留 3 快照
- **幂等**：检测到 `.dotclaude-portable.version` 标记后跳过整盘备份
- **shell 注入幂等**：往 `~/.bashrc` / `~/.zshrc` 追加 `# dotclaude-portable` 标记 + `export CLAUDE_HOME="$HOME/.claude"`，卸载时整段剥离
- **JSON 渲染**：仅替换 `${HOME}` / `${USER}` 两个占位符；本机已有同名 JSON 不覆盖
- **statusLine 合并**：用 Python 把 base 的 `statusLine` 字段 merge 进本机 `settings.json`（base 优先覆盖），其他字段保留
- **plugin 跨机器装**：单独脚本 `scripts/setup-plugins.sh`，不污染 install.sh

## CI / 测试

- `.github/workflows/ci.yml`：Ubuntu 跑 dry-run / doctor / install / check / rollback / uninstall / scan-secrets
- `./tests/ci/smoke.sh`：本地复现 CI（用 FAKE_HOME 隔离，不污染本机 `~/.claude`）

## Windows

- 用 **Git Bash** 跑 `./install.sh`
- `MINGW*` / `MSYS*` / `CYGWIN*` 自动 fallback 到 `--copy` 模式
