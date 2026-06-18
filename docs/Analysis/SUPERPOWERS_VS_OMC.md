# Superpowers vs oh-my-claudecode (OMC) 对比分析

> 基于 2026-06-18 本机实装版本对比：
> - **superpowers 6.0.2**：2.4 MB，14 SKILL.md，201 个文件
> - **omc 4.14.6**：373 MB，41 SKILL.md，17138 个文件（包含 node_modules / agents / commands / hooks / dist）
> - 全部数据来自 `~/.claude/plugins/cache/` 实测

## 一句话定位

| | Superpowers | OMC |
|---|---|---|
| **作者** | obra (社区，原 Anthropic 内部?) | Yeachan-Heo |
| **定位** | **方法论库** —— 一组"用 TDD/调试/审阅"的硬性流程 | **执行框架** —— 多 Agent 编排 + 完整 skill/slash/hook 体系 |
| **核心范式** | 流程必须遵守 (TDD / brainstorming / verification) | 多 agent 并行 + Plan→Execute→Verify |
| **触发逻辑** | "任何任务都先 invoke using-superpowers" | 通过 `omc-reference` skill 自动 catalog |
| **跨平台** | Claude Code / Codex / Copilot CLI / Gemini CLI 同一份 skill | 主要面向 Claude Code |
| **代码量** | 14 skill, 极简 | 41 skill + 19 agent + 多个命令 + hook + bin |
| **侵入性** | 低 —— 加 skill 不改你项目结构 | 高 —— 提供 `~/.claude/CLAUDE.md` 模板，hook 注入 |

## 架构对比

### Superpowers = 14 个 skill 的方法论集合

```
skills/
├── using-superpowers        # 入口：任何对话都先调这个
├── brainstorming            # 创意 → 设计（hard-gate：必须先设计再写代码）
├── writing-plans            # 计划文档
├── writing-skills           # 元 skill：用 TDD 写 skill
├── test-driven-development  # 红绿重构
├── systematic-debugging     # 调试方法
├── verification-before-completion  # 完成前验证
├── receiving-code-review    # 接收 review
├── requesting-code-review   # 发起 review
├── executing-plans          # 执行计划
├── subagent-driven-development  # subagent 驱动开发
├── dispatching-parallel-agents   # 并行 subagent
├── using-git-worktrees      # 用 git worktree
└── finishing-a-development-branch
```

**特点**：
- **每个 skill 都是一份 SOP**（"Use when X" + 明确触发条件）
- **不提供 agent**，靠 Claude Code / Codex 原生 subagent
- **TDD 是一等公民**：写 skill 也要 TDD
- **强 hard-gate**：`brainstorming` 里 "Do NOT invoke any implementation skill... until user approved"

### OMC = 41 skill + 19 agent + 命令 + hook + bin

```
skills/ (41)
├── omc-reference      # 自动 catalog 入口
├── plan / ralph / ralplan / autopilot / ultrawork / ultragoal / ultraqa
├── skill / skillify / learner
├── setup / omc-setup / omc-doctor
├── hud / debug / trace / deep-dive
├── release / remember / wiki / writer-memory
├── mcp-setup / configure-notifications / omc-teams
├── ask / ccg / omc-teams / visual-verdict
├── ai-slop-cleaner / code-reviewer / security-reviewer
├── deep-interview / deepinit / external-context / sciomc
├── self-improve / cancel / setup / remember / verify
└── ...

agents/ (19)
├── explore (haiku) / analyst (opus) / planner (opus) / architect (opus)
├── debugger (sonnet) / executor (sonnet) / verifier (sonnet) / tracer (sonnet)
├── security-reviewer / code-reviewer / test-engineer / designer
├── writer (haiku) / qa-tester / scientist / document-specialist
├── git-master / code-simplifier / critic
└ ...

commands/ (many) - slash commands
hooks/ - 多个 hook 脚本
bin/ - CLI 工具
missions/ - 高层目标模板
```

**特点**：
- **多 Agent 编排**：19 个 agent 按 model 路由（haiku/sonnet/opus）
- **完整工作流 skill**：plan→ralph→autopilot→ultrawork→ultraqa
- **持久化状态**：用 `.omc/` 目录做 state、plans、wikis
- **预置 hook**：5+ hook 注入（keyword-detector / persistent-mode / session-start 等）
- **CLI 工具**：`omc` 二进制，集成 IM 通知（Telegram/Discord/Slack）
- **CLAUDE.md 模板**：注入外部审核 MCP 协议（与 dotclaude-portable 高度相关）

## 关键设计差异

### 1. 工作流入口

| | Superpowers | OMC |
|---|---|---|
| 启动 | `using-superpowers` skill 自动 invoke | `omc-reference` skill + `auto_update_check` hook |
| 任何任务 | 必须先 brainstorming → 设计 → 批准 → 实施 | 直接 `plan` 或 `autopilot`（按场景） |
| 硬性 gate | brainstorming 必须 user 批准才进 implementation | ralplan 有 consensus 模式（Critic 多轮），但不是 hard-gate |
| 错误处理 | "verification-before-completion" 是完成前的强 gate | verifier agent + ultraqa 循环 |

### 2. 范围哲学

