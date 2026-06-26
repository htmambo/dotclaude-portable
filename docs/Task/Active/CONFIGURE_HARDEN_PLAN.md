# configure.mjs 外部审核落地计划

**Status**: 🔄 In progress (started 2026-06-27)
**Source**: 外部 Review MCP 报告（provider=coding-bridge, SESSION_ID=`0f659944-02b9-42c1-923f-3090198e0274`，2026-06-27）
**Target**: `tools/configure.mjs`（1487 行，v1.0.0）

---

## 〇、外部 Review 复核结论（2026-06-27, provider=coding-bridge, SESSION_ID=cfd1806b-1d19-4e60-974d-d3e4e55529a3）

**Verdict**: APPROVED-WITH-COMMENTS

采纳建议（必须）：
1. **P0-4 冲突解决规则**显式写入计划：`~/.claude/` 优先于 `global/json/`；同名时仅保留一份（以 `~/.claude/` 为准）。
2. **P1-6 等价性验证**：补一个对比脚本/手动验证步骤，确保 push/pop 重构前后 message 出栈时机一致。
3. **冒烟测试**：补 3-5 个 `node:test` 用例覆盖空 .env / 冲突 .env / 格式错 .env / preset 合并。
4. **回退方案**：默认 `git stash`，记录 stash 引用；仅在用户明确同意时用 `git reset --hard`。

采纳建议（可选）：5 — **跳过 P3-14 NIT 编号补齐**。理由：符合"do not create unless necessary"风格；编号跳号无功能影响。已在原 P3-S1 标"deferred"。

---

## 一、任务背景

`tools/configure.mjs` 是 dotclaude-portable 的交互式统一配置向导，承担：
1. 外部 Review 供应商 KEY / provider 写入仓库根 `.env`
2. Claude Code 主供应商预设（`~/.claude/*.json`）合并到 `~/.claude/settings.json.env`
3. `.env` 的 KEY 字面值注入到 `~/.claude.json.mcpServers.coding-bridge.env`
4. 辅助子模块（memory MCP / pre-push / pre-sync-docs）状态只读展示

外部 Review MCP 共发现 14 项有效 finding + 1 项误报（L1104 那个"`生效)`"误报已撤回）。本计划按严重度分四批落地，**严格只动 `tools/configure.mjs`**，不触碰 `install.mjs` / `uninstall` / `~/.zshrc`。

---

## 二、子任务清单与依赖

| # | 优先级 | 子任务 | 关键变更 | 依赖 | 状态 |
|---|---|---|---|---|---|
| P0-S1 | CRITICAL | atomicWrite 文件权限收紧 | `writeFileSync` mode 0o600 + rename 后 chmod 兜底 | — | ⏳ |
| P0-S2 | MAJOR | 删 `_getEntryPanel` 重复 `case 'subs'` | L916-917 去掉第二行 | — | ⏳ |
| P0-S3 | MAJOR | `provider` 匹配改严格相等 | L719-721 `startsWith` → `===` | — | ⏳ |
| P0-S4 | MAJOR | TUI 预设路径统一纳入 `global/json/` | `_scanPresets` 增扫 + `_tuiPresetApply` 用 `file` 字段 | — | ⏳ |
| P1-S1 | MAJOR | state 加 `_context` 替代 breadcrumb 派发 | L1422 字符串匹配 → `_context` 枚举 | P0 完成 | ⏳ |
| P1-S2 | MAJOR | 显式 push/pop/replace API | 封装 `state.push/replace/pop`，加 DEBUG_TUI dump | P1-S1 | ⏳ |
| P2-S1 | MINOR | 删 `_tuiPresetApply` 死代码 `addedKeys` | L1052-1053 删除 | — | ⏳ |
| P2-S2 | MINOR | `parseEnv` 循环索引替代 `indexOf` | L95 | — | ⏳ |
| P2-S3 | MINOR | `setEnvKey` 加 counter 防同毫秒冲突 | L115 | — | ⏳ |
| P2-S4 | MINOR | 抽 `_applyCore` 公共函数 | `configureApply` + `_tuiApply` 共用 | — | ⏳ |
| P3-S1 | NIT | file header 编号补齐 1./2./3./4. | L4-6 | — | ⏳ → **deferred** |
| EXT-PLAN | — | 外部 review_plan 复核本计划 | 调用 `mcp__coding-bridge__review_plan` | 计划定稿后 | ⏳ |
| EXT-CODE | — | 改完外部 review_code 复核 | 调用 `mcp__coding-bridge__review_code` | 代码完成 | ⏳ |
| ARCHIVE | — | git commit + 归档 | 按 `COMMIT_TEMPLATE.md` 写提交信息 | EXT-CODE 通过 | ⏳ |

