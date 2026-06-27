**状态**: ✅ 已完成 (完成时间: 2026-06-27)
> Phase 0/1/2/3/4 全完成；三视角 APPROVED ×3 + coding-bridge 外审 APPROVED ×4；6 项 finding + 3 项三视角补充 + 4 项外审硬化全部落地验证
> 对应 fullauto 状态：.omc/fullauto/code-review-fix-2026-06-27/state.json

## 任务目标

落地 2026-06-27 代码审查（净 diff `0d976bb^..HEAD`，16 commits）发现的全部修复项。
目标：让 install.mjs / configure.mjs / .env.example 在合规、健壮、一致性上无遗留问题。

## 问题分析

审查通过 External Review MCP（coding-bridge，SESSION_ID `cfa23c87`）交叉确认 6 项，另补 1 项。
按风险分三档：

| 档 | 项 | 文件:行 | 根因 |
|---|---|---|---|
| P0 | B2 | configure.mjs:530-540 | syncClaudeJsonCodingBridge 写未展开占位符 `${KEY}` 到 ~/.claude.json；MCP env 不经 shell 展开 → 鉴权失败 |
| P1 | B1 | install.mjs:332-345 | installPreSyncDocsHook 先 log "overwrite" 再 skip；误导日志 + installing 在 skip 前打 |
| P1 | B3 | configure.mjs:1393 | TUI input 正则 `[a-zA-Z0-9_\-./+=]` 吞掉含 `:` `$` 等字符的 API key |
| P2 | D1 | install.mjs:86-100 | deepMerge 死代码（零外部调用） |
| P2 | D2 | .env.example:16,19 | KIMI_API_KEY / CODEX_API_KEY 孤儿键，configure.mjs 从不读写 |
| P3 | D3 | configure.mjs:544-558 | syncClaudeJsonKimi 定义但无调用点 |

## 子任务列表

- ✅ ST-1: 修 B1 — installPreSyncDocsHook 日志/行为对齐（install.mjs）
- ✅ ST-2: 修 B2 — syncClaudeJsonCodingBridge 写字面值（configure.mjs）
- ✅ ST-3: 修 B3 — TUI input 字符集放宽（configure.mjs）
- ✅ ST-4: 清 D1 — 删 deepMerge 死代码（install.mjs）
- ✅ ST-5: 清 D2 — .env.example 删孤儿 KEY（.env.example）
- ✅ ST-6: 清 D3 — 删 syncClaudeJsonKimi 死代码（configure.mjs）
- ✅ ST-7（三视角补充 MEDIUM-1）: .env.example 补回 SPARK/ARK 声明
- ✅ ST-8（三视角补充 LOW-1）: installPrePush 对齐 installPreSyncDocsHook 日志顺序
- ✅ ST-9（外审硬化）: provider fallback 静默 warn + hasPlaceholder 精确正则

## 每个子任务的改动内容

### ST-1 (B1) install.mjs installPreSyncDocsHook
- 删第 332-334 行 `if (existsSync(hook)) log("...overwrite...")` 整段（误导）
- 把 `log("installing sync-docs pre-commit hook → ...")` 移到 `if (ctx.dryRun) return` 与 skip 检查**之后**
- 行为不变：已存在 + 无 force → skip+warn；与 installPrePush 对齐

### ST-2 (B2) configure.mjs syncClaudeJsonCodingBridge
- 改为写字面值：从 .env 读 `CODING_BRIDGE_API_KEY`（实际 SPARK/ARK 由 _applyKeysToClaudeJson 负责，此处只保证占位符不落盘）
- **决策**：syncClaudeJsonCodingBridge 是 install.mjs 之外的第二写入路径，统一为写字面值，与 _applyKeysToClaudeJson 语义对齐
- 具体写法：保留 mcp.base.json 的占位符风格给 install 路径；configure 路径读 .env 后写字面值
- 注意：configure 路径调 syncClaudeJsonCodingBridge 的 caller 是 configureReviewProvider（非 TTY）+ TUI provider pick；两处都在 .env 已落地后才调

### ST-3 (B3) configure.mjs TUI input 字符过滤
- 第 1393 行 `if (/[a-zA-Z0-9_\-./+=]/.test(k))` → 删除该正则白名单
- 上一行 `if (k.length === 1 && k >= ' ' && k <= '~')` 已是可打印 ASCII 判定，足够
- hidden 输入无需防注入（值进 .env / ~/.claude.json，不是 shell 命令）

### ST-4 (D1) install.mjs 删 deepMerge
- 删第 83-100 行整段（含注释 + 函数定义）
- 零外部调用，删除安全

### ST-5 (D2) .env.example 删孤儿 KEY
- 删 `KIMI_API_KEY=` 行 + `CODEX_API_KEY=` 行
- 这两个键 configure.mjs / install.mjs 从不读写

### ST-6 (D3) configure.mjs 删 syncClaudeJsonKimi
- 删第 544-558 行整段
- kimi MCP 段由 install.mjs:installCodingBridgeJson 写入，configure 侧此函数无调用点

## 预期效果和验收标准

