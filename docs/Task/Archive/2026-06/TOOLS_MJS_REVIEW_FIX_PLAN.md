# tools/*.mjs 外部审核修复计划

**Status**: ✅ Completed (completion time: 2026-06-27)
**Source**: 外部 Review MCP 报告（provider=coding-bridge, SESSION_ID=`460da4f2-28b6-4ab6-bf5e-9d2a12e923e3`，2026-06-27）
**Target**: `tools/install.mjs` (833 行) + `tools/configure.mjs` (1518 行)
**Created**: 2026-06-27
**Completed**: 2026-06-27

---

## 七、执行总结

**8 + 1 commit 全部成功落地**（含 kimi fallback 兜底发现的 H2）：

| # | commit | 主题 |
|---|---|---|
| 1 | 544419c | refactor(tools): 抽 backupOnce 到 tools/lib/backup.mjs 公共库（B3） |
| 2 | 272623a | fix(install): 修 pruneBackups 引用未声明 ctx 的 ReferenceError（A1） |
| 3 | 822f358 | fix(install): atomicWriteFile 支持 mode + chmod 收紧（A3+B4） |
| 4 | 449aabd | fix(install): shell profile 改 begin/end 块标记 + 多实例循环 strip（A4+A4a） |
| 5 | 0f07477 | fix(install): hook 已存在时无 --force 跳过（A2） |
| 6 | 05fd2d0 | fix(install): installCodingBridgeMcp 返回 boolean + 主流程检查（A5） |
| 7 | aee95ae | fix(configure): setEnvKey 清理旧 __new_* 哨兵条目（B2） |
| 8 | 305625c | fix(configure): SIGINT handler 显式恢复 raw mode + exit（B5） |
| 9 | 711d767 | chore(install): 清理 renderInstall 冗余 existsSync + 文档化 deepMerge（C1+C2） |
| 10 | 934e373 | fix(configure): 补回 showCurrentEnv 函数（kimi 兜底发现 H2） |

### 拒绝项

- **B1 parseArgs typo**：main 流程已有 `if (!fn) err + exit(2)` 保护（smoke 验证：node tools/install.mjs instlal → unknown action: instlal）
- **C3 parseEnv indexOf**：实际已用 for-loop 索引，review 误报
- **C4 TUI 状态机文档化**：文档膨胀风险，超出本次范围
- **H1 fatal() 静默退出**：既有行为退化，不在本轮 17 finding 范围

### Review 链路

1. **Code 阶段**：coding-bridge SESSION_ID=`460da4f2-28b6-4ab6-bf5e-9d2a12e923e3` → 17 finding
2. **Plan 阶段**：coding-bridge SESSION_ID=`6b493f3e-adf9-4cfa-adf6-87cee921a5df` → 8 改进建议（采纳 6 / 拒绝 2）
3. **单文件 fix 阶段 ×9**：每次 commit 后调用 review_code 验证（B3/A1/A3+B4/A4+A4a/A2/A5/B2/B5/C1+C2）
4. **最终验证**：coding-bridge 连续 2 次 timeout → fallback kimi SESSION_ID=`session_69525c2f-6844-49ea-b53a-23249bc83b68` → 发现 H2 showCurrentEnv 缺失 → 已修

### 验收结果

- ✅ backupOnce 抽公共库行为等价
- ✅ atomicWriteFile mode 默认 0o644，4 处显式 0o600
- ✅ installLinkOrCopy chmod 收紧（仅 copy+源可执行）
- ✅ pruneBackups 不再抛 ReferenceError
- ✅ shell profile inject→strip 闭环 + 孤立 start + 多 legacy + 块+legacy 共存 4 个 case 全通过
- ✅ hook --force 双 mode × 双 hook 4 case 全通过
- ✅ install 主流程 warn doctor 推荐
- ✅ setEnvKey 100 次同 key 后 map size 增长受控（2→3）
- ✅ SIGINT handler 注册成功（非 TTY 路径不注册，handler 不影响正常退出）
- ✅ C1 renderInstall 冗余清理 + C2 deepMerge 注释
- ✅ showCurrentEnv 函数补回（非 TTY 路径不再 ReferenceError）

---

## 〇、外部 Review 复核结论（2026-06-27, provider=coding-bridge）