**执行顺序**：`EXT-PLAN`（计划复核）→ P0 四项 → P1 两项 → P2 四项 → P3 一项 → EXT-CODE → ARCHIVE。

> ⚠️ `EXT-PLAN` 必须**在动手前**完成（CLAUDE.md v2.3.0 §1 步骤 2 强制）；失败按 fallback 链 `coding-bridge → kimi` 切换，再失败走"独立完成 + 透明声明"。

---

## 三、详细变更（按子任务）

### P0-S1: atomicWrite 强制 0600
- **位置**：`tools/configure.mjs` L59-65
- **现状**：`writeFileSync(tmp, content)` 无 mode，新建文件走 umask（典型 022 → 0644），API KEY 世界可读。
- **变更**：
  ```diff
   function atomicWrite(file, content) {
     if (DRY_RUN) { out(c.dim(`[dry-run] would write ${file} (${content.length} bytes)`)); return; }
     mkdirSync(dirname(file), { recursive: true });
     const tmp = `${file}.tmp`;
  -  writeFileSync(tmp, content);
  +  writeFileSync(tmp, content, { mode: 0o600 });
     renameSync(tmp, file);
  +  try { chmodSync(file, 0o600); } catch {}
   }
  ```
- **导入**：`import { ... chmodSync } from 'node:fs'`
- **验收**：`./tools/configure.mjs --dry-run` 不报权限错；新装环境 `ls -la ~/.claude.json` 显 `-rw-------`。

### P0-S2: 删重复 case
- **位置**：L916-917
- **变更**：
  ```diff
       case 'subs': return _panelSubsystems();
  -    case 'subs': return _panelSubsystems();
       case 'show': return _panelShowEnv();
  ```

### P0-S3: provider 严格匹配
- **位置**：L719-721
- **变更**：
  ```diff
  - if (provider.startsWith('xfyun')) activeKey = dotenv.SPARK_API_KEY || dotenv.CODING_BRIDGE_API_KEY || '';
  - else if (provider.startsWith('volcengine')) activeKey = dotenv.ARK_API_KEY || dotenv.CODING_BRIDGE_API_KEY || '';
  + if (provider === 'xfyun-coding') activeKey = dotenv.SPARK_API_KEY || dotenv.CODING_BRIDGE_API_KEY || '';
  + else if (provider === 'volcengine-coding') activeKey = dotenv.ARK_API_KEY || dotenv.CODING_BRIDGE_API_KEY || '';
  ```
  注：`startsWith('xfyun')` 在新 provider 加入时（如 `xfyun-corp`）会误选 SPARK key；改严格相等后未来扩展需显式 if-else。

### P0-S4: TUI 预设路径统一
- **位置**：`_scanPresets` L577-599 / `_tuiPresetApply` L1031-1033 / `configureMainPreset` L619-622
- **问题**：旧 `configureMainPreset` 兜底 `REPO_ROOT/global/json/<name>.base.json`；`_scanPresets` 只扫 `~/.claude/*.json`；`_tuiPresetApply` 直接 `join(CLAUDE_DIR, choice.file)`，找不到 `global/json/` 下的项目自带预设。
- **变更**：
  1. `_scanPresets` 增加扫描 `REPO_ROOT/global/json/*.base.json`（去掉 `.base` 后缀做 id，`file` 字段填完整路径，**标记 `source: 'repo'`**）
  2. `_tuiPresetApply` 不再 `join(CLAUDE_DIR, choice.file)`，改用 `choice.file` 已经是完整路径
  3. `configureMainPreset` 的兜底逻辑保留（向后兼容非 TTY 路径），但优先用 `_scanPresets` 返回的 file 字段
- **冲突规则（采纳 review 建议 1）**：
  - **`~/.claude/` 优先于 `global/json/`**。两者同名（去后缀后）时，仅保留 `~/.claude/` 那份，丢弃 `global/json/` 那份。
  - 实现：先收 `~/.claude/*.json` 进 Map（id→entry），再扫 `global/json/*.base.json` 时**用 id 判重**，存在则 skip。
  - 这是验收硬条件。
