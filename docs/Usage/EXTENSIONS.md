# EXTENSIONS — Skill / Hook / Command / MCP 使用说明

本仓库在 base 同步范围(CLAUDE.md / base JSON / commands / skills / hooks)之外,提供 4 类**可执行扩展**。本文档逐一说明:

- **2 个 user command** —— `/fix-permissions` / `/fullauto-prune`
- **1 个 user skill** —— `fullauto`(`/fullauto` 入口)
- **1 个 hook** —— `review-watchdog.mjs`(PostToolUse 提示)
- **5 个 MCP server** —— `context7` / `filesystem` / `mcp-deepwiki` / `memory` / `coding-bridge`

适用读者:已经按 [`INSTALL.md`](./INSTALL.md) 跑过 `./install.sh`,想深入了解每项扩展的**触发方式、行为边界、典型使用场景**。

---

## 1. Commands(2 个)

User command 是 **slash command**,在 Claude Code 会话内输入 `/命令名 参数` 触发。本仓库提供 2 个。

### 1.1 `/fix-permissions` —— 一键配置项目级 `defaultMode` + 10 条 deny + 12 条 allow

**触发**:`/fix-permissions [acceptEdits|bypassPermissions|default|plan]`,参数缺省 = `bypassPermissions`

**作用对象**:**当前工作目录**下项目的 `.claude/settings.local.json`(不是 `~/.claude/settings.json`)

**行为(自动执行,不询问)**:
1. 读取 `<cwd>/.claude/settings.local.json`(不存在则初始化为 `{}`)
2. 解析 `defaultMode` / `permissions.allow` / `permissions.deny` 三个字段
3. **规范化**:旧版本无转义的 `Bash(:(){ :|:& };:)` 升级为 `Bash(:\(\){ :|:& };:)`(fork bomb 必须转义,否则 Claude 启动失败)
4. **追加** 10 条 deny(高危命令兜底)+ 12 条 allow(`.omc/**` 文件读写 + bash)
5. 设置 `defaultMode` 为参数值或 `bypassPermissions`
6. 备份到 `.claude/settings.local.json.bak`(仅首次)
7. 输出 1 段摘要(`defaultMode 旧→新` / `deny 已 N / 新 M / 共 K` / `allow 已 P / 新 Q / 共 R`)

**10 条 deny 规则**:
```
Bash(rm -rf *)              Bash(rm -fr *)
Bash(:\(\){ :|:& };:)       Bash(curl * | bash*)
Bash(curl * | sh*)          Bash(wget * | sh*)
Bash(wget * | bash*)        Bash(chmod -R 777 /)
Bash(dd if=* of=/dev/*)     Bash(mkfs.*)
```

**12 条 allow 规则**(.omc 工作区相关,只为 `fullauto` skill 服务):
```
Read(.omc/**)    Read(.omc/**/**)    Edit(.omc/**)    Edit(.omc/**/**)
Write(.omc/**)   Write(.omc/**/**)   Bash(rm .omc/**)   Bash(rm -rf .omc/**)
Bash(mkdir -p .omc/**)  Bash(ls .omc/**)  Bash(touch .omc/**)  Bash(mv .omc/**)
```

**幂等性**:
- deny/allow 用 `dict.fromkeys` 保序去重,重复执行不产生重复条目
- 备份只一次(`.bak` 已存在则跳过)
- defaultMode 相同则跳过;不同则覆盖

**铁律**:
- ❌ 不输出 diff 预览(直接执行,执行后只输出 1 段摘要)
- ❌ 不等用户确认(纯增量,无破坏性)
- ❌ 不删用户已有的 `permissions.allow` 规则(只追加)
- ❌ 不写高危命令到 allow(只加 `.omc/**` 相关)
- ❌ 不动 `permissions` 之外的字段
- ❌ 不调 Codex(本命令不涉及外部 review)

**重启要求**:`defaultMode` 字段在 Claude Code 启动时读,改完**必须重启** Claude Code 生效。

**回滚**:`git checkout -- .claude/settings.local.json`(用 `.bak` 恢复:`cp .claude/settings.local.json.bak .claude/settings.local.json`)

