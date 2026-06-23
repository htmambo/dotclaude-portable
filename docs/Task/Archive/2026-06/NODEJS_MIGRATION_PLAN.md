---
status: 🔄 进行中
created: 2026-06-23
owner: hoping
scope: install.sh 核心逻辑迁 Node.js (1.0.7 → 2.0.0)
---

# install.sh 核心逻辑迁 Node.js (1.0.7 → 2.0.0)

## 背景

用户反馈 + 自审共识：install.sh 已经从"一键安装脚本"演化成"配置管理工具"，继续在 bash 里嵌 Python heredoc 是 anti-pattern。

**当前 install.sh 现状（1.0.7, 591 行）**：
- bash 3.2 兼容代码（mapfile → while read 等历史包袱）
- 3 段 Python heredoc（JSON render / settings.json merge / .claude.json merge）
- 10 个子命令（install / uninstall / doctor / check / rollback / install-pre-push / install-statusline / install-memory-mcp / install-coding-bridge-mcp / install-coding-bridge-allow / install-coding-bridge-json）
- macOS / Linux 平台兼容
- backup + atomic write

**Node.js 优势**：
- 内建 JSON.parse / stringify，无 Python heredoc
- fs.symlinkSync / copyFileSync / renameSync 跨平台
- async/await 错误传播清晰
- 内建 unit test（node:test）

## 重构方案

### 架构

```
install.sh                    # 薄入口：arg 解析 + 平台检测 + delegate
└── tools/install.mjs         # 核心：所有配置管理逻辑
    ├── paths.js              # 路径常量（HOME / TARGET / REPO / BACKUP）
    ├── backup.js             # 备份 + atomic write
    ├── render.js             # JSON render + ${VAR} 占位
    ├── merge.js              # settings.json / .claude.json 深合并
    ├── hooks.js              # hooks 部署 + HOOK_FILES
    ├── mcp.js                # MCP server 配置合并
    ├── subcommands/          # 各子命令实现
    │   ├── install.js
    │   ├── uninstall.js
    │   ├── doctor.js
    │   ├── check.js
    │   ├── rollback.js
    │   ├── install-pre-push.js
    │   ├── install-statusline.js
    │   ├── install-memory-mcp.js
    │   ├── install-coding-bridge-mcp.js
    │   ├── install-coding-bridge-allow.js
    │   └── install-coding-bridge-json.js
    └── cli.js                # arg 解析（process.argv）
```

### install.sh（瘦身版，约 80 行）

```bash
#!/usr/bin/env bash
set -euo pipefail

# 平台检测：MINGW* / MSYS* / CYGWIN* → --copy 模式（Windows 兜底）
MODE="symlink"
case "$(uname -s 2>/dev/null || echo Windows)" in
  MINGW*|MSYS*|CYGWIN*) MODE="copy" ;;
esac

# bash 3.2+ 校验（macOS 系统 bash 3.2.57 也兼容）
if [[ "${BASH_VERSINFO[0]:-0}" -lt 3 ]]; then
  echo "[err] requires bash >= 3.2 (current: ${BASH_VERSION})" >&2
  exit 1
fi

# 找 node（macOS npx 自带，Linux 用系统 node）
if ! command -v node >/dev/null 2>&1; then
  echo "[err] node >= 18 required; install via nvm / brew / apt" >&2
  exit 1
fi

# delegate 到 tools/install.mjs，传递所有参数
exec node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)/tools/install.mjs" \
  --mode "$MODE" \
  --repo "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)" \
  "$@"
```

### tools/install.mjs（核心）

```js
#!/usr/bin/env node
// Node.js >= 18
'use strict';

import { parseArgs } from 'node:util';
import { runInstall } from './subcommands/install.js';
import { runUninstall } from './subcommands/uninstall.js';
// ...

const { values, positionals } = parseArgs({
  options: {
    mode: { type: 'string', default: 'symlink' },
    repo: { type: 'string', default: '.' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const action = positionals[0] ?? 'install';
const ctx = { ...values, repo: values.repo, action };

const handlers = {
  install: runInstall,
  uninstall: runUninstall,
  doctor: runDoctor,
  check: runCheck,
  rollback: runRollback,
  'install-pre-push': runInstallPrePush,
  'install-statusline': runInstallStatusline,
  'install-memory-mcp': runInstallMemoryMcp,
  'install-coding-bridge-mcp': runInstallCodingBridgeMcp,
  'install-coding-bridge-allow': runInstallCodingBridgeAllow,
  'install-coding-bridge-json': runInstallCodingBridgeJson,
};

if (!handlers[action]) {
  console.error(`[err] unknown action: ${action}`);
  process.exit(2);
}

handlers[action](ctx).catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
```

### 关键模块设计

**paths.js** — 路径常量
```js
export const paths = (home, repo) => ({
  TARGET_HOME: `${home}/.claude`,
  BACKUP_ROOT: `${home}/.claude.backups`,
  REPO_ROOT: repo,
  HOOKS_DIR_REPO: `${repo}/hooks`,
  HOOKS_DIR_TARGET: `${home}/.claude/hooks`,
  CLAUDE_JSON: `${home}/.claude.json`,
  SETTINGS_JSON: `${home}/.claude/settings.json`,
  MCP_JSON: `${home}/.claude/.mcp.json`,
  // ...
});
```