- ✅ `node --check tools/install.mjs && node --check tools/configure.mjs` 通过
- ✅ `python3 tools/scan-secrets.py .` 仍 clean（exit 0）
- ✅ `grep -rn "deepMerge" tools/` 无命中
- ✅ `grep -n "syncClaudeJsonKimi" tools/configure.mjs` 无命中
- ✅ `grep -n "overwrite with current template" tools/install.mjs` 无命中
- ✅ `.env.example` 无 KIMI_API_KEY / CODEX_API_KEY
- ✅ configure.mjs syncClaudeJsonCodingBridge 不再写 `${...}` 占位符到 ~/.claude.json
- ✅ External Review MCP 单文件复审每项 APPROVED（或未参与已记录）

## 风险评估和缓解措施

| 风险 | 缓解 |
|---|---|
| B2 改字面值后，install 路径仍用占位符 → 两路径需共存 | install 走 renderTemplate 从 process.env 展开；configure 走 .env 解析写字面值；语义不冲突 |
| D2 删 KEY 后用户已填值丢失 | .env.example 是模板，非实际 .env；用户实际 .env 不受影响 |
| 删 deepMerge 后某处隐式依赖 | grep 确认零调用；node --check 验证 |
| B3 放宽字符后误接受控制字符 | 保留 `k >= ' ' && k <= '~'` 可打印 ASCII 上界 |

## 实施顺序和依赖关系

ST-1 (install.mjs) → ST-4 (install.mjs) 同文件，合并一次修复 + 一次 runReview。
ST-2/ST-3/ST-6 (configure.mjs) 同文件，合并一次修复 + 一次 runReview。
ST-5 (.env.example) 独立文件，纯模板改动，self-checked 豁免。

故实际 runReview 调用：install.mjs 1 次 + configure.mjs 1 次 = 2 次（远低于软上限 8）。

## 实施计划
- 路径：.omc/plans/fullauto-code-review-fix-2026-06-27-impl.md

## 外部审核意见（Phase 1）
- provider: coding-bridge
- SESSION_ID: 51b8cf11-faf5-4edb-b614-aba8abc24535
- verdict: **APPROVED**（附 5 项硬化建议，已采纳 3 项）

### 采纳的硬化补丁
- **ST-7（B2 硬化）**：syncClaudeJsonCodingBridge 若 readEnvKey 返回空，warn 并跳过该 MCP entry 写入，不写空值/占位符
- **ST-8（B3 硬化）**：用户输入写入 JSON 前用 JSON.stringify 处理转义（实际 configure 经 atomicWriteJSON 已 JSON.stringify 整个对象，天然转义；确认无需额外处理，但实施时复核）
- **回归验证**：实施后实跑一次 configure 流程，核对生成的 .claude.json env 段为字面值且 JSON 合法

### 评估未采纳
- 风险 5（deepMerge 动态调用）：经查 install.mjs/configure.mjs 无 eval/new Function/字符串派发，grep 穷尽；以"实跑验证"替代 deprecation 过渡（死代码无需过渡）
- 风险 2（两路径边界）：计划已注明职责分离，不改 install 路径（out of scope）

## QA 记录
- Phase 3 验证全绿：
  - `node --check` install.mjs / configure.mjs / backup.mjs：OK
  - grep deepMerge / syncClaudeJsonKimi / "overwrite with current template"：全 0
  - `python3 tools/scan-secrets.py .`：clean (exit 0)
  - B2 回归（隔离 HOME）：API_KEY 字面值写入，无 `${`，合法 JSON，USER_CUSTOM 自定义键保留
  - ST-7 回归：缺 key → warn + skip，不创建 CLAUDE_JSON
- 硬化后回归重跑：
  - fallback warn 触发正确（xfyun 无 SPARK → 用 generic，warn=true）
  - hasPlaceholder 精确正则：`${...}` 检测 true，未闭合 `${` 误判 false
  - 备份权限继承：src 0600 → backup 0600 ✓（验证 backupOnce 用 copyFileSync 继承源权限）

## 验证
- 路径：.omc/fullauto/code-review-fix-2026-06-27/validation.md
- 三视角（OMC 子代理，opus，并行）：functional APPROVED / security APPROVED / code-quality APPROVED
- 三视角揪出 2 项补充（ST-7 MEDIUM-1 / ST-8 LOW-1）已修

## 外部审核意见（Phase 4）
- provider: coding-bridge
- SESSION_ID: f708f3fb-3018-4662-804f-fed8cee45829
- verdict: **APPROVED**（5 项风险，采纳 2 项：provider fallback warn + hasPlaceholder 精确正则）
- 风险 4（备份权限）验证不成立：backupOnce 继承源权限，源 0600 → 备份 0600

## 外部审核意见汇总（全程 coding-bridge）
| 阶段 | SESSION_ID | verdict | 采纳硬化 |
|---|---|---|---|
| Phase 0 事实确认 | cfa23c87 | CONFIRM ×6 | — |
| Phase 1 plan | 51b8cf11 | APPROVED | ST-7 skip-on-missing-key |
| Phase 2 install.mjs | 34aa1e89 | APPROVED | dryRun/force 反馈 |
| Phase 2 configure.mjs | ab0e4d44 | APPROVED（重试） | env spread 保留 + trim |
| Phase 4 final | f708f3fb | APPROVED | fallback warn + 精确正则 |