**适用场景**:
- 项目接入 `fullauto` skill 前先跑(让 `defaultMode=bypassPermissions` 生效,真正零询问)
- 把旧项目从 `acceptEdits` 升级到 `bypassPermissions`
- 一键审计 `.claude/settings.local.json` 是否缺关键 deny/allow 规则

### 1.2 `/fullauto-prune [N=5] [T=30d]` —— 清理已完成的 `/fullauto` slug 目录

**触发**:`/fullauto-prune 5 30d`,两个参数都可缺省

**作用对象**:`.omc/fullauto/<slug>/` 目录(由 `fullauto` skill 在 `status: complete` 后遗留的产物)

**双阈值**:`N`(保留最近 N 个 `complete` slug)与 `T`(mtime 早于 T 天的全部入清理队列),**取更严者**

**行为(自动执行,不询问)**:
1. 读 `.omc/fullauto/INDEX.md` 解析 slug 行
2. 磁盘对账:
   - 索引有 / 目录无 → `drift`(跳过清理,输出提示,需人工核查)
   - 索引无 / 目录有 → `orphan`(加入清理候选)
3. 按 `spec.md` mtime 降序排序(不用目录 mtime,会被 INDEX.md 引用改写)
4. 阈值过滤 → 写审计行 → 删 INDEX.md 行 → 删磁盘目录
5. 输出 1 段总结(`清理 X / 保留 Y / drift D / orphan O`)

**审计行格式**(`docs/Task/Archive/YYYY-MM/PRUNE_LOG.md`):
```
| 时间 | slug | spec.md (sha256:8) | validation.md (sha256:8) | reason |
| --- | --- | --- | --- | --- |
| 2026-06-20 18:30 | my-impl-1 | a1b2c3d4 | e5f6a7b8 | age>30d |
```

**保留边界**:
- `status: active` / `status: failed` 行对应的目录**不删**
- `docs/Task/Archive/YYYY-MM/<TASK>_PLAN.md` 任何文件**不动**
- `.omc/plans/fullauto-<slug>-impl.md`(如存在)**不动**

**与零询问原则的边界**:
- 本命令是**显式触发**——只有用户输入 `/fullauto-prune` 才执行(不自动跑)
- 执行中和执行后**不询问**"是否继续",按协议直接输出总结

**适用场景**:
- `.omc/fullauto/` 目录膨胀(超过 N 个 slug 或过 T 天)
- 想看 prune 历史(读 `PRUNE_LOG.md`)
- 索引与磁盘不一致时(查 drift 列表,人工修正)

---

## 2. Skills(1 个)

User skill 是 **slash command + 多轮协议**,比 command 更复杂。本仓库提供 1 个。

### 2.1 `fullauto` —— 任务规划 / 实现 / 验证 / 归档的 4 阶段流水线

**触发**:`/fullauto <任务描述>`,**配套使用** `/fix-permissions` 设 `defaultMode=bypassPermissions`

**权威源**:`skills/fullauto/SKILL.md`(815 行,本节只给入口,详见该文件)

**4 阶段协议**(详见 SKILL.md):
| Phase | 名称 | 产物 |
|---|---|---|
| 0 | Spec 落地 | `.omc/fullauto/<slug>/spec.md` |
| 1 | Plan 落地 | `.omc/plans/fullauto-<slug>-impl.md` |
| 2 | 实现(自动并行 / 顺序子代理) | 代码变更 |
| 3 | 验证 + 归档 | `.omc/fullauto/<slug>/validation.md` + `docs/Task/Archive/YYYY-MM/` |

**协作约定要点**(完整见 SKILL.md `## Collaboration Agreement`):
- **零询问**:Phase 0-3 内不向用户提问(只在 Phase 入口一次性收集约束)
- **阶段同步点**:每个 Phase 出口必须落盘,后续 Phase 不可跨过缺失文件
- **外部 Review**:`mcp__coding-bridge__review_code` 在 Phase 1 / 4 强制调用
- **归档**:Phase 4 完成后 `docs/Task/Archive/YYYY-MM/<TASK>_PLAN.md`,同步更新 `docs/Task/README.md`

**双索引**:
- `.omc/fullauto/INDEX.md` —— 全机 all-slug 索引(fullauto 协议读)
- `docs/Task/README.md` —— 用户视角的归档索引

**典型场景**:
- "帮我把 X 重构 + 写测试 + 跑 CI" → `/fullauto 重构 X`
- "做一个新功能" → `/fullauto 实现 <feature>`
- "修 bug + 归档" → `/fullauto 修复 <bug>`