- **验收**：TUI 模式"主供应商预设"菜单能列出 `global/json/` 下所有 `.base.json`；与 `~/.claude/` 同名时不重复。

### P1-S1: state._context 替代 breadcrumb
- **位置**：L1422 + 各 `_tui*` 设置 `state._context`
- **变更**：
  ```diff
  - if (state.panel.breadcrumb && state.panel.breadcrumb.includes('外部 Review 供应商 > 供应商')) {
  + if (state._context === 'review-provider') {
  ```
  并在 `_tuiReviewRun` provider 分支设 `state._context = 'review-provider'`，其它分支设 `'review'` / `'preset'` / `'apply'` / `'subs'` / `'show'`。
- **验收**：修改 breadcrumb 文本不再影响派发逻辑。

### P1-S2: 显式 push/pop/replace API
- **位置**：`main()` L1287-1454 + 各 `_tui*` 函数
- **设计**：
  ```js
  const _panelOps = {
    push(state, panel)   { state.panelStack.push(state.panel); state.panel = panel; },
    replace(state, panel){ state.panel = panel; },  // 不改 stack
    pop(state)           { state.panel = state.panelStack.pop() || _getEntryPanel(state.mainIdx); },
  };
  ```
  替换 5 处 `state.panelStack.push(...); state.panel = ...` 模式为 `_panelOps.push(state, ...)`。
- **DEBUG 钩子**：`process.env.DEBUG_TUI === '1'` 时每次 push/pop 打印 `panelStack` 长度。
- **等价性验证（采纳 review 建议 2）**：
  - 在 `tests/configure-tui-trace.md` 写一份"重构前 vs 重构后"的手动对比表，覆盖 4 条典型路径：
    1. review→provider→confirm（直接 Enter）→message 出栈回到 review-top
    2. review→key→input→Enter→message 出栈回到 review-top
    3. review→provider→选 back（如果实现）→回到 review-top
    4. preset→pick→Enter→message 出栈回到 preset-top
  - 每条路径记录 panelStack 长度变化序列（如 `[1, 2, 1]`）—— 重构前后必须完全相同。
  - 验收硬条件。
- **验收**：模拟 breadcrumb 文本变更不破坏状态机；`DEBUG_TUI=1` 跑通 review / preset / apply 三条路径；trace 表 4 条路径 panelStack 序列与重构前完全一致。

### P2-S1: 删 dead addedKeys
- **位置**：L1052-1053
- **变更**：
  ```diff
  - const addedKeys = Object.keys(preset.env).filter(k => !beforeKeys.includes(k) || settings.env[k] !== (settings.env[k] /* sanity */));
    const allKeys = Object.keys(preset.env);
  ```
  注：`beforeKeys` 仍在用（L1047 设值）——保留。

### P2-S2: parseEnv 用循环索引
- **位置**：L91-100
- **变更**：
  ```diff
   function parseEnv(text) {
     const map = new Map();
     const lines = text.split('\n');
  -  for (const line of lines) {
  -    if (!line || /^\s*#/.test(line)) { map.set(`__raw_${lines.indexOf(line)}`, line); continue; }
  +  for (let i = 0; i < lines.length; i++) {
  +    const line = lines[i];
  +    if (!line || /^\s*#/.test(line)) { map.set(`__raw_${i}`, line); continue; }
       const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
       if (m) map.set(m[1], { value: m[2], line: line });
     }
     return { map, lines };
   }
  ```

### P2-S3: setEnvKey 加 counter
- **位置**：L115
- **变更**：模块顶层加 `let _setEnvCounter = 0;`，L115 改 `__new_${Date.now()}_${++_setEnvCounter}_${key}`。
- **验收**：1000 次同毫秒连续调用 key 唯一。

### P2-S4: 抽 _applyCore
- **位置**：`configureApply` L731-772 + `_tuiApply` L1074-1120
- **设计**：抽 `_applyCore(dotenvFlat, { dryRun })` 返回 `{ lines: string[], hasError: boolean }`，两边都调它。`_tuiApply` 复用 lines 拼 message 面板；`configureApply` 复用 lines 走原 out 流程。
- **验收**：逻辑完全等价；两边都不再有"独立维护的 dotenv 解析 + 状态行构造"。

