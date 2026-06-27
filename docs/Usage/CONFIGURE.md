# configure.mjs 使用指南

> 交互式统一配置向导 —— 把所有 `install.sh` 子命令、外部 review 供应商、主供应商预设、statusline / HUD 整合到一个菜单里。

## 一句话定位

```bash
./tools/configure.mjs
```

菜单：
1. **外部 Review 供应商**（coding-bridge，xfyun / volcengine 后端 + API key）
2. **Claude Code 主供应商预设**（动态扫描 `~/.claude/*.json`）
3. **Statusline / HUD**（ccstatusline-zh / omc-hud）
4. **辅助子模块状态**（只读：memory MCP / pre-push / pre-sync-docs）
5. **查看当前 .env**

> **关于 kimi / codex**：这两个 MCP 各自有**自己的** CLI / 配置文件（kimi 走 `~/.claude/kimi.json`，codex 走 codex MCP 自身配置），**不**归 dotclaude-portable 管。本项目只管 coding-bridge 这一条 review 链（CLAUDE.md §"Hard-coded fallback" 默认主供应商）；kimi / codex 的 API key 请到各自工具的配置里填。

## Claude Code 主供应商预设（菜单 2）做什么用？

切换 Claude Code **本身**的 AI 模型后端。Claude Code 默认接 Anthropic 官方 API，但你也可以让它接**别的兼容服务**（自部署 / 中转 / 第三方代理）——只需把 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 改一下即可。

### 预设从哪来

向导**动态扫描**两个目录的 JSON，过滤系统文件（`settings.json` / `.mcp.json` / `providers.json` / `settings.local.json` / `default.json` 等）后列出：

- `~/.claude/*.json` — 用户自建预设（优先）
- `global/json/*.base.json` — 仓库自带预设（同名时用户级覆盖）

任何含 `env` 段的 JSON 放进 `~/.claude/` 即成为可选预设，命名随意（`myproxy.json` 等）。

### 厂商元数据 `title` / `description`（可选）

在预设 JSON 顶层加 `title` / `description` 描述厂商，向导会优先展示。它们是**惰性顶层 key**（同 `permissions` / `hooks`），合并时**只取 `env` + `model`**，从不并入 `settings.json`，不影响 Claude Code 运行。`title` 缺失回退显示文件名；`description` 缺失回退显示 `base_url`。

```json
{
  "title": "火山引擎（ARK）",
  "description": "字节跳动火山方舟，glm-5.2 直连",
  "env": { "ANTHROPIC_BASE_URL": "...", "ANTHROPIC_AUTH_TOKEN": "..." }
}
```

### 列表显示格式（三段）

```
自建中转·火山 — 当前在用 — 自建 ai.imzhp.top 代理，火山后端
讯飞星火 — 科大讯飞星火 coding api，astron-code
myproxy.json — test.example.com
```

格式：`[title|文件名] — [当前在用 — ]description|base_url`。中段「当前在用」仅 active 项显示。

### 「当前在用」如何识别

向导把每个预设的 `env` 与 `~/.claude/settings.json` 的 `env` 做 **(key, value) 子集匹配**——预设的每个 env 键值都等于 settings 当前值时判定为「当前在用」。比只比 `ANTHROPIC_BASE_URL` 更准：多个预设共用同一代理 URL（仅 token 不同）时仍能唯一识别。token 等 secret 仅内部比对，绝不回显明文。

### 操作与注意事项

选某个预设 = 把对应 JSON 文件的 `env` 段**深合并**到 `~/.claude/settings.json`（保留 `statusLine` / `enabledPlugins` / `permissions` 等其它字段；`model` 字段若有则一并覆盖）。**注意**：
- 这里**不**让你输新 token——预设的 token 是**你预先配过**的 secret
- token 过期 / 失效请**手动**编辑对应 JSON 文件
- 切完需要**重启 Claude Code** 让 env 生效
- `ANTHROPIC_AUTH_TOKEN` 等 secret 字段原样保留，不会因合并被清空

跟「外部 Review 供应商」的区别：

| 菜单 | 作用对象 | 决定什么 |
|---|---|---|
| 主供应商预设 | Claude Code **本身**的 AI 模型 | 你跟 Claude Code 聊天时它用哪家模型回答你 |
| 外部 Review 供应商 | coding-bridge MCP | Claude Code 改代码后外部**审核**走哪家 |

两者完全独立——你可以用 minimax 跑 Claude Code，同时用 coding-bridge 走讯飞做外部审核。

## Review 供应商 API key 输入规则

每个 review 供应商对应一个**专属 .env 变量**：

| 选择 | 写入变量 | 说明 |
|---|---|---|
| coding-bridge (xfyun-coding / volcengine-coding) | `CODING_BRIDGE_API_KEY` | xfyun 和 volcengine **共用**这个变量；切换后端不要求重输。mcp 内部按 provider 优先级匹配（API_KEY → SPARK_API_KEY / ARK_API_KEY） |

**输入流程**（按你定的规则）：