**Code 阶段**：SESSION_ID=`460da4f2-28b6-4ab6-bf5e-9d2a12e923e3` → 17 项 finding（Critical 2 / High 3 / Medium 8 / Low 4）

**Plan 阶段**：SESSION_ID=`6b493f3e-adf9-4cfa-adf6-87cee921a5df` → Verdict **APPROVED-WITH-COMMENTS**（共 8 项改进建议）

### 采纳（6 项）

| # | 建议 | 落地位置 |
|---|---|---|
| P1 | A4 回滚方案：stripShellProfile 必须能同时处理新老标记 | A4a 增强：明确"先按 begin/end 块删；找不到再 fallback 老单行正则"——**计划已含 A4a，确认采纳** |
| P2 | `atomicWriteFile` 默认 mode 0o644，敏感文件显式传 0o600 | A3 修订：默认值调整 + 显式参数；并搜索 configure.mjs 是否有遗漏调用点 |
| P3 | `setEnvKey` 代码片段 `_setEnvCounter` 未声明 / 遍历删除问题 | B2 修订：模块顶层声明 `let _setEnvCounter = 0`；遍历时先收集待删 key 再批量删 |
| P5 | SIGINT 用 `process.once` 而非 `process.on` | B5 修订 |
| P7 | A5 任务增 README 提示"install 后请跑 doctor 确认" | A5 修订：验收点加文档同步检查 |

### 拒绝（2 项）

| # | 建议 | 拒绝理由 |
|---|---|---|
| P4 | B3 抽公共库前先写特征测试 | 仓库零运行时依赖也零测试基础设施（无 jest/vitest/node:test 脚本）。为 B3 引入测试框架是过度工程。改用手测验证（acceptance 已含 install / configure 流程） |
| P8 | 给每个子任务标预估工时 + 总体时间线 | 个人项目 + 单次会话执行，工时估算无意义；按 commit 粒度推进 |

### 部分采纳

| # | 建议 | 落地 |
|---|---|---|
| P6 | A1/A4/A5 补单元测试 | **有限采纳**：A1 加最小化手测脚本（mock mkdir + 触发 prune）；A4/A5 用 shell 脚本模拟环境验收 |
| 顺序 | A3+B4 前先完成 B3 | **采纳**：B3 提前到 A3 之前，因为抽库会影响两个文件 import 路径

---

## 一、任务背景