**与 `/fix-permissions` 的关系**:
- `/fix-permissions` 是 `fullauto` 的**前置条件**(设 defaultMode + .omc allow 规则)
- 没跑 `/fix-permissions` 跑 `/fullauto` 仍可工作,但 Phase 2 写文件时会因权限不足被拒

---

## 3. Hooks(1 个)

Hook 是 Claude Code 在特定事件触发的**外部脚本**,exit 0 不阻塞,exit 2 才阻塞。配置在 `~/.claude/settings.json`。

### 3.1 `review-watchdog.mjs` —— 代码改动无 `runReview` 时 stderr 提示

**事件**:`PostToolUse`(Write|Edit 工具调用后)

**源文件**:`hooks/review-watchdog.mjs`(96 行 Node.js,本仓库自带)

**部署方式**:`./install.sh` 通过 `HOOK_FILES` 动态扫描 `hooks/*.mjs` / `hooks/*.sh`,无需在 `install.sh` 中注册。新增 hook 丢进 `hooks/` 目录,重跑 `./install.sh` 即可。

**触发规则**(3 个条件同时满足才触发):
1. 工具名 = `Write` 或 `Edit`
2. 文件路径符合**代码文件**白名单(任一):
   - 扩展名 ∈ `.py .ts .js .tsx .jsx .go .rs .java .kt .swift .c .cpp .h .sh .sql`
   - 文件名 ∈ `pyproject.toml / package.json / Cargo.toml / go.mod / tsconfig.json / requirements.txt / Pipfile`
3. **当前会话 transcript 末尾 ~200KB 内未检测到** `runReview` / `review_code` / `review_plan` / `mcp__coding-bridge__` 任一字符串

**排除路径**:
- `docs/` 与 `.omc/` 子树
- 所有 `*.md` / `*.markdown`

**提示文本**(stderr,非 stdout):
```
[review-watchdog] 触及代码文件 <path>，本轮响应未检测到 runReview 调用。
如已调请忽略；如未调请补 runReview({kind:"code"})。
```

**退出码**:`0`(非阻塞,提示性,不阻止 Write/Edit 完成)

**约束**:
- 读 stdin(Claude 传 tool_name + tool_input.file_path)
- 读 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`(transcript)
- `CLAUDE_CODE_SESSION_ID` 环境变量是定位 transcript 的关键

**适用场景**:
- 改代码忘了调外部 review → 提示补 `runReview`
- 纯文档改动(`*.md` 在 `docs/`)→ 不会触发(已排除)
- 单行 typo 修复 → 触发但可忽略(`exit 0` 不阻塞)

**限制**:
- 仅在 **本机** 触发(不远程 / 跨会话)
- transcript 缺失或损坏时静默 pass-through
- 不替代人的判断,只是提示

**如何禁用**:
- 临时:删 `~/.claude/hooks/review-watchdog.mjs`(symlink 模式: `rm ~/.claude/hooks/review-watchdog.mjs`)
- 永久:把文件移出 `hooks/` 目录,重跑 `./install.sh --force`

---

## 4. MCP Servers(5 个)

MCP server 是**通过 `.mcp.json` 启动的外部进程**,Claude Code 通过 `mcp__<server>__*` 工具名调用。本仓库提供 5 个,全部用 `npx -y` 启动,无需预装。

源文件:`global/json/mcp.base.json`(base,不含 secret)→ `install.sh` 渲染占位 → 落到 `~/.claude/.mcp.json`

### 4.1 `context7` —— 实时拉取库文档(替代训练数据滞后)

**包**:`@upstash/context7-mcp`

**工具名**:
- `mcp__context7__resolve-library-id` —— 库名解析为 context7 ID
- `mcp__context7__query-docs` —— 按主题拉文档片段

**典型用法**:库升级 / API 迁移 / 不熟悉的库 → 调 `query-docs` 拿最新 API 描述,避免凭训练数据瞎写

**示例调用**:
```
mcp__context7__resolve-library-id({libraryName: "fastapi"})
→ 返回 "/fastapi/fastapi" 之类的 ID