1. 进入子菜单时**先检查** .env 对应 key
2. **已存在** → 提醒 `检测到 .env 已存在 XXX: abcd…wxyz`，询问 `是否修改 XXX？[y/N]`
   - 选 `n` / 回车 → 保持现状
   - 选 `y` → 提示输入新值（隐藏键入；空回车 = 保持原值不修改）
3. **不存在 / 空** → 直接提示输入 API key（隐藏键入；空回车 = 跳过该变量）

## 设计目标

| 目标 | 做法 |
|---|---|
| 零外部依赖 | 纯 `node:readline` + ANSI 转义码（无 `prompts` / `inquirer`） |
| 不破坏 `install.mjs` | configure.mjs 平行存在；install.sh 不调用它，行为正交 |
| 幂等 | 重复执行不会重复追加 / 不会覆盖已有 secret（API key 留空 = 保持现状） |
| 可审计 | `--dry-run` 打印所有写动作但不落盘；`~/.claude.json` / `settings.json` 修改前自动 `.bak.<ts>` |
| 可 CI | `--no-color` 禁 ANSI；pipe 模式下 readline 复用单例 FIFO 队列 |

## 持久化约定

| 文件 | 写什么 | 谁读 |
|---|---|---|
| `<repo>/.env` | `REVIEW_PROVIDER` / `CODING_BRIDGE_PROVIDER` / `CODING_BRIDGE_API_KEY` / `KIMI_API_KEY` / `CODEX_API_KEY` | shell `export $(cat .env | xargs)` 或自写 `direnv` / 启动脚本 |
| `~/.claude.json` | `mcpServers.coding-bridge` + `mcpServers.kimi` | Claude Code 启动时加载 MCP |
| `~/.claude/settings.json` | `statusLine` / `permissions.allow` | Claude Code 启动时加载 |
| **不动** | `~/.zshrc` / `~/.bashrc` | —（避免污染 shell rc；用户自己决定加载 `.env` 方式） |

## .env 是怎么读的？

脚本本身**不自动 source**（避免污染子进程 env）。三种加载方式选一种：

```bash
# A) 临时一次（推荐调试）
export $(grep -v '^#' .env | xargs)

# B) direnv（项目级，按目录加载）
echo 'export $(grep -v "^#" .env | xargs)' > .envrc
direnv allow .

# C) 在 shell rc 里 source（全局，但混进了 rc）
echo '[[ -f ~/htdocs/dotclaude-portable/.env ]] && export $(grep -v "^#" ~/htdocs/dotclaude-portable/.env | xargs)' >> ~/.zshrc
```

> ⚠️ **安全提示**：`.env` 含 API key；`.gitignore` 已自动屏蔽。**绝不要** `git add .env`；提交前 `git status` 确认 working tree 没有 `.env` 行。

## 子模块与 `install.sh` 的关系

configure.mjs 是个**轻量配置层**。实际安装 / 验证仍走 install.sh：

| configure 看到的状态 | 真要做的事 |
|---|---|
| coding-bridge MCP 未配置 | `./install.sh install-coding-bridge-json && ./install.sh install-coding-bridge-mcp` |
| kimi 未配置 | `./install.sh install-coding-bridge-json`（kimi 顺带装上） |
| 旧版 npx 命令残留 | `rm ~/.claude/.mcp.json && ./install.sh --force` |
| pre-push hook 未装 | `./install.sh install-pre-push` |
| memory MCP 路径异常 | `./install.sh install-memory-mcp` |
| ccstatusline 未装 | `./install.sh install-ccstatusline` |

## 排错速查

| 现象 | 原因 | 修复 |
|---|---|---|
| 菜单卡住不响应 | stdin 是 pipe 且 readline 没收到换行 | 确保每行有 `\n`；CI 用 `printf '1\n1\nq\n' \| node tools/configure.mjs` |
| 颜色乱码 | `NO_COLOR` 没设但 stdout 不支持 ANSI | 加 `--no-color` |
| `.env` 写入后 `cat` 显示带注释 banner | 脚本会加 `# ─── dotclaude-portable configure (...) ───` 头，正常 | — |
| 想完全清空 `.env` 重来 | `rm .env && ./tools/configure.mjs` 即可重新生成 | — |
| 看到 `MCP error: command not found: uvx` | uvx 没装 | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| API key 输入时空回车仍写入空值 | 不会，**空回车 = 保持现状** | — |

## 安全约束

- `.env` 文件 mode 默认 0644；若担心 `ls -la` 被看到：`chmod 600 .env`
- configure.mjs 写入时**不会**输出 API key 到 stdout（`maskValue` 把 `*_KEY` / `*_TOKEN` 截断为 `abcd…wxyz`）
- 备份文件 `<file>.bak.<ts>` 模式同样含原 secret，建议定期 `rm` 旧备份
- 不联动 `git`：脚本不调用 `git add` / `git commit`，也不会试图 push `.env`

## CLI 标志

```
./tools/configure.mjs                 # 交互式（默认）
./tools/configure.mjs --dry-run       # 只打印动作不落盘
./tools/configure.mjs --no-color      # 禁 ANSI（CI / pipe）
```
