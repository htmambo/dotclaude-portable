**状态**: ✅ 已完成 (完成时间: 2026-06-19)

## Runtime Decisions

### Files: 6 docs
- fix-1: docs sync for `hooks/review-watchdog.mjs` (added in commit c6c6e39, 96 lines, PostToolUse hook)
  - install.sh: 0 changes (HOOK_FILES already dynamic-scans hooks/*.mjs/*.sh)
  - Files modified: CHANGELOG.md (+1.0.4 section + ref link), README.md (+Hooks 段 +CI 行), docs/Analysis/INVENTORY.md (hooks 表 + 跨机器段 + V0.3+ 待办), docs/Architecture/SYSTEM_DESIGN.md (模块图 + 已知限制), docs/Usage/INSTALL.md (+Hook 部署段), docs/Usage/UPGRADE.md (V0.x→V1.0 新增能力段)
  - Self-check: scan-secrets clean; bash -n all 3 shell scripts OK; grep "9 个 hook 待 V0.3" 残留 0; review-watchdog 出现在 6 文件
  - 2 处二次修复: SYSTEM_DESIGN.md 模块图缩进错误（子节点 vs 根节点）；INVENTORY.md V0.3+ 待办段残留；CHANGELOG.md [1.0.0] Known Limitations 段加跨版本引用
  - 用户决策保持: L2/L5 不动 / slash commands 不动 / shell 注释保留中文
  - Out of scope: review-watchdog.mjs 第 89-91 行 stderr 输出中英混排（不在文档同步范围；如要统一为英文 stderr，需单独立任务）

<!-- self-checked: 6 文件均为 markdown 描述性段落, 无逻辑语义变化, 符合 §4.a 豁免条件 -->

## 任务目标

为已存在的 `hooks/review-watchdog.mjs`（commit `c6c6e39`，96 行）补齐文档同步。
**install.sh 不需要改**（动态扫描 hooks/ 目录，已自动部署）。

## 背景

| 项 | 现状 |
|---|---|
| Hook 文件 | `hooks/review-watchdog.mjs`（已存在，未在文档中提及） |
| 部署机制 | `install.sh` 第 70-73 行 `HOOK_FILES` 动态扫描 `hooks/*.mjs` / `hooks/*.sh`，无需改 install.sh |
| 文档失同步 | 5 处仍写 "9 个 hook 待 V0.3 恢复" 或 "hooks/ 仅有占位" |

## 子任务列表

- [x] ✅ 1. 改 `CHANGELOG.md`：加 1.0.4 段，记录 review-watchdog hook 落地
- [x] ✅ 2. 改 `README.md`：把"永不入库"段里 "9 个 hook 待恢复" 描述修正 + "CI/测试" 段加 hook 部署说明
- [x] ✅ 3. 改 `docs/Analysis/INVENTORY.md`：hooks 段从"⏳ V0.3 占位"改为"✅ review-watchdog 已落地"
- [x] ✅ 4. 改 `docs/Architecture/SYSTEM_DESIGN.md`：模块图 `hooks/` 占位注释修正；"已知限制"段删 "9 个 hook 待 V0.3 恢复"
- [x] ✅ 5. 改 `docs/Usage/INSTALL.md`：在"命令清单"后加 1 段 hook 部署说明
- [x] ✅ 6. 改 `docs/Usage/UPGRADE.md`：V0.x→V1.0 段补 review-watchdog 已落地
- [x] ✅ 7. 端到端验证：scan-secrets clean / bash -n install.sh / grep 自检
- [x] ✅ 8. 归档 + commit

## 每个子任务的改动内容

### 子任务 1：`CHANGELOG.md` 加 1.0.4

在文件顶部 `[1.0.0]` 之前插入：

```markdown
## [1.0.4] - 2026-06-19

### Added

- `hooks/review-watchdog.mjs`：PostToolUse hook，监听 Write|Edit 工具
  - 触及 `.py` `.ts` `.js` `.tsx` `.jsx` `.go` `.rs` `.java` `.kt` `.swift` `.c` `.cpp` `.h` `.sh` `.sql` 等代码文件时
    自动扫描本轮 session transcript 是否调用了 runReview
  - 未检测到 → 在 stderr 输出提示（非阻塞，exit 0）
  - 跳过：`docs/` `.omc/` 前缀与 `*.md` 后缀
  - 自动部署：`install.sh` `HOOK_FILES` 动态扫描 `hooks/*.mjs` / `hooks/*.sh`，无需改 install.sh
- 文档同步：README / INVENTORY / SYSTEM_DESIGN / Usage/{INSTALL,UPGRADE} 全部把 "9 个 hook 待 V0.3" 修正为现状
```

并在文件底部 link references 加：
```
[1.0.4]: https://github.com/htmambo/dotclaude-portable/releases/tag/v1.0.4
```

### 子任务 2：`README.md` 改动

**两处**：

A. "永不入库（实测含 secret 或本机局部）" 段后，**新增** hook 部署说明段：

```markdown
### Hooks（1 个已落地）

- `hooks/review-watchdog.mjs`：PostToolUse hook，代码改动无 runReview 时 stderr 提示
- 自动部署：`./install.sh` 通过 `HOOK_FILES` 动态扫描 `hooks/*.mjs` / `hooks/*.sh`，
  无需手动管理；`--check` 会校验 symlink 健在
```

B. "CI / 测试" 段后加 1 行：
```markdown
- hooks：`HOOK_FILES` 自动从 `hooks/` 目录发现 `*.mjs` / `*.sh`，无需在 `install.sh` 注册
```

### 子任务 3：`docs/Analysis/INVENTORY.md` 改 hooks 段

原表 "⏳ V0.3" 改为：

```markdown
## 同步：hooks（1 个已落地）

| 仓库路径 | 源 | 决策 | 理由 |
|---|---|---|---|
| `hooks/review-watchdog.mjs` | `~/.claude/hooks/review-watchdog.mjs` | ✅ symlink | PostToolUse hook，监听 Write|Edit 工具；触及代码文件但本轮未调 runReview 时 stderr 提示（非阻塞，exit 0） |
| `hooks/.gitkeep` | — | 占位 | 保持 hooks/ 目录在 git 中存在；后续 hook 添加无需 `mkdir` |
```

"跨机器补全"段说明更新：

```markdown
| hooks | `./install.sh` 自动部署 | `HOOK_FILES` 动态扫描 `hooks/*.mjs` / `hooks/*.sh`；`review-watchdog.mjs` 已落地 |
```

"安全防御"段不变（hook 不影响 secret 扫描）。

### 子任务 4：`docs/Architecture/SYSTEM_DESIGN.md` 改 2 处

A. 模块图 `hooks/` 行注释：
```
│   ├── hooks/                   # review-watchdog.mjs（已落地，PostToolUse hook）
```

B. "已知限制" 段删除 "9 个 hook 脚本待 V0.3 从历史快照恢复"，改为：
```
- 其他 8 个 hook 暂未同步（待历史快照恢复或用户按需补齐）；当前 review-watchdog.mjs 已落地
- macOS 未实测
- fish / nushell 用户需自行处理 shell profile 注入
```

### 子任务 5：`docs/Usage/INSTALL.md` 改动

在"命令清单"表格后加 1 段：

```markdown
## Hook 部署

`hooks/` 目录下的所有 `*.mjs` / `*.sh` 文件会被 `./install.sh` 自动发现并部署为 symlink：

- 当前 1 个：`hooks/review-watchdog.mjs`（PostToolUse hook，代码改动无 runReview 时 stderr 提示）
- 新增 hook：只需把文件放进 `hooks/` 目录，重跑 `./install.sh`，无需改 `install.sh`
- 验证：`./install.sh --check` 会校验 `~/.claude/hooks/` 下所有 hook 文件的健康
```

### 子任务 6：`docs/Usage/UPGRADE.md` 改动

V0.x→V1.0 段的 "新增能力" 子段补 1 行：

```markdown
- `hooks/review-watchdog.mjs`：PostToolUse hook（已在 1.0.4 落地）
```

### 子任务 7：端到端验证

- `python3 tools/scan-secrets.py .` clean
- `bash -n install.sh` 无语法错
- grep 自检：`install.sh` 已含 `HOOK_FILES`，无需改
- 章节顺序：CHANGELOG 最新段在顶部

### 子任务 8：归档 + commit

- 任务计划文档移到 `docs/Task/Archive/2026-06/`
- 更新 `docs/Task/README.md` 索引
- commit 信息按 `~/.claude/COMMIT_TEMPLATE.md` + OMC trailer

## 预期效果和验收标准

- 所有用户向文档（README + docs/*）同步到"review-watchdog.mjs 已落地"现实
- install.sh 0 改动（已动态支持）
- 任务文档状态 → ✅ 已完成 → 归档
- 单 commit 含 6 文件改动

## 风险评估和缓解措施

| 风险 | 缓解 |
|---|---|
| CHANGELOG 版本号与现有 release 不一致 | 用 `1.0.4`（最新 commit 后的 patch bump）；不真正打 release tag，仅文档标注 |
| 文档膨胀冗余 | 每段控制在 3-5 行；只改必要的"事实描述"段，不重写已有段落 |
| `review-watchdog.mjs` stderr 输出含中文 | 不在本次范围（按用户先前决定 L2/L5 不动），仅在 Runtime Decisions 中标记 |
| 改动文件过多，单 commit 易失控 | 6 文件改动全部围绕"hook 落地同步"，单一语义；按 §4.d 走 self-checked stamp 豁免外部审核（纯文档） |

## 实施顺序和依赖关系

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8（按章节位置排序，避免 backtrack）

## Runtime Decisions

（完成后追加）

<!-- self-checked: 纯文档同步, 6 文件均为 markdown 描述性段落, 无逻辑语义变化 -->