- **Superpowers**：**少而精**。每个 skill 都经过 TDD 验证（先看 agent 失败，再写 skill，再看 agent 遵守）。14 个 skill 覆盖"开发方法论"全谱。
- **OMC**：**多而全**。提供 plan/execute/verify/release 全流程。41 skill 覆盖从"创建 skill"到"配置 IM 通知"的边角。

### 3. 与项目的关系

- **Superpowers**：**项目无关**。装上后不改你项目结构。
- **OMC**：**项目感知**。用 `~/.claude/CLAUDE.md` 模板 + `.omc/` 状态目录影响项目上下文。会注入"外部审核 MCP 必须用"等规则。

### 4. 代码量与维护成本

| | Superpowers | OMC |
|---|---|---|
| 仓库体积 | 2.4 MB | 373 MB（含 node_modules） |
| 文件数 | 201 | 17,138 |
| skill 数 | 14 | 41 |
| agent 数 | 0（用平台原生） | 19 |
| 启动时间 | 几乎瞬时 | 加载 node_modules 略慢 |
| 依赖 | 几乎无 | Node.js 20+, IM 集成 |

### 5. TDD / 质量门

- **Superpowers** 的 TDD 是**核心**：写代码、写 skill、写文档都要 TDD。"If you didn't watch the test fail, you don't know if it tests the right thing"
- **OMC** 的 TDD 是**可选**：有 `test-engineer` agent 和 `ultraqa` 循环，但**默认不强制** —— 取决于你调哪个 skill

## 与 dotclaude-portable 的兼容性

**两个都兼容**（都是 `claude plugin install` 装），但**维护成本不同**：

| 维度 | superpowers | OMC |
|---|---|---|
| 跨机器装 | `claude plugin install superpowers@superpowers-marketplace` | `claude plugin install oh-my-claudecode@omc` |
| 版本号 | 6.0.2（已 v6） | 4.14.6 |
| 与 dotclaude-portable 的 `.gitignore` 冲突 | 不会（装在 cache/） | 不会（装在 cache/） |
| 与本机 settings.json 冲突 | 不会 | 不会 |
| 但 OMC 的 `setup` skill 会自动写本机 `~/.claude/CLAUDE.md` | — | ⚠️ **会**（覆盖你已有 CLAUDE.md） |
| dotclaude-portable 的全局 CLAUDE.md 会被 OMC 改？ | 否 | ⚠️ **可能**（OMC 装完会改 CLAUDE.md 模板） |

**关键建议**：
- **dotclaude-portable 的 `global/CLAUDE.md` 是用户**自己写的**全局指令**
- **OMC 的 `omc-setup` skill 启动时可能会 patch `CLAUDE.md`**（这与 dotclaude-portable 的"自己的 CLAUDE.md"是同一文件）
- **解决方案**：OMC 装完后**手动** `git restore` 一下 `~/.claude/CLAUDE.md`（symlink 会自动跟仓库同步，但 OMC 直接编辑会临时改）
- **更优雅**：OMC 装的也是 `~/.claude/CLAUDE.md` 的话，dotclaude-portable 应该**先 install（建立 symlink）再 setup-plugins**，让 OMC 知道"这个文件已托管"——目前 OMC 不知道，可能硬写

## 我的建议（给 dotclaude-portable 用户）

**两者都装，但用场景区分**：

| 场景 | 用谁 |
|---|---|
| 写新功能 | superpowers `brainstorming` → `writing-plans` → `TDD` |
| 实施已规划方案 | OMC `plan` → `executor`（多 agent 并行） |
| 调试 bug | superpowers `systematic-debugging`（强方法论） |
| 复杂多步任务 | OMC `autopilot` / `ultrawork` |
| 写新 skill | **都强**：superpowers 强 TDD、OMC 强 skillify |
| Release | OMC `release` 更完整 |
| 团队 IM 通知 | OMC `configure-notifications` |

**避免重叠**：
- 不要同时跑 OMC `plan` + superpowers `writing-plans`（同一件事两种风格）
- 默认用 superpowers 方法论 + OMC 的 agent 编排

## dotclaude-portable 应不应该装哪个？

| 你的需求 | 推荐 |
|---|---|
| 极简 / 方法论严格 / 小项目 | **superpowers**（少而精） |
| 重度多 agent / IM 通知 / 全流程 | **OMC**（多而全） |
| 都要 | 都装，场景区分。**注意 OMC 会改 `CLAUDE.md`，install 后检查一下** |

## 总结

| | Superpowers | OMC |
|---|---|---|
| 优势 | TDD 一等公民 / 极简 / 跨平台 / 文档精炼 | 多 agent 编排 / 全流程 / 持久化状态 / IM 集成 |
| 劣势 | 功能少 / 没有 agent 抽象 | 重 / 侵入 / 与 dotclaude-portable 的 `CLAUDE.md` 有冲突风险 |
| 适合 | 严肃开发（写库、写框架） | 团队作战 / 复杂任务 / IM 集成 |
| 不适合 | 一行脚本 / 一次性任务 | 小项目 / 性能敏感场景 |

**我的判断**：dotclaude-portable 维护 PLUGINS 列表里把两者都列上，但 README 加一段 "**OMC 与 dotclaude-portable 已知冲突**" 说明，避免用户踩坑。