**backup.js** — 备份 + 原子写
```js
import { renameSync, copyFileSync, existsSync } from 'node:fs';

export function backupOnce(file) {
  // 已有任意 .bak.* 则跳过
  const dir = path.dirname(file);
  const base = path.basename(file);
  const existing = readdirSync(dir).filter(f => f.startsWith(base + '.bak.'));
  if (existing.length > 0) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const bak = `${file}.bak.${ts}`;
  copyFileSync(file, bak);
  return bak;
}

export function atomicWriteJSON(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
}
```

**render.js** — ${VAR} 占位
```js
export function renderTemplate(src, env = process.env) {
  return src.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    const [name, ...rest] = expr.split(':-');
    const def = rest.length ? rest.join(':-') : match;
    return env[name] ?? def;
  });
}
```

**merge.js** — 深合并
```js
export function deepMerge(target, source) {
  for (const [key, val] of Object.entries(source)) {
    if (Array.isArray(val) && Array.isArray(target[key])) {
      // 数组：追加（不去重，由调用方决定）
      target[key] = [...target[key], ...val.filter(v => !target[key].includes(v))];
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      target[key] = deepMerge(target[key] ?? {}, val);
    } else if (target[key] === undefined) {
      target[key] = val;
    }
  }
  return target;
}
```

**hooks.js** — HOOK_FILES 发现 + 部署
```js
export function discoverHooks(repoRoot) {
  const dir = `${repoRoot}/hooks`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /\.(mjs|sh)$/.test(f))
    .sort();
}

export function deployHooks(ctx, hooks) {
  const targetDir = `${ctx.home}/.claude/hooks`;
  mkdirSync(targetDir, { recursive: true });
  for (const h of hooks) {
    const src = `${ctx.repo}/hooks/${h}`;
    const dst = `${targetDir}/${h}`;
    if (lstatSync(dst)?.isSymbolicLink()) {
      const cur = readlinkSync(dst);
      if (cur === src) continue; // already linked
      if (!ctx.force) throw new Error(`existing symlink → ${cur}`);
      unlinkSync(dst);
    } else if (existsSync(dst)) {
      if (!ctx.force) throw new Error(`exists: ${dst}`);
      // backup
      backupOnce(dst);
      unlinkSync(dst);
    }
    if (ctx.mode === 'symlink') symlinkSync(src, dst);
    else copyFileSync(src, dst);
    chmodSync(dst, 0o755);
  }
}
```

## 迁移步骤

### 阶段 1：骨架（不破坏现有）
- [ ] 1. 新建 `tools/install.mjs` 骨架（只处理 --help / arg 解析）
- [ ] 2. install.sh 改成"delegate 到 node"
- [ ] 3. 测试：install.sh --help 等价

### 阶段 2：迁移基础模块
- [ ] 4. tools/install.mjs + paths.js + backup.js + render.js + merge.js
- [ ] 5. 单元测试（node:test）覆盖基础模块

### 阶段 3：迁移子命令
- [ ] 6. install / uninstall / doctor / check / rollback
- [ ] 7. install-statusline / install-memory-mcp
- [ ] 8. install-coding-bridge-*
- [ ] 9. install-pre-push

### 阶段 4：清理
- [ ] 10. 删 install.sh 里的 Python heredoc
- [ ] 11. install.sh 缩到 ~80 行
- [ ] 12. CI smoke 仍 ALL STEPS PASSED
- [ ] 13. docs 更新（README / INSTALL / ARCHITECTURE）
- [ ] 14. CHANGELOG 2.0.0 + VERSION
- [ ] 15. commit + 归档

## 子任务（本次只做阶段 1-2 骨架）

考虑到任务规模 + 用户当前痛点是 coding-bridge 已 ship，**完整迁移分多次 commit**：
- 本次（2.0.0-alpha）：骨架 + 基础模块 + install/uninstall 跑通
- 后续（2.0.x）：逐步迁剩余子命令
- 1.0.7 仍可用，作为 fallback

## 验收（本次）

- [ ] tools/install.mjs 存在，syntax OK（node --check）
- [ ] install.sh 缩到 ~100 行（不含注释）
- [ ] `./install.sh --help` 输出与原版等价
- [ ] `./install.sh --dry-run` 在 fake-home 通过
- [ ] `./install.sh install-coding-bridge-json` 在用户本机等价（idempotent）
- [ ] CI smoke 仍 ALL STEPS PASSED

## 风险

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| 1 | Node.js >= 18 不是所有机器都有 | P1 | install.sh 检测 + 报错指引 |
| 2 | 迁移期间 bash / node 双栈共存导致行为差异 | P1 | 阶段 1 不动 bash 行为，node 入口只跑子集 |
| 3 | .mjs 路径未在 .gitignore 排除 | P0 | .gitignore 已排除 node_modules，.mjs 在 tools/ 下 |
| 4 | 现有 Python heredoc 行为有微妙差异 | P2 | 单元测试对比 |
| 5 | CI 在 ubuntu-latest Node 18+ 仍可用 | P0 | Ubuntu 22.04 LTS 默认 Node 12，需 apt install 或用 NodeSource |