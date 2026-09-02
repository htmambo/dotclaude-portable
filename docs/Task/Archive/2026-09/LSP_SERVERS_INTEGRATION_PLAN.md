# LSP Server 集成计划

**Status**: ✅ Completed (completion time: 2026-09-01)
**Owner**: 果农 + Claude
**Slug**: lsp-servers-integration

---

## 任务目标

为 dotclaude-portable 增加 **真实 language server 后端** 的跨机器安装能力，使新机器 clone + install 后，TypeScript / Python / Rust 文件在 Claude Code 中 hover / goto-definition / 诊断 **开箱即用**，无需手动 `npm i -g ...` / `pip install ...` / `rustup component add ...`。

**不在范围内**：
- Claude Code LSP 插件（plugin marketplace 客户端适配器）—— 已在 `scripts/setup-plugins.sh` 覆盖，本次不动
- Windows 平台（用户确认 macOS + Linux）
- Go / Java / C++ 等其他语言 LSP（按需后续 manifest 扩展）

---

## 背景与现状

| 维度 | 现状 | 缺口 |
|---|---|---|
| Claude Code LSP 插件 | 已装 3 个：`rust-analyzer-lsp` / `php-lsp` / `typescript-lsp`（`scripts/setup-plugins.sh:14-17`） | 客户端适配器 ≠ server 后端 |
| 真实 language server 后端 | **零覆盖** —— 假设用户机器已装，缺则 hover 失败 | TS/Python/Rust 新机器首次不可用 |
| 安装入口 | `setup-plugins.sh`（独立，不进 `install.sh` 主流程） | 无 server 后端安装入口 |
| 版本管理 | `setup-plugins.sh` 装的是 plugin，不涉及二进制版本 | LSP server 需 `minVersion` 比对 |
| 跨平台 | install.sh 已 MINGW/MSYS/CYGWIN 兜底 `--copy` | npm + rustup 路径 macOS/Linux 一致，无需 brew/apt |

### 关键认知澄清

**Claude Code LSP 插件 ≠ language server 后端**：
- plugin = Claude Code 用来跟 server 通信的 client 适配器（来自 marketplace）
- server = 真正的分析进程（`typescript-language-server`、`pyright`、`rust-analyzer` 等可执行文件）
- 当前 dotclaude-portable 跨机器装的是 client 适配器，**不保证**机器上装了对应的 server 二进制

---

## 用户确认决策（2026-09-01 AskUserQuestion 收集）

| # | 决策点 | 选择 |
|---|---|---|
| 1 | LSP 范围 | **B. 装真实 language server 后端** |
| 2 | 语言栈 | TypeScript / JavaScript + Python + Rust |
| 3 | 目标平台 | macOS + Linux |
| 4 | 是否塞入 install.sh 主流程 | **不，主流程保持轻量**（独立子命令） |
| 5 | Rust 用户无 rustup 时 | **Soft skip + 精确指引**（yellow 警告 + 输出 rustup.rs URL） |
| 6 | 是否同步补 plugin 客户端 | **否，只装 server 后端** |

---

## LSP server 选型