用户指令：「调用外部工具审核一下 tools/*.mjs」（2026-06-27）

外部 Review MCP（coding-bridge）共发现 17 项 finding：
- **Critical**: 2 项（`pruneBackups` ctx 未声明；hook 覆盖无保护）
- **High**: 3 项（cp -a 恢复无校验；权限不一致；stripShellProfile 正则不严）
- **Medium**: 8 项
- **Low**: 4 项

主助手二次质疑：
- #1（pruneBackups）严重程度降一档（install 全新环境不会触发）
- #2（hook 覆盖）属于有意行为，应加 `--force` 保护而非禁覆盖
- #10（相对路径）部分误报（doctor 已用绝对路径；hook 内部用 `${REPO_ROOT}`）
- #13（fallback 链）真实风险，install 主流程忽略 verify 返回值

本计划按"必须修 / 应该修 / 可选"三档落地；**严格只动 `tools/install.mjs` 与 `tools/configure.mjs`**，不触碰 `install.sh` / `uninstall` / `~/.zshrc` 等运行时脚本。

---

## 二、子任务清单与依赖

### 档 A：必须修（阻塞发布）

| # | 优先级 | 子任务 | 关键变更 | file:line | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| A1 | CRITICAL | 修 `pruneBackups` ctx 未声明 | 函数签名加 ctx 参数；调用点 `backupExisting:227` 同步 | `install.mjs:230,239,227` | — | ⏳ |
| A2 | CRITICAL | hook 覆盖加 `--force` 保护 | `installPrePush` / `installPreSyncDocsHook`：已存在时无 ctx.force 则 skip + warn | `install.mjs:309,321` | — | ⏳ |
| A3 | HIGH | `atomicWriteFile` 敏感文件权限 0600 | 默认 mode=0o644；敏感文件显式传 0o600；搜索 configure.mjs 是否有遗漏调用点（CLAUDE.md 要求所有 KEY 文件 0600） | `install.mjs:69,365,422,452,573`；`configure.mjs:64` | — | ⏳ |
| A4 | HIGH | `stripShellProfile` 用 begin/end 块标记 | 注入端加 `# >>> ... start >>>` / `# <<< ... end <<<`；删除端按块匹配 | `install.mjs:246,257` | A4a | ⏳ |
| A4a | HIGH | 配套：保留向后兼容（老 marker 单行也能 strip） | 先按 begin/end 块删；找不到块再 fallback 老单行正则 | 同上 | — | ⏳ |
| A5 | HIGH | `install` 主流程检查 verify 返回值 + README 提示 | `installCodingBridgeMcp` 返回 ok=false 时非阻塞 warn；README 安装步骤后加"请跑 ./install.sh doctor 确认配置" | `install.mjs:712,727`；`README.md` | A3 | ⏳ |

### 档 B：应该修（下次改动窗口）

| # | 优先级 | 子任务 | 关键变更 | file:line | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| B1 | MEDIUM | `parseArgs` typo 检测 | default 分支：`err('unknown action: ...')` + exit(2) | `install.mjs:782-790` | — | ⏳ |
| B2 | MEDIUM | `setEnvKey` 清理旧 `__new_*` 条目 | 插入新条目前 delete 同 envKey 的旧哨兵 key；模块顶层声明 `let _setEnvCounter = 0`；遍历时先收集待删 key 再批量删（避免 Map iteration + delete 可读性问题） | `configure.mjs:112-123` | — | ⏳ |
| B3 | MEDIUM | `backupOnce` 抽公共库 | 新建 `tools/lib/backup.mjs`；两处 import | `install.mjs:54`, `configure.mjs:81` | — | ⏳ |
| B4 | MEDIUM | `installLinkOrCopy` chmod 0o755 收紧 | 只在 copy mode 且源文件可执行时才 chmod；symlink 跳过 chmod | `install.mjs:140-148` | — | ⏳ |
| B5 | MEDIUM | SIGINT handler 恢复 raw mode | `process.once('SIGINT', ...)` 显式 `setRawMode(false)` 后再 `process.exit(130)`（避免与其他处理器冲突） | `configure.mjs:215` | — | ⏳ |

### 档 C：可选（维护窗口）

| # | 优先级 | 子任务 | 关键变更 | file:line | 依赖 | 状态 |
|---|---|---|---|---|---|---|
| C1 | LOW | 删 `renderInstall` 冗余 existsSync 检查 | `existsSync(dst)` 已涵盖 symlink；去重 | `install.mjs:182,212` | — | ⏳ |
| C2 | LOW | `deepMerge` 文档化"仅适用基本类型数组" | 顶部加注释 | `install.mjs:94-108` | — | ⏳ |
| C3 | LOW | `parseEnv` 循环索引替代 `indexOf` | 性能微优化；可不做 | `configure.mjs:95` | — | ⏳ |
| C4 | LOW | TUI 状态机文档化 | 在 `configure.mjs` 顶部加 ASCII 状态转换图 | `configure.mjs:807+` | — | ⏳ |

### 外部复核

| # | 阶段 | 动作 | 依赖 | 状态 |
|---|---|---|---|---|
| EXT-PLAN | plan landing | 调用 `mcp__coding-bridge__review_plan` 复核本计划 | 计划定稿后 | ⏳ |

---

## 三、ACCEPTANCE 标准

### 档 A 验收

- **A1**: `pruneBackups` 在全新 install + 旧 install + 卸载 三条路径下都不抛 ReferenceError；手测触发条件：`mkdir ~/.claude && touch ~/.claude/CLAUDE.md` → 跑 install → 应走 backup → prune 不崩溃
- **A2**: 已存在 hook 时无 `--force` → 跳过 + warn；有 `--force` → 覆盖 + log。手测：`./install.sh install-pre-push` 第二次跑 → 应见 "already exists, skipping"
- **A3**: `stat -c %a ~/.claude/settings.json` 安装后应为 600（原本 644）。手测跑完 install 后检查
- **A4**: shell profile marker 改 begin/end；手动 strip 能干净移除；老 marker 也能 fallback 移除
- **A5**: coding-bridge 缺失 KEY 时，install 完成但 log "fallback chain not fully wired"，exit 0（不阻塞用户）

### 档 B 验收

- **B1**: `./install.sh instlal` → exit 2 + error 提示
- **B2**: 反复改同 KEY 100 次后，`loadEnv().map.size` 增长 ≤ 10
- **B3**: `tools/lib/backup.mjs` 存在；install.mjs / configure.mjs 都 import；两边 backupOnce 函数体删空
- **B4**: symlink 安装后 `stat -c %a` 显示保留 repo 内权限（不强制 755）
- **B5**: `Ctrl-C` 在 raw mode 下终端正常恢复（echo 重新打开、cursor 显示）

### 档 C 验收

- **C1**: install dry-run 路径不变；非 dry-run 路径无重复系统调用
- **C2-C4**: 注释 / 文档同步更新；功能不变

---

## 四、风险与缓解

| 风险 | 影响面 | 缓解 |
|---|---|---|
| A3 改 atomicWrite 权限可能让 cron 跑用户读不到 | 中 | 用 0o600 兼容 owner r/w，cron 通常同用户跑 |
| A4 begin/end 块标记升级，老用户 marker 不识别 | 低 | A4a fallback 老单行正则 |
| B3 抽公共库需要 ESM 路径解析 | 低 | 仓库已全 ESM；`tools/lib/` 与 `tools/` 平级，import 用相对 `./lib/backup.mjs` |
| B4 chmod 收紧后某些工具要求可执行 | 中 | 仅对源文件本就有 x 位的文件 chmod；其余保留 umask |
| A5 install 不强制 exit 1 可能让用户漏掉 warn | 低 | log 标 `[install][warn]`；并在 README 加"install 后请跑 doctor 确认" |

---

## 五、执行顺序（修订后：按 P-建议把 B3 提前）

1. ~~EXT-PLAN~~ → ✅ 已完成（采纳 6 / 拒绝 2 / 部分采纳 2）
2. **B3 先抽公共库** → commit（影响后续 A3 / B4 的 import 路径）
3. A1（独立）→ commit
4. A3 + B4（同文件权限相关）→ 一个 commit
5. A4 + A4a → 一个 commit
6. A2 → commit
7. A5 → commit（含 README 提示"install 后请跑 doctor 确认"）
8. B2 → commit（修订：模块顶层声明 _setEnvCounter；先收集待删 key 再批量删）
9. B1 → commit
10. B5 → commit（修订：process.once 而非 process.on）
11. C1-C4 → 单个 commit 或拆
12. EXT-PLAN-VALIDATE（完成后再走一次 review_code 单文件 fix 阶段）

每完成一档立即 archive 到 `docs/Task/Archive/2026-06/` 并更新 README。

---

## 六、备注

- 沿用 `CONFIGURE_HARDEN_PLAN.md` 的子任务表格风格（来源：上轮归档的姊妹文档）
- B2 修订后代码片段（P3 建议落地版；先收集再批量删）：
  ```js
  // 模块顶层（已有，确认未被本次改动删除）
  let _setEnvCounter = 0;

  function setEnvKey(map, key, value) {
    const line = `${key}=${value}`;
    // 1) 先收集同 envKey 的旧哨兵条目，再统一删除（避免 Map iteration + delete 混用）
    const toDelete = [];
    for (const [k, v] of map.entries()) {
      if (typeof v === 'object' && v.line && /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(v.line)) {
        const m = v.line.match(/^\s*([A-Z_][A-Z0-9_]*)/)?.[1];
        if (m === key) toDelete.push(k);
      }
    }
    for (const k of toDelete) map.delete(k);
    // 2) 插入新条目
    map.set(`__new_${Date.now()}_${++_setEnvCounter}_${key}`, { value, line });
    return false;
  }
  ```
- A3 修订后签名：`atomicWriteFile(file, content, { mode = 0o644 } = {})`；调用方传 0o600 的位置：install.mjs 的 atomicWriteJSON（settings.json / claude.json 等含 KEY） + 所有 .env 写入
- A4 begin/end 块标记格式：
  ```
  # >>> dotclaude-portable start >>>
  export CLAUDE_HOME="$HOME/.claude"
  # <<< dotclaude-portable end <<<
  ```
- B3 公共库入口：`tools/lib/backup.mjs`，导出 `backupOnce(file)`；两文件 import：`import { backupOnce } from './lib/backup.mjs'`
- B5 修订：`process.once('SIGINT', () => { if (stdin.isRaw) stdin.setRawMode(false); process.exit(130); });`
- 任务完成时按 CLAUDE.md 规范立即 archive（不留在 Active）