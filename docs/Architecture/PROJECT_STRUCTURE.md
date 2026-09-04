# Project Structure

dotclaude-portable 的结构定位、文件角色分工、通用 vs 项目独有的分类法。

## 项目本质

dotclaude-portable 是**用户个人的「Claude Code 全局配置 + 个人工作习惯」跨机器同步解决方案**。

**不是**：

- 通用 portable config（不是给其他终端用户用的）
- 项目内部文档（不是 dotclaude-portable 这个 git 仓库的内部约定文档）

**是**：

- 个人 dotfile 项目——类似 oh-my-zsh 之于 zsh 用户
- 跨机器（家 / 公司 / 笔记本）保持一致的 Claude Code 工作环境
- 包含个人 AI 工作手册、个人 skill、个人 MCP 配置、个人 commit 模板等

## 演进史

1. **v0**：跨机器同步 `~/.claude/CLAUDE.md`
2. **v1**：+ 同步「平时的使用习惯」
3. **v2**：+ skill、hook、MCP 等其他配置
4. **v2.x（当前）**：同步一切「Claude Code 用得到的东西」

## 三层结构

按「**谁来读 / 加载场景 / 内容性质**」切三层：

| 文件 | 加载场景 | 内容性质 | 受益人 |
|---|---|---|---|
| `global/CLAUDE.md` | symlink → `~/.claude/CLAUDE.md`，**所有项目下** Claude Code 都加载 | 用户个人的 AI 工作手册 | 用户自己，跨项目跨机器 |
| 根 `CLAUDE.md` | 只在 dotclaude-portable 仓库下加载 | 仓库自身的开发约定 | 用户自己，仅本仓库 |
| `CONTRIBUTING.md` | 给**人**看的开发文档（GitHub 渲染） | 仓库面向未来协作者的流程 | 未来可能的协作者 |

## 通用 vs 项目独有——分类法

> 「通用」必须细化，否则会再次陷入「角色错位」误判。

| 类型 | 定义 | 归属 |
|---|---|---|
| **跨项目通用** | 用户在不同 git 项目下都要遵守 | `global/CLAUDE.md` |
| **跨机器通用** | 用户在不同物理机器上都要遵守 | `global/CLAUDE.md` |
| **仓库独有** | 只在 dotclaude-portable 仓库下有意义 | 根 `CLAUDE.md` |
| **人读文档** | 面向未来协作者（GitHub 渲染） | `CONTRIBUTING.md` |

> ⚠️ **「通用」不等于「对其他用户也通用」**——只对你自己跨项目跨机器通用。

## 各文件当前内容分类

### `global/CLAUDE.md`（用户个人 AI 工作手册）

#### 跨项目通用

- **Working Principles**（第一性原理 / code-as-truth / 聚焦变更 / 禁 Co-Authored-By）
- **Workflow Requirements**（rg 偏好 / 现有边界 / 占位符 / PR 模板 / 人能解释 / scratch 不入库）
- **8 条 system constraints**：Interaction language / Multi-turn dialogue / Sandbox safety / Code sovereignty / Style definition / Targeted changes / Context retrieval / Basis for judgment

#### 用户跨项目专属（你自己的 MCP / 任务管理 / 协议）

- **External Review MCP**：coding-bridge + codex fallback（你特意接入的 review 流程）
- **Documentation and Task Management**：`docs/Task/Active/...` 目录约定
- **Review Provider Tool Invocation Specification**：`mcp__codex__codex` 与 `mcp__coding-bridge__review_code` 调用规范
- **/fullauto Collaboration Agreement**：fullauto 协议

> 这些「跨项目专属」对**其他用户**不通用，但对**你**跨项目都通用——所以归 `global/CLAUDE.md`。
> 这是「`global/` 不是给其他终端用户的」这一关键定位的体现。

### 根 `CLAUDE.md`（仓库独有的开发约定）

仅 dotclaude-portable 仓库的内部约定（别的仓库没有这些路径/工具）：

- scoped Conventional Commits 风格示例（`fix(install):`、`chore(mcp):` 等）
- `.github/PULL_REQUEST_TEMPLATE.md` 路径
- `scan-secrets.py` pre-push hook 接入
- `global/json/*.base.json` portable payload 豁免
- OMC trailers 必带
- `*.html` mockup / design / demo 规则
- `.tmp/` scratch 目录
- 代码风格（bash / Python / comments）

### `CONTRIBUTING.md`（仓库独有，给未来协作者）

- 开发流程、PR 检查清单、代码风格
- 这是**给人**看的，不是给 AI 看的
- 与根 `CLAUDE.md` 互补：内容可以更详尽（命令清单、checklist），AI 加载根 CLAUDE.md 时已覆盖关键约束

## 修改原则

### 修改 `global/CLAUDE.md` 时

- ✅ 只加**对你自己跨项目都适用**的规则
- ✅ 自检：今天换了别的项目（不是 dotclaude-portable），你还想让 Claude Code 遵守这条吗？
- ❌ 不要加仓库内部约定——那是根 `CLAUDE.md` 的事
- ❌ 不要加只在某个机器 / 场合适用的规则

### 修改根 `CLAUDE.md` 时

- ✅ 只写**仅 dotclaude-portable 仓库**的约定
- ❌ 如果发现某条规则其实跨项目都适用，移到 `global/CLAUDE.md`
- ❌ 不要复制 `CONTRIBUTING.md` 的内容——后者是给人看的

### 修改 `CONTRIBUTING.md` 时

- ✅ 面向未来的协作者（哪怕现在只有你一个人）
- ✅ 与根 `CLAUDE.md` 互补：CONTRIBUTING.md 给**人**看，根 CLAUDE.md 给 **AI** 看

## 未来扩展性

如果某天把 dotclaude-portable 开源给别人用（GitHub 已在 `htmambo` 名下）：

| 改动 | 必要？ |
|---|---|
| `global/CLAUDE.md` 拆分：「个人配置」与「分发配置」分离 | 视情况——可加 `install.sh --skip-personal` 跳过 |
| 根 `CLAUDE.md` | 不变——本来就是仓库自身约定 |
| `CONTRIBUTING.md` | 不变——本来就是面向协作者 |

> 当前不必为此拆分——dotclaude-portable 是**单用户跨机器同步工具**，不是开源分发项目。

## 相关文件清单

| 路径 | 角色 |
|---|---|
| `global/CLAUDE.md` | symlink → `~/.claude/CLAUDE.md`（个人 AI 工作手册） |
| `CLAUDE.md` | dotclaude-portable 仓库自身的开发约定 |
| `CONTRIBUTING.md` | 给未来协作者看的开发流程 |
| `install.sh` + `tools/install.mjs` | portable sync 引擎 |
| `hooks/` | symlink → `~/.claude/hooks/` 的 hook 脚本 |
| `skills/` | symlink → `~/.claude/skills/` 的 skill 脚本 |
| `commands/` | symlink → `~/.claude/commands/` 的 slash command |
| `global/json/*.base.json` | portable 配置 payload（不脱敏，是真实配置） |
| `global/COMMIT_TEMPLATE.md` | symlink → `~/.claude/COMMIT_TEMPLATE.md` |
| `mcp/coding-bridge/`、`mcp/codex/` | git 子模块（用户的 review MCP） |
| `docs/Architecture/SYSTEM_DESIGN.md` | 已有——其他系统设计文档 |
| `docs/Analysis/INVENTORY.md`、`SUPERPOWERS_VS_OMC.md` | 已有——其他分析文档 |