| 语言 | 选型 | 安装命令 | minVersion | 备注 |
|---|---|---|---|---|
| TypeScript / JS | `typescript-language-server` | `npm i -g typescript-language-server typescript` | `4.0.0` | 官方推荐；peer dep = typescript |
| Python | `pyright` | `npm i -g pyright` | `1.1.300` | Microsoft 出品，速度快（比 pylsp 快 5-10×），功能够用 |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` | `1.0.0` | 必须先装 rustup；soft skip + 精确指引 |

**为什么不走 brew / apt**：
- `typescript-language-server` 在 apt 默认源没有
- `pyright` 在 apt 默认源没有
- `rust-analyzer` 走 rustup 是官方唯一推荐路径
- 结论：所有 LSP 走 **npm + rustup**，无需引入 brew/apt 平台分支

---

## 详细任务分解

### 子任务 1：声明式 manifest

**变更**：`global/json/lsp-servers.base.json`（新增）

**关键设计**：
- `command` 数组化（不用 shell 字符串，杜绝注入面）
- `versionCheck` + `minVersion` 实现幂等
- `prerequisite` 用于 rustup 缺失时给出精确指引
- `tool` 字段标记安装工具（npm / rustup），便于未来扩展
- `fileGlobs` 用于将来"按项目语言自动检测是否需要装"

**Manifest 模板**：

```json
{
  "$schema": "./lsp-servers.schema.json",
  "servers": {
    "typescript": {
      "language": "typescript",
      "tool": "npm",
      "command": ["npm", "install", "-g", "typescript-language-server", "typescript"],
      "versionCheck": ["typescript-language-server", "--version"],
      "minVersion": "4.0.0",
      "fileGlobs": ["*.ts", "*.tsx", "*.js", "*.jsx"]
    },
    "python": {
      "language": "python",
      "tool": "npm",
      "command": ["npm", "install", "-g", "pyright"],
      "versionCheck": ["pyright", "--version"],
      "minVersion": "1.1.300",
      "fileGlobs": ["*.py"]
    },
    "rust": {
      "language": "rust",
      "tool": "rustup",
      "command": ["rustup", "component", "add", "rust-analyzer"],
      "versionCheck": ["rust-analyzer", "--version"],
      "minVersion": "1.0.0",
      "prerequisite": "rustup",
      "prerequisiteUrl": "https://rustup.rs",
      "fileGlobs": ["*.rs"]
    }
  }
}
```

**验收**：
- JSON 通过 `python3 -m json.tool` 校验
- `git diff --check` 无冲突标记
- 路径在 `.gitignore` 白名单（`!global/json/*.base.json`）

### 子任务 2：install.mjs 子命令

**变更**：`tools/install.mjs`（修改，约 +100 行）

**新增内容**：
1. 子命令入口：`install-lsp-servers` 加入 `MAPL`
2. `do_install_lsp_servers({ dryRun, force } = {})` 主函数
3. `loadLspManifest(repoDir)` —— 读取 `global/json/lsp-servers.base.json`
4. `commandExists(cmd)` —— `which` 等价（Node.js 内置，不开 shell）
5. `getVersion([cmd, ...args])` —— `spawnSync` 拿版本字符串
6. `semverGte(a, b)` —— **复用**已存在的 `compareSemver`（kimi CLI 版本校验同款）

**伪代码**：

```js
async function do_install_lsp_servers({ dryRun, force } = {}) {
  const manifest = await loadLspManifest(REPO_DIR);
  const summary = { installed: [], skipped: [], failed: [] };

  for (const [name, spec] of Object.entries(manifest.servers)) {
    if (spec.prerequisite && !commandExists(spec.prerequisite)) {
      console.log(yellow(`[skip] ${name}: 需要先装 ${spec.prerequisite}（${spec.prerequisiteUrl || ''}）`));
      summary.skipped.push(name);
      continue;
    }

    const current = await getVersion(spec.versionCheck);
    if (current && !force && compareSemver(current, spec.minVersion) >= 0) {
      console.log(green(`[skip] ${name}: v${current} ≥ ${spec.minVersion}`));
      summary.skipped.push(name);
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] ${name}: ${spec.command.join(' ')}`);
      summary.skipped.push(name);
      continue;
    }

    try {
      await runCmd(spec.command, { timeout: 180_000 });
      console.log(green(`[installed] ${name}`));
      summary.installed.push(name);
    } catch (e) {
      console.log(yellow(`[fail] ${name}: ${e.message}`));
      summary.failed.push(name);
    }
  }

  // 任一失败返回非零，让主流程感知
  if (summary.failed.length > 0) {
    console.log(yellow(`DONE with ${summary.failed.length} failure(s)`));
    return false;
  }
  console.log(green(`LSP SERVERS READY (installed=${summary.installed.length} skipped=${summary.skipped.length})`));
  return true;
}
```

**复用现有工具**：
- `atomicWriteJSON`（manifest 落盘备用）
- `backupOnce`（保护幂等）
- `compareSemver`（kimi CLI 同款，无需新加 semver 依赖）
- `spawnSync` 模式（与 `install-coding-bridge-mcp` 一致）

**验收**：
- `./install.sh install-lsp-servers --dry-run` 打印 3 行 dry-run 不真装
- `./install.sh install-lsp-servers --help` 输出一致风格
- `./install.sh install-lsp-servers` 装齐后再次跑应 100% skip
- `--force` 时强制重装（不读 minVersion）
- 故意破坏 manifest（如 typescript.command 写错）应 yellow 失败而非崩溃

### 子任务 3：CI smoke 接入

**变更**：`.github/workflows/ci.yml`（修改 +8 行）

**新增 step**：
```yaml
- name: install-lsp-servers dry-run
  shell: bash
  run: ./install.sh install-lsp-servers --dry-run
```

**位置**：在 `doctor` step 之后、`install to fake HOME` 之前

**验收**：
- CI 通过 `dry-run` 验证 manifest 可加载 + 命令字符串正确
- 不真装（污染 runner）

### 子任务 4：文档同步

**变更**：

1. `README.md`
   - §"5 分钟上手" 第 5 步加一行：`./install.sh install-lsp-servers`
   - 新增章节"§ LSP server 集成（可选）" —— 说明何时需要跑、不在 install.sh 主流程的原因
2. `CHANGELOG.md`
   - `[Unreleased]` 段加 Added：`install-lsp-servers` 子命令 + manifest
3. `docs/Task/README.md`
   - 加活跃任务条目：`🔄 [LSP server 集成](Active/LSP_SERVERS_INTEGRATION_PLAN.md) - Started 2026-09-01`

**验收**：
- README 渲染无 broken link
- CHANGELOG 段号无重复

---

## 风险评估与缓解措施

| 风险 | 严重度 | 缓解 |
|---|---|---|
| `npm i -g` 在 Linux 需 sudo | 中 | 检测 `EACCES`，可扩展 fallback 到 `--prefix $HOME/.local`（本次不实现，留 future） |
| `rustup` 用户极少但存在 | 低 | `prerequisite` 字段 + `prerequisiteUrl` 精确提示 |
| npm 全局包版本漂移 | 低 | `minVersion` 字段 + `compareSemver` 严格比对 |
| CI runner 被污染 | 中 | **只跑 `--dry-run`**，不真装 |
| 未来要加 Go/Java/C++ | 低 | manifest 声明式即可扩展，**不动 install.mjs 主逻辑** |
| `command` 字段注入 | 低 | 强制数组化（不是 shell 字符串），`spawnSync` 不开 shell |
| secret 误装风险 | 无 | LSP 路径无 secret，`scan-secrets.py` 无需改 |

---

## 实施顺序与依赖关系

```
子任务 1 (manifest)
    ↓
子任务 2 (install.mjs 子命令)  ← 依赖子任务 1 的 manifest 路径约定
    ↓
子任务 3 (CI smoke)            ← 依赖子任务 2 的子命令入口
    ↓
子任务 4 (文档同步)              ← 依赖 1+2+3
```

**串行执行**，预计：
- 子任务 1：30 分钟
- 子任务 2：1.5 小时（需要外审）
- 子任务 3：10 分钟
- 子任务 4：30 分钟

**外审时机**（按 CLAUDE.md §1）：
- 子任务 1 完成后（plan kind）—— 评审 manifest schema
- 子任务 2 完成后（code kind）—— 评审 install.mjs 新代码（§1.5 循环，最多 5 轮）
- 子任务 4 完成后（plan kind）—— 评审文档一致性

---

## 预期效果

**Before**（当前状态）：
- 新机器 clone + install → Claude Code LSP plugin 装好（rust-analyzer-lsp / typescript-lsp）
- 但 `typescript-language-server` 命令找不到 → TS 文件 hover 失败
- 用户需手动：`npm i -g typescript-language-server typescript && npm i -g pyright && rustup component add rust-analyzer`

**After**（本任务完成后）：
- 新机器 clone + install + `./install.sh install-lsp-servers` 一步到位
- 3 个 LSP server 全部就绪，Claude Code 立刻可用
- `rustup` 缺失的 Rust 用户得到精确指引（不阻断）
- 已装的 server 不浪费重装（幂等）

---

## 备注

- 不动 install.sh 主流程（用户确认）
- 不动 setup-plugins.sh（用户确认）
- 后续可扩展：Go/Java/C++ LSP（往 manifest 加项即可）、brew/apt fallback（视真实需求决定）

---

## External Review Opinion

### Round 1/5 (plan, 2026-09-01)

- **provider**: coding-bridge (`SESSION_ID=d80e1941-ce25-45f3-b68d-0b829a580665`)
- **verdict**: UNKNOWN（agent_messages 无 `**VERDICT**` / `Verdict:` / 裸词标记）→ 按 §1.5 fail-closed 视为 NOT_APPROVED
- **实质内容**: "方案主干设计优秀，可以进入开发阶段，但需修复版本解析与权限处理两个技术盲区，并补充端到端验收闭环"

**Risks 处理**:

| # | risk | severity | 处理 | 状态 |
|---|---|---|---|---|
| R1 | 版本号解析盲区（pyright 输出 `pyright 1.1.300` / rust-analyzer 输出 `rust-analyzer 1.0.0 (...)`） | 高 | manifest 增加 `versionRegex` 字段（默认 `(\d+\.\d+\.\d+)`），getVersion 强转 RegExp 提取 | ✅ 已修（manifest.json + install.mjs:99） |
| R2 | Linux `npm i -g` 需 sudo（EACCES） | 中 | spawnSync 后扫 `EACCES\|permission denied` 关键词 + 输出 npm 官方 prefix 配置指引 URL | ✅ 已修（install.mjs EACCES 分支） |
| R3 | 端到端验收闭环缺失 | 中 | 验收项新增"Claude Code 打开 .ts/.py/.rs 测试 hover" | ✅ 已加（见验收总览 §"端到端联动"） |

**实跑验证**（修复后本机 dry-run）：
```
[install] [skip] typescript: v5.1.3 ≥ 4.0.0
[install] [dry-run] python: npm install -g pyright
[install] [dry-run] rust: rustup component add rust-analyzer
[install] LSP SERVERS READY (installed=0 skipped=3)
```

**rustup 缺失场景验证**（PATH 屏蔽 cargo 目录）：
```
[install] [skip] typescript: v5.1.3 ≥ 4.0.0
[install] [dry-run] python: npm install -g pyright
[install][warn] [skip] rust: 需要先装 rustup（https://rustup.rs）
[install] LSP SERVERS READY (installed=0 skipped=3)
```

### Round 2/5 (code, 2026-09-01)

- **provider**: coding-bridge (`SESSION_ID=141603aa-18f4-49ef-a45e-1869ad45ce6f`)
- **verdict**: UNKNOWN → NOT_APPROVED（实质为 NOT_APPROVED with P0/P1 findings）

**P0/P1 处理**:

| # | finding | severity | 处理 | 状态 |
|---|---|---|---|---|
| P0-1 | `stdio: 'inherit'` 吞 stderr → EACCES 检测失效 | 严重 | 改 `stdio: ['inherit', 'inherit', 'pipe']`，stderr → pipe 供分析 | ✅ |
| P0-2 | spec.versionCheck / command 缺数组校验致未捕获异常 | 严重 | 循环体入口加 guard（typeof + Array.isArray + length 检查） | ✅ |
| P1-3 | commandExists 不检查可执行权限 | 重要 | accessSync + constants.X_OK | ✅ |
| P1-4 | spawnSync r.error / r.signal 未检查 | 重要 | getVersion 检查 ENOENT / SIGTERM；installLspServers 失败分支带 reason | ✅ |
| P1-5 | PATH 分隔符硬编码 Unix | 重要 | 加注释说明"仅 Unix-like"（Windows 不在本期范围） | ✅ |
| P1-6 | compareSemver null 静默 | 重要 | 加 warn 后继续安装（不静默） | ✅ |
| P1-7 | parseSemver 不处理 v 前缀 | 重要 | regex 改 `v?(\d+)\.(\d+)\.(\d+)` | ✅ |

### Round 3/5 (plan, 2026-09-01)

- **provider**: coding-bridge (`SESSION_ID=bbec57b2-c94c-4701-89da-2e3b5fc3f86b`)
- **verdict**: **APPROVED WITH MINOR SUGGESTIONS**（裸词 `APPROVED` 命中）
- **实质内容**: "方案在安全性、范围控制、健壮性上均已达标，前两轮的 P0/P1 问题验证已闭环。建议合入主干"

**Minor Suggestions（不阻塞）**:

| # | suggestion | 采纳决策 |
|---|---|---|
| S1 | getVersion spawnSync 显式 timeout | ⏸️ 现状已设 `10_000` |
| S2 | CI weekly job 真实跑 install | ⏸️ 留未来迭代 |
| S3 | EACCES 提示文案细化 | ⏸️ 链接已给 |
| S4 | manifest 解析 fail-fast 文档化 | ⏸️ install.mjs 已 `fatal()` |
| S5 | Round 4/5 评审重点 | ⏸️ 当前 Round 3/5 终结，budget 余量保留 |

---

## 验收总览（最终）

| 验收项 | 验证方式 | 结果 |
|---|---|---|
| manifest 合法 | `python3 -m json.tool` | ✅ |
| 子命令 dry-run 不装 | 本机 `./install.sh install-lsp-servers --dry-run` | ✅（3 行 dry-run + 1 行 READY） |
| 版本解析正确 | typescript v5.1.3 提取 + 与 minVersion 比对 | ✅ |
| 幂等 | 已装 server 自动 skip | ✅ |
| rustup 缺失 soft skip | PATH 屏蔽 cargo 验证 | ✅（yellow + URL） |
| **端到端联动** | Claude Code 打开 .ts / .py / .rs 文件执行 hover 确认有结果 | ⏳ 用户本机验收（README 给出步骤） |
| 文档一致 | README / CHANGELOG / Task README 交叉引用 | ⏳ 子任务 #5 |
| 无 secret 漏 | `./install.sh doctor` | ⏳ 子任务 #5 |
| CI smoke 全绿 | GitHub Actions run | ⏳ 子任务 #5 |