mcp__context7__query-docs({context7CompatibleLibraryID: "/fastapi/fastapi", topic: "dependency injection"})
→ 返回 FastAPI Depends 的最新文档片段
```

**何时用**:
- "Next.js 15 怎么用 server actions?"(训练数据未必覆盖)
- "React 19 useActionState API 长啥样?"
- 不熟悉的库想快速看 API

**何时不用**:
- 库 API 稳定且训练数据已覆盖(查历史 doc 即可)
- 需要调试真实运行时行为(用 filesystem / 跑代码)

### 4.2 `filesystem` —— 受限的本地文件读写

**包**:`@modelcontextprotocol/server-filesystem`

**工具名**:
- `mcp__filesystem__read_file` / `write_file` / `edit_file`
- `mcp__filesystem__list_directory` / `create_directory` / `move_file`
- `mcp__filesystem__search_files` / `get_file_info`

**配置参数**:`args: ["${HOME}"]` —— 沙箱根目录是 `$HOME`,Claude 只能在 `$HOME` 子树内操作

**典型用法**:
- 跨多个项目读文件(Claude 自带的 Read 受工作目录限制)
- 批量处理 `$HOME` 下的文件
- 检索 `$HOME/Downloads` 之类非工作目录

**沙箱**:`$HOME` 是根,但默认 **不会跨过** `~/.claude/` 之外(受 MCP server 自身策略约束)

**何时用**:
- 工作目录 = `/tmp/proj`,但要读 `~/notes/foo.md`
- 批量改 `$HOME/.config/*` 文件

**何时不用**:
- 工作目录内的文件 → Claude 自带 Read/Write/Edit 更直接
- 需要 sudo / 写 `/etc/*` → 受沙箱限制

### 4.3 `mcp-deepwiki` —— 第三方 GitHub 仓库文档检索

**包**:`mcp-deepwiki@latest`

**工具名**:`mcp__mcp-deepwiki__deepwiki_fetch`(用 `mcp__mcp-deepwiki__deepwiki_query` 做全文搜索)

**数据源**:deepwiki.com 对 GitHub 仓库的预索引(类似 ReadTheDocs 但覆盖 GitHub 仓库)

**典型用法**:
- 看第三方仓库的架构图(生成的 wiki 页面)
- 查某个内部模块的入口(不用 clone 整仓库)
- 评审 PR 前的快速上下文了解

**何时用**:
- "Kubernetes 的 controller-runtime 怎么调度 Reconcile?"
- "Anthropic Claude Code 的 hook 机制是什么?"

**何时不用**:
- 私有仓库(deepwiki 只索引公开 GitHub)
- 极冷门仓库(可能未被 deepwiki 索引)

### 4.4 `memory` —— 跨会话知识图谱

**包**:`@modelcontextprotocol/server-memory`

**工具名**:`mcp__memory__*`(create_entities / create_relations / search_nodes / read_graph / add_observations / delete_entities 等)

**持久化文件**:`$HOME/.claude/memory/memory.jsonl`(**需先跑 `./install.sh install-memory-mcp` 修路径**)

**典型用法**:
- 记项目约定 / 用户偏好 / 跨会话事实
- 检索历史决策 / 已建实体与关系
- 长期知识积累(7 个 entities + 14 relations 等)

**数据模型**:
- **entity** = 命名的事实单元(有 `entityType` + `observations[]`)
- **relation** = entity 间的有向连接(有 `relationType`)
- **graph** = 整体图谱,用 search_nodes / read_graph 查询

**何时用**:
- "记住:本项目 L1 英文 / L2 中文"
- "上次那个 v1.0.4 release 用了什么策略?"
- "OMC 与 CLAUDE.md symlink 冲突怎么解?"

**何时不用**:
- 临时性数据(用环境变量即可)
- 大体量二进制(用文件 / 数据库)
- 需要强一致性事务(本服务是 best-effort)

**修复持久化**(必读):
- 默认会把图谱存到 npx 缓存目录(每次启动路径不同),导致**跨进程不共享**
- **首次安装必跑**:`./install.sh install-memory-mcp`(幂等,已配则 return 0)
- 详见 [`INSTALL.md`](./INSTALL.md#mcp-memory-修复) MCP memory 修复段

---

### 4.5 `coding-bridge` —— External Review MCP(必装)

对应 `global/CLAUDE.md` 的 `runReview()` 抽象层(`codex` / `kimi` / `coding-bridge` 三 provider 中的 `coding-bridge` 实现)。

**触发方式**:
- Claude Code 会话内 `runReview({kind: "code", ...})` → `mcp__coding-bridge__review_code`
- `runReview({kind: "plan"|"requirement", ...})` → `mcp__coding-bridge__review_plan`
- 正常情况 Claude 自己会调;你也可用 `@coding-bridge` 提 prompt 显式触发

**来源**:`https://github.com/htmambo/coding-bridge-mcp`(GitHub 源,非 npm 包)
**启动命令**:`npx -y github:htmambo/coding-bridge-mcp`(npm 支持 `github:` 协议自动 clone+build)

**首次使用**:GitHub 仓库 clone 较慢,首次调起会卡 10~30s;之后走 npx 缓存秒启。

**验证**(必跑,确保 allowed_tools 注入成功):
```bash
./install.sh install-coding-bridge-mcp
# 输出应包含 "coding-bridge MCP: ready"
```

**排错**:
- 输出 `NOT in .../execution_config.json allowed_tools` → 重新 `./install.sh --force`
- 报 `command not found` / `npx fail` → 检查 `node` / `npx` 是否在 PATH;查看 npx 错误细节

---

## 5. 跨扩展协同

| 场景 | 涉及扩展 | 顺序 |
|---|---|---|
| 接入 `fullauto` 工作流 | `/fix-permissions` → `/fullauto` | 先 fix-permissions 设权限,再 fullauto |
| 提交后让 hook 提示 review | `hooks/review-watchdog.mjs` | Write/Edit 触动代码文件时自动 |
| 改完代码需外部审核 | `review-watchdog` 提示 → `mcp__coding-bridge__review_code` | 提示是 hint,review 需手动调 |
| 跨会话记项目事实 | `/fix-permissions`(`Bash(ls .omc/**)`)→ `mcp__memory__*` | fix-permissions 放权,memory 写入 |
| 清理过期的 fullauto 产物 | `/fullauto-prune` | 单独命令,可不依赖 fullauto |
| 读非工作目录文件 | `mcp__filesystem__*` | 任意时刻,独立 |

---

## 6. 排错速查

| 症状 | 原因 | 修复 |
|---|---|---|
| `/fix-permissions` 后 Claude 启动失败 | fork bomb 规则未转义 | 重跑 `/fix-permissions`(步骤 3.5 会自动规范化) |
| `/fix-permissions` 后写入被拒 | 未设 `defaultMode` | 重启 Claude Code |
| `/fullauto` Phase 2 写 `.omc/**` 被拒 | 未跑 `/fix-permissions` | 先跑 `/fix-permissions`,再跑 `/fullauto` |
| `mcp__memory__*` 重启后返回空 | 持久化路径未修 | 跑 `./install.sh install-memory-mcp` + 重启 Claude |
| `mcp__filesystem__*` 操作 `/etc/*` 被拒 | 沙箱限制在 `$HOME` | 用 sudo / 改用 shell |
| `mcp__context7__*` 拿不到新库 | 库未被 context7 索引 | 用 web search 兜底 |
| `hooks/review-watchdog.mjs` 不触发 | transcript 路径不对 / session id 缺失 | 确认 `CLAUDE_CODE_SESSION_ID` 环境变量存在 |
| `--rollback 1` 找不到 backup | 首次安装未生成 backup | 用 `~/.claude.backups/` 手动找 |

---

## 7. 进一步阅读

- 仓库 [`README.md`](../../README.md) 同步范围表 + 5 分钟上手
- [`INSTALL.md`](./INSTALL.md) 安装 / 命令清单 / Hook 部署 / MCP memory 修复
- [`UPGRADE.md`](./UPGRADE.md) 跨版本迁移 / 升级步骤 / 回滚
- [`docs/Analysis/INVENTORY.md`](../Analysis/INVENTORY.md) 永不入库清单 + 决策表
- [`docs/Architecture/SYSTEM_DESIGN.md`](../Architecture/SYSTEM_DESIGN.md) 系统模块图
- `~/.claude/skills/fullauto/SKILL.md` fullauto skill 完整协议(symlink 链接,本地读)
- `~/.claude/hooks/review-watchdog.mjs` hook 源码(symlink 链接,本地读)