### P3-S1: file header 编号补齐
- **位置**：L4-6
- **变更**：
  ```diff
  - //   1. 外部 Review 供应商：...
  - //   2. Claude Code 主供应商预设：...
  - //   4. 辅助子模块：...
  + //   1. 外部 Review 供应商：...
  + //   2. Claude Code 主供应商预设：...
  + //   3. 辅助子模块：...
  + //   4. 应用 / 重启 Claude Code：把 .env KEY 注入 ~/.claude.json mcpServers.coding-bridge.env
  ```

---

## 四、风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 改权限让已有 `~/.claude.json`（其他工具写入的）出意外 | 低 | 用 `chmodSync` 容错（`try {} catch {}`） |
| `_scanPresets` 纳入 `global/json/` 后菜单项变多，与既有 `~/.claude/*.json` id 冲突 | 中 | 去 `.base` 后缀做 id；同名时优先 `~/.claude/` |
| `state._context` 替换 breadcrumb 派发后某条流程漏标 context | 中 | 派发入口加 `console.assert(state._context)`（DEBUG_TUI 时） |
| P1-S2 显式 push/pop 重写破坏现有 message 出栈 | 中 | 保持 `_topEntry` 重生成逻辑不变；只换 API 不换语义 |
| P2-S4 `_applyCore` 抽象漏掉某种状态行 | 低 | 行级 diff 对比重构前后 message 内容 |

---

## 五、验收标准

- [ ] 全部 P0 + P1 + P2 + P3 子任务完成，git diff 无 dead code / 重复 case
- [ ] `./tools/configure.mjs --dry-run` 不报语法错、不死循环
- [ ] `node -c tools/configure.mjs` 通过（语法检查）
- [ ] TTY 模式手测：跑通 review→provider / review→key 两条路径，message 出栈回到 review-top 不跳错
- [ ] TTY 模式手测：preset 选 `global/json/` 下任一预设能合并到 settings.json
- [ ] TTY 模式手测：apply 路径在 `DEBUG_TUI=1` 下 panelStack dump 干净
- [ ] **冒烟测试（采纳 review 建议 3）**：补 3-5 个 `node:test` 用例在 `tests/configure.test.mjs`，覆盖：
  1. 空 .env 解析 → `dotenvFlat` 为空对象
  2. 含 `SPARK_API_KEY=xxx` 的 .env 解析 → `dotenvFlat.SPARK_API_KEY === 'xxx'`
  3. 含 `KEY='single-quoted'` 的 .env 解析 → 引号被剥
  4. 含 `KEY1=x\nKEY1=y` 重复行的 .env → 后写胜出（不是 raw 冲突）
  5. preset 合并：空 settings.json + 含 env 段预设 → settings.json.env 含预设键
  - 用 `node --test tests/configure.test.mjs` 跑通
- [ ] **回退方案（采纳 review 建议 4）**：默认 `git stash push -m "configure-harden WIP"`；不 reset。stash 引用写入 PLAN.md "Remarks"。
- [ ] 外部 review_code 复核 verdict ≥ APPROVED（或仅 MINOR/NIT 残留）
- [ ] git commit 信息含 OMC trailer block（Constraint/Rejected/Directive/Confidence/Scope-risk/Not-tested）

---

## 六、外部 Review 节点

- **Step 1** (本次)：调用 `mcp__coding-bridge__review_plan` 复核本计划
- **Step 2** (改完后)：调用 `mcp__coding-bridge__review_code` 复核 `tools/configure.mjs`
- **Step 3** (失败时)：按 `coding-bridge → kimi` fallback；都不行则独立完成 + PLAN.md 透明声明

---

## 七、回退方案

如 `review_code` verdict = REJECTED 且问题严重：
1. 立即停止后续子任务
2. 把发现追加到本计划"Remarks"
3. 用户决定：fix forward / git reset --hard HEAD~1

---

## 八、归档时机

- 全部 ✅ + review_code APPROVED → 立刻移动 `docs/Task/Active/CONFIGURE_HARDEN_PLAN.md` 到 `docs/Task/Archive/2026-06/CONFIGURE_HARDEN_PLAN.md`
- 更新 `docs/Task/README.md` 索引
- 单 git commit（按 `COMMIT_TEMPLATE.md`）

---

**Status**: 🔄 In progress
**Owner**: Claude Opus 4.8 (1M context)
**Created**: 2026-06-27
