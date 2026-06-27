#!/usr/bin/env node
// tools/install.mjs — install.sh 的 Node.js 核心实现 (2.0.0)
// 完整迁移：覆盖 install.sh 1.0.7 的所有子命令 + 行为。
// Node.js >= 18 要求（macOS 用户已有 npx 自带；Linux 需 apt / nvm 装）。
'use strict';

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  copyFileSync,
  lstatSync,
  readlinkSync,
  unlinkSync,
  chmodSync,
  statSync,
  renameSync,
} from 'node:fs';
import { dirname, join, basename, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { backupOnce } from './lib/backup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = join(__dirname, '..');

const MAX_BACKUPS = 3;

// ─── 日志 ──────────────────────────────────────────────
function log(msg) { console.log(`[install] ${msg}`); }
function warn(msg) { console.warn(`[install][warn] ${msg}`); }
function err(msg) { console.error(`[install][err] ${msg}`); }
function fatal(msg) { process.exit(1); }

// ─── 路径常量 ──────────────────────────────────────────
function makePaths(ctx) {
  return {
    REPO_ROOT: ctx.repo,
    TARGET_HOME: join(ctx.home, '.claude'),
    BACKUP_ROOT: join(ctx.home, '.claude.backups'),
    CLAUDE_JSON: join(ctx.home, '.claude.json'),
    SETTINGS_JSON: join(ctx.home, '.claude', 'settings.json'),
    MCP_JSON: join(ctx.home, '.claude', '.mcp.json'),
    EXEC_CFG: join(ctx.home, '.claude', 'execution_config.json'),
    HOOKS_DIR_REPO: join(ctx.repo, 'hooks'),
    HOOKS_DIR_TARGET: join(ctx.home, '.claude', 'hooks'),
  };
}

// ─── 备份 ──────────────────────────────────────────────
// backupOnce 已抽到 ./lib/backup.mjs（参见 import）
// 行为不变：仅首次备份；symlink 跳过；命名 `<file>.bak.YYYYMMDDHHMMSS`

function atomicWriteFile(file, content, { mode = 0o644 } = {}) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, file);
  try { chmodSync(file, mode); } catch {}
}

function atomicWriteJSON(file, data, opts) {
  atomicWriteFile(file, JSON.stringify(data, null, 2) + '\n', opts);
}

// ─── ${VAR} 占位符渲染 ─────────────────────────────────
function renderTemplate(text, env = process.env) {
  // 兼容 ${VAR} / ${VAR:-default}，缺失保留原字符串
  return text.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    const idx = expr.indexOf(':-');
    if (idx >= 0) {
      const name = expr.slice(0, idx);
      const def = expr.slice(idx + 2);
      return env[name] ?? def;
    }
    return env[expr] ?? match;
  });
}

// ─── symlink / copy 安装 ───────────────────────────────
function installLinkOrCopy(src, dst, ctx) {
  if (!existsSync(src)) fatal(`missing source: ${src}`);
  mkdirSync(dirname(dst), { recursive: true });

  // 已存在的处理
  let existing = null;
  try { existing = lstatSync(dst); } catch {}

  if (existing?.isSymbolicLink()) {
    const cur = readlinkSync(dst);
    if (cur === src) {
      log(`skip (linked): ${relative(ctx.home, dst)}`);
      return;
    }
    warn(`existing symlink → ${cur}`);
    if (!ctx.force) fatal(`use --force to replace`);
    if (!ctx.dryRun) unlinkSync(dst);
  } else if (existing) {
    if (!ctx.force) warn(`exists: ${relative(ctx.home, dst)} (use --force to overwrite)`);
    if (!ctx.dryRun) {
      const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      renameSync(dst, `${dst}.bak.${ts}`);
    }
  }

  if (ctx.dryRun) {
    log(`${ctx.mode}: ${relative(ctx.home, dst)} → ${relative(ctx.repo, src)}`);
    return;
  }
  if (ctx.mode === 'symlink') {
    symlinkSync(src, dst);
    log(`link: ${relative(ctx.home, dst)} → ${relative(ctx.repo, src)}`);
    return;
  }
  copyFileSync(src, dst);
  log(`copy: ${relative(ctx.home, dst)}`);
  // 仅当源文件本身有 x 位才设 0o755；避免给 JSON / md 等配置文件加不必要的执行位
  try {
    const srcStat = statSync(src);
    if (srcStat.mode & 0o111) chmodSync(dst, 0o755);
  } catch (e) {
    warn(`chmod skipped for ${dst}: ${e.message}`);
  }
}

// ─── HOOK_FILES 发现（相对路径）────────────────────────
function discoverHooks(repoRoot) {
  const dir = join(repoRoot, 'hooks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /\.(mjs|sh)$/.test(f))
    .sort();
}

function deployHooks(ctx) {
  const files = discoverHooks(ctx.repo);
  if (files.length === 0) return;
  mkdirSync(makePaths(ctx).HOOKS_DIR_TARGET, { recursive: true });
  for (const h of files) {
    installLinkOrCopy(join(ctx.repo, 'hooks', h), join(makePaths(ctx).HOOKS_DIR_TARGET, h), ctx);
  }
}

// ─── MAP 安装（CLAUDE.md / COMMIT_TEMPLATE.md / base JSON） ─
const MAP = [
  ['global/CLAUDE.md', 'CLAUDE.md', 'symlink'],
  ['global/COMMIT_TEMPLATE.md', 'COMMIT_TEMPLATE.md', 'symlink'],
  ['global/json/execution_config.base.json', 'execution_config.json', 'render'],
  ['global/json/mcp.base.json', '.mcp.json', 'render'],
  ['global/json/.omc-version.base.json', '.omc-version.json', 'render'],
  ['commands/fix-permissions.md', 'commands/fix-permissions.md', 'symlink'],
  ['commands/fullauto-prune.md', 'commands/fullauto-prune.md', 'symlink'],
  ['skills/fullauto/SKILL.md', 'skills/fullauto/SKILL.md', 'symlink'],
];

function renderInstall(src, dst, kind, ctx) {
  const homeRel = relative(ctx.home, dst);
  if (existsSync(dst)) {
    log(`skip render (exists): ${homeRel}`);
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  if (kind === 'symlink') {
    installLinkOrCopy(src, dst, ctx);
    return;
  }
  // render
  if (!existsSync(src)) fatal(`missing source: ${src}`);
  const raw = readFileSync(src, 'utf8');
  const out = renderTemplate(raw);
  if (ctx.dryRun) {
    log(`render+install: ${homeRel}`);
    return;
  }
  atomicWriteFile(dst, out, { mode: 0o600 });
  log(`render+install: ${homeRel}`);
}

// ─── 备份现有文件（首次安装）────────────────────────────
function backupExisting(ctx) {
  const p = makePaths(ctx);
  mkdirSync(p.BACKUP_ROOT, { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const snap = join(p.BACKUP_ROOT, ts);
  let touched = false;
  for (const [, dstRel] of MAP) {
    const dst = join(p.TARGET_HOME, dstRel);
    if (existsSync(dst)) {
      touched = true; break;
    }
  }
  if (!touched) return;
  mkdirSync(snap, { recursive: true });
  for (const [, dstRel] of MAP) {
    const dst = join(p.TARGET_HOME, dstRel);
    if (existsSync(dst)) {
      const relDst = relative(p.TARGET_HOME, dst);
      mkdirSync(dirname(join(snap, relDst)), { recursive: true });
      renameSync(dst, join(snap, relDst));
    }
  }
  log(`backed up existing files to ${snap}`);
  pruneBackups(p.BACKUP_ROOT, ctx);
}

function pruneBackups(backupRoot, ctx) {
  if (!existsSync(backupRoot)) return;
  const snaps = readdirSync(backupRoot)
    .filter(d => { try { return statSync(join(backupRoot, d)).isDirectory(); } catch { return false; } })
    .sort()
    .reverse();
  if (snaps.length > MAX_BACKUPS) {
    for (const d of snaps.slice(MAX_BACKUPS)) {
      if (ctx.dryRun) log(`[dry-run] would prune: ${join(backupRoot, d)}`);
      else {
        log(`pruning old backup: ${join(backupRoot, d)}`);
        rmSync(join(backupRoot, d), { recursive: true });
      }
    }
  }
}

// ─── shell profile 注入 ────────────────────────────────
// 注入用 begin/end 块标记，strip 时按块删除（更鲁棒，不依赖 export 行紧邻）。
// 老版本用单行 `# dotclaude-portable` 标记；strip 时先按块匹配，找不到再 fallback 老标记。
const BLOCK_START = '# >>> dotclaude-portable start >>>';
const BLOCK_END = '# <<< dotclaude-portable end <<<';
const LEGACY_MARKER = '# dotclaude-portable';

function injectShellProfile(ctx) {
  const block = `\n${BLOCK_START}\nexport CLAUDE_HOME="$HOME/.claude"\n${BLOCK_END}\n`;
  for (const f of [join(ctx.home, '.bashrc'), join(ctx.home, '.zshrc')]) {
    if (!existsSync(f)) continue;
    const txt = readFileSync(f, 'utf8');
    if (txt.includes(BLOCK_START) || txt.includes(LEGACY_MARKER)) {
      log(`shell profile tagged: ${f}`); continue;
    }
    log(`appending to ${f}`);
    if (!ctx.dryRun) writeFileSync(f, block, { flag: 'a' });
  }
}

function stripShellProfile(ctx) {
  for (const f of [join(ctx.home, '.bashrc'), join(ctx.home, '.zshrc')]) {
    if (!existsSync(f)) continue;
    let txt = readFileSync(f, 'utf8');
    const hasBlock = txt.includes(BLOCK_START) && txt.includes(BLOCK_END);
    const hasOrphanStart = !hasBlock && txt.includes(BLOCK_START);
    const hasLegacy = txt.includes(LEGACY_MARKER);
    if (!hasBlock && !hasOrphanStart && !hasLegacy) continue;
    log(`stripping dotclaude-portable block from ${f}`);
    if (ctx.dryRun) continue;
    // 1) 完整 begin/end 块（可能多个，循环清除）
    while (txt.includes(BLOCK_START) && txt.includes(BLOCK_END)) {
      const before = txt;
      txt = txt.replace(new RegExp(`\\n?${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n?`), '\n');
      if (txt === before) break;
    }
    // 2) 孤立 BLOCK_START（无 END）：删 start 行 + 紧随的 export 行
    if (txt.includes(BLOCK_START) && !txt.includes(BLOCK_END)) {
      txt = txt.replace(new RegExp(`\\n?${BLOCK_START}\\n[^\\n]*\\n?`), '\n');
    }
    // 3) 老单行标记（紧跟一行 export），循环
    while (txt.includes(LEGACY_MARKER)) {
      const before = txt;
      txt = txt.replace(new RegExp(`\\n?${LEGACY_MARKER}\\n[^\\n]*\\n?`), '\n');
      if (txt === before) break;
    }
    writeFileSync(f, txt);
  }
}

// ─── version marker ──────────────────────────────────
function writeVersionFile(ctx) {
  const marker = join(ctx.home, '.claude', '.dotclaude-portable.version');
  let ver = '0.2.0';
  const verFile = join(ctx.repo, 'VERSION');
  if (existsSync(verFile)) ver = readFileSync(verFile, 'utf8').trim();
  if (ctx.dryRun) { log(`[dry-run] would write ${marker} (${ver})`); return; }
  writeFileSync(marker, `repo=${ctx.repo}\nversion=${ver}\ninstalled_at=${new Date().toISOString()}\n`);
}

// ─── pre-commit hook: sync-docs 检查 ──────────────────
// 跨机器 clone 后,本机的 .git/hooks/pre-commit 不会自动有。
// 跑 install-pre-sync-docs-hook 装一次,后续 git commit 时 hooks/commands/skills
// 任一改动都会跑 sync-docs --check,缺失则 abort。
function installPreSyncDocsHook(ctx) {
  const hook = join(ctx.repo, '.git', 'hooks', 'pre-commit');
  // bash 模板:转义 ${...} 给运行时解析(BASH_SOURCE)
  const script = `#!/usr/bin/env bash
# dotclaude-portable pre-commit hook
# 若新增 hook/command/skill 文件但 README 未同步,abort commit,提示运行:
#   node scripts/sync-docs.mjs --apply
set -euo pipefail

STAGED=\$(git diff --cached --name-only)
if [[ "\$STAGED" == *"hooks/"* ]] \\
   || [[ "\$STAGED" == *"commands/"* ]] \\
   || [[ "\$STAGED" == *"skills/"* ]] \\
   || [[ "\$STAGED" == *"scripts/sync-docs.mjs"* ]]; then
  # Node 缺失时跳过检查(不要因为环境问题阻塞提交)
  if ! command -v node >/dev/null 2>&1; then
    echo '[dotclaude-portable pre-commit] node not found; skipping sync-docs check' >&2
    exit 0
  fi
  REPO_ROOT="\$(cd -- "\$(dirname -- "\${BASH_SOURCE[0]}")/../.." &>/dev/null && pwd)"
  node "\${REPO_ROOT}/scripts/sync-docs.mjs" --check
fi
`;
  if (ctx.dryRun) { log(`[dry-run] would install sync-docs pre-commit hook at ${hook}`); return; }
  // 已存在 hook：无 ctx.force 则 skip + warn，避免静默覆盖用户自定义 hook
  if (existsSync(hook) && !ctx.force) {
    warn(`pre-commit hook already exists at ${hook}; skipping (use --force to overwrite)`);
    return;
  }
  if (existsSync(hook)) log(`overwriting existing pre-commit hook at ${hook} (--force)`);
  log(`installing sync-docs pre-commit hook → ${hook}`);
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, script);
  chmodSync(hook, 0o755);
}

// ─── pre-push hook ────────────────────────────────────
function installPrePush(ctx) {
  const hook = join(ctx.repo, '.git', 'hooks', 'pre-push');
  // bash 模板字符串（不解析 ${...}，运行时由 hook 自身解析 BASH_SOURCE）
  const script = `#!/usr/bin/env bash
set -e
REPO_ROOT="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")/../.." &>/dev/null && pwd)"
python3 "\${REPO_ROOT}/tools/scan-secrets.py" "\${REPO_ROOT}" || { echo '[pre-push] secret detected; abort' >&2; exit 1; }
`;
  if (ctx.dryRun) { log(`[dry-run] would install pre-push hook at ${hook}`); return; }
  // 已存在 hook：无 ctx.force 则 skip + warn
  if (existsSync(hook) && !ctx.force) {
    warn(`pre-push hook already exists at ${hook}; skipping (use --force to overwrite)`);
    return;
  }
  if (existsSync(hook)) log(`overwriting existing pre-push hook at ${hook} (--force)`);
  log(`installing pre-push hook → ${hook}`);
  mkdirSync(dirname(hook), { recursive: true });
  writeFileSync(hook, script);
  chmodSync(hook, 0o755);
}

// ─── memory MCP 修复 ──────────────────────────────────
function installMemoryMcp(ctx) {
  const mcpConfig = makePaths(ctx).MCP_JSON;
  const memDir = join(ctx.home, '.claude', 'memory');
  const memFile = join(memDir, 'memory.jsonl');
  mkdirSync(memDir, { recursive: true });

  let already = false;
  if (existsSync(mcpConfig)) {
    try {
      const d = JSON.parse(readFileSync(mcpConfig, 'utf8'));
      const cur = d?.mcpServers?.memory?.env?.MEMORY_FILE_PATH;
      if (cur === memFile) already = true;
    } catch {}
  }
  if (already) { log(`memory MCP already configured: ${memFile}`); return; }

  if (ctx.dryRun) { log(`[dry-run] would patch ${mcpConfig}`); return; }
  const memBak = backupOnce(mcpConfig);
  if (memBak) log(`backup: ${memBak}`);

  let d = {};
  try { d = JSON.parse(readFileSync(mcpConfig, 'utf8')); } catch {}
  const servers = d.mcpServers ?? {};
  const mem = servers.memory ?? {};
  mem.command ??= 'npx';
  mem.args ??= ['-y', '@modelcontextprotocol/server-memory'];
  mem.env = mem.env ?? {};
  mem.env.MEMORY_FILE_PATH = memFile;
  servers.memory = mem;
  d.mcpServers = servers;
  atomicWriteJSON(mcpConfig, d, { mode: 0o600 });
  log(`memory MCP configured: MEMORY_FILE_PATH=${memFile}`);
  warn(`restart Claude Code to activate new config`);
}

// ─── coding-bridge JSON（合并到 ~/.claude.json.mcpServers） ──
function installCodingBridgeJson(ctx) {
  const p = makePaths(ctx);
  if (!existsSync(p.CLAUDE_JSON)) {
    warn(`${p.CLAUDE_JSON} not found; skip (run Claude Code once to bootstrap, then rerun)`);
    return;
  }

  let d;
  try { d = JSON.parse(readFileSync(p.CLAUDE_JSON, 'utf8')); }
  catch (e) { warn(`invalid ${p.CLAUDE_JSON}: ${e.message}; skip`); return; }

  // 拆开判断：coding-bridge / kimi 两个独立检查；已存在的跳过，缺失的补齐
  const servers = d.mcpServers ?? {};
  const hasCb = servers['coding-bridge']?.command === 'uvx';
  const hasKimi = servers['kimi']?.command === 'uvx';
  if (hasCb && hasKimi) {
    log(`coding-bridge + kimi: already in ${p.CLAUDE_JSON} mcpServers`);
    return;
  }
  if (ctx.dryRun) {
    if (!hasCb) log(`[dry-run] would add coding-bridge to ${p.CLAUDE_JSON} mcpServers`);
    if (!hasKimi) log(`[dry-run] would add kimi fallback to ${p.CLAUDE_JSON} mcpServers`);
    return;
  }

  const cjBak = backupOnce(p.CLAUDE_JSON); if (cjBak) log(`backup: ${cjBak}`);
  if (!hasCb) {
    servers['coding-bridge'] = {
      command: 'uvx',
      args: ['--from', 'git+https://github.com/htmambo/coding-bridge-mcp.git', 'coding-bridge-mcp'],
      transport: 'stdio',
      timeout: 600000, // 客户端层（ms）：Claude Code 等工具返回；须 ≤ 服务端层
      env: {
        PROVIDER: 'xfyun-coding',
        API_KEY: '${CODING_BRIDGE_API_KEY}',
        SPARK_API_KEY: '${SPARK_API_KEY}',
        ARK_API_KEY: '${ARK_API_KEY}',
        MCP_TIMEOUT_SECONDS: '600', // 服务端层（s）：coding-bridge→上游 LLM httpx；默认 300 高负载易被打断
      },
    };
  }
  if (!hasKimi) {
    // fallback：CLAUDE.md §"Hard-coded fallback" 规定 coding-bridge 失败时换 kimi
    // （kimi 是 MCP server，不是 provider 配置；读 ~/.claude/kimi.json 是 Claude Code
    // 切到 kimi 后端的 settings，与本仓库无关）
    servers['kimi'] = {
      command: 'uvx',
      args: ['--from', 'git+https://github.com/htmambo/kimimcp.git', 'kimimcp'],
      transport: 'stdio',
    };
  }
  d.mcpServers = servers;
  atomicWriteJSON(p.CLAUDE_JSON, d, { mode: 0o600 });
  const added = [!hasCb && 'coding-bridge', !hasKimi && 'kimi'].filter(Boolean);
  log(`added ${added.join(' + ')} to ${p.CLAUDE_JSON} mcpServers`);
}

// ─── coding-bridge allow（合并到 settings.json.permissions.allow） ──
function installCodingBridgeAllow(ctx) {
  const p = makePaths(ctx);
  if (!existsSync(p.SETTINGS_JSON)) {
    warn(`${p.SETTINGS_JSON} not found; skip allowlist`);
    return;
  }
  let d;
  try { d = JSON.parse(readFileSync(p.SETTINGS_JSON, 'utf8')); }
  catch (e) { warn(`invalid ${p.SETTINGS_JSON}: ${e.message}; skip`); return; }

  const need = [
    'mcp__coding-bridge__review_code',
    'mcp__coding-bridge__review_plan',
    'mcp__kimi__kimi',  // CLAUDE.md fallback 链：coding-bridge → kimi
  ];
  const perms = d.permissions ?? {};
  const allow = perms.allow ?? [];
  const added = need.filter(t => !allow.includes(t));
  if (added.length === 0) { log(`coding-bridge + kimi allowlist: already present; no change`); return; }
  if (ctx.dryRun) { log(`[dry-run] would add ${added.join(', ')} to ${p.SETTINGS_JSON} permissions.allow`); return; }

  const sBak = backupOnce(p.SETTINGS_JSON); if (sBak) log(`backup: ${sBak}`);
  allow.push(...added);
  perms.allow = allow;
  d.permissions = perms;
  atomicWriteJSON(p.SETTINGS_JSON, d, { mode: 0o600 });
  log(`added ${added.length} entry: ${added.join(', ')}`);
}

// ─── kimi CLI 检测（kimimcp 子依赖） ──────────────────
function findKimiCli(ctx) {
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(':')) {
    if (dir && existsSync(join(dir, 'kimi'))) return join(dir, 'kimi');
  }
  for (const cand of [
    join(ctx.home, '.local', 'bin', 'kimi'),
    join(ctx.home, '.cargo', 'bin', 'kimi'),
    '/usr/local/bin/kimi',
  ]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

function getKimiVersion(ctx) {
  const path = findKimiCli(ctx);
  if (!path) return null;
  // kimi --version 输出格式：'kimi 0.17.0' 或 'kimi version 0.17.0'
  // 用 spawnSync 不开 shell（避免 DEP0190）
  const r = spawnSync(path, ['--version'], { encoding: 'utf8' });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const m = out.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function compareSemver(a, b) {
  // a >= b → true；不支持 pre-release / build metadata
  const [aMaj, aMin, aPat] = a.split('.').map(Number);
  const [bMaj, bMin, bPat] = b.split('.').map(Number);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat >= bPat;
}

// ─── coding-bridge + kimi mcp verify ──────────────────
function installCodingBridgeMcp(ctx) {
  const p = makePaths(ctx);
  let ok = true;

  // 1. ~/.claude.json.mcpServers.coding-bridge + kimi
  let cbOk = false, kimiOk = false;
  if (existsSync(p.CLAUDE_JSON)) {
    try {
      const d = JSON.parse(readFileSync(p.CLAUDE_JSON, 'utf8'));
      const s = d?.mcpServers ?? {};
      cbOk = s['coding-bridge']?.command === 'uvx';
      kimiOk = s['kimi']?.command === 'uvx';
    } catch {}
  }
  if (cbOk) log(`coding-bridge MCP: uvx entry in ${p.CLAUDE_JSON} (claude mcp list 可见)`);
  else { warn(`coding-bridge MCP: NOT in ${p.CLAUDE_JSON} mcpServers (run ./install.sh install-coding-bridge-json)`); ok = false; }
  if (kimiOk) log(`kimi fallback MCP: uvx entry in ${p.CLAUDE_JSON} (CLAUDE.md fallback 链 ready)`);
  else { warn(`kimi fallback MCP: NOT in ${p.CLAUDE_JSON} mcpServers (fallback chain breaks)`); ok = false; }

  // 2. uvx（用 PATH 探测 + 常见安装位置；不调 shell 子进程避免 DEP0190）
  const uvxFound = ['uvx'].some(name => {
    const pathEnv = process.env.PATH ?? '';
    for (const dir of pathEnv.split(':')) {
      if (dir && existsSync(join(dir, name))) return true;
    }
    const homeBin = join(ctx.home, '.local', 'bin', name);
    return existsSync(homeBin);
  });
  if (uvxFound) log(`uvx: installed`);
  else { warn(`uvx NOT installed; install with: curl -LsSf https://astral.sh/uv/install.sh | sh`); ok = false; }

  // 3. kimi CLI 预检查（kimimcp 子依赖；README §0 要求 kimi ≥ v0.16.0，本仓库更严到 v0.17.0）
  const kimiCli = findKimiCli(ctx);
  if (!kimiCli) {
    warn(`kimi CLI NOT installed; kimimcp 启动需要 kimi 作为子进程。安装: https://www.kimi.com/code/docs/kimi-code-cli/guides/getting-started.html`);
    ok = false;
  } else {
    const ver = getKimiVersion(ctx);
    const KIMI_MIN = '0.17.0';
    if (!ver) {
      warn(`kimi CLI found at ${kimiCli} but version parse failed; manual: kimi --version`);
    } else if (!compareSemver(ver, KIMI_MIN)) {
      warn(`kimi CLI ${ver} < ${KIMI_MIN} (kimimcp 要求 ≥ ${KIMI_MIN}); fallback 链可能 fail`);
      ok = false;
    } else {
      log(`kimi CLI: ${ver} ≥ ${KIMI_MIN} (${kimiCli})`);
    }
  }

  // 4. env（仅 coding-bridge 需要；kimi 读 ~/.claude/kimi.json 的 provider 配置）
  // 新版：coding-bridge-mcp 内部按 provider 优先级匹配 key
  // (API_KEY → SPARK_API_KEY / ARK_API_KEY)，所以三个 key 独立可设
  const spark = process.env.SPARK_API_KEY || process.env.CODING_BRIDGE_API_KEY;
  const ark = process.env.ARK_API_KEY || process.env.CODING_BRIDGE_API_KEY;
  if (spark || ark) {
    const provider = process.env.CODING_BRIDGE_PROVIDER || 'xfyun-coding';
    log(`coding-bridge env: PROVIDER=${provider}; spark=${spark ? 'set' : 'unset'}; ark=${ark ? 'set' : 'unset'}`);
  } else { warn(`coding-bridge KEY NOT set (SPARK_API_KEY / ARK_API_KEY / CODING_BRIDGE_API_KEY 任一); export it in ~/.zshrc`); ok = false; }

  // 4. settings.json allowlist（含 coding-bridge + kimi）
  installCodingBridgeAllow(ctx);

  if (ok) log(`coding-bridge + kimi fallback: ready (restart Claude Code to activate)`);
  else warn(`coding-bridge fallback chain not fully wired; see warnings above`);
  return ok;
}

// ─── install-statusline ──────────────────────────────
function installStatusline(ctx) {
  const base = join(ctx.repo, 'global', 'json', 'statusline.base.json');
  const target = makePaths(ctx).SETTINGS_JSON;
  if (!existsSync(base)) fatal(`missing base: ${base}`);
  log(`merging statusLine into ${target}`);
  if (ctx.dryRun) { log(`[dry-run] would merge: ${readFileSync(base, 'utf8').trim()}`); return; }
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && !lstatSync(target).isSymbolicLink()) { const stBak = backupOnce(target); if (stBak) log(`backup: ${stBak}`); }
  let tgt = {};
  try { tgt = JSON.parse(readFileSync(target, 'utf8')); }
  catch (e) { fatal(`invalid JSON in ${target}: ${e.message}`); }
  const baseCfg = JSON.parse(readFileSync(base, 'utf8'));
  tgt.statusLine = { ...(tgt.statusLine ?? {}), ...(baseCfg.statusLine ?? {}) };
  atomicWriteJSON(target, tgt, { mode: 0o600 });
  log(`statusLine merged`);
}

// ─── ccstatusline-zh 安装 + 配置写入 ──────────────────
// npm i -g 全局装包,配置 symlink 到仓库 base (和 CLAUDE.md 等一致)。
// 已存在 settings.json(非 symlink) → backupOnce 后写入;已 symlink → skip。
function ensureCcstatuslineInstalled(ctx) {
  // 探测策略: PATH + 常见全局 bin 目录里直接查 `ccstatusline-zh` 二进制。
  // 不用 `npx --no-install`(全局已装但 npx 缓存缺失会误报),也不用 `--version`
  // 退出码(部分版本无此 flag,会读 stdin 而非 0 退出)。
  const pathEnv = process.env.PATH ?? '';
  const CANDIDATES = [
    ...pathEnv.split(':').map(d => d && join(d, 'ccstatusline-zh')).filter(Boolean),
    '/usr/local/bin/ccstatusline-zh',
    join(ctx.home, '.local', 'bin', 'ccstatusline-zh'),
  ];
  const found = CANDIDATES.find(p => existsSync(p));

  if (found) {
    log(`ccstatusline-zh: installed (${found})`);
    return;
  }

  log(`ccstatusline-zh not found; running: npm i -g ccstatusline-zh`);
  if (ctx.dryRun) { log(`[dry-run] would run: npm install -g ccstatusline-zh`); return; }

  const r = spawnSync('npm', ['install', '-g', 'ccstatusline-zh'], {
    encoding: 'utf8', stdio: 'inherit',
  });
  if (r.status !== 0) {
    fatal(`ccstatusline-zh install failed (npm exit ${r.status}); try manually: npm i -g ccstatusline-zh`);
  }
  log(`ccstatusline-zh: installed via npm i -g`);
}

function installCcstatusline(ctx) {
  ensureCcstatuslineInstalled(ctx);
  // 配置文件路径固定 ~/.config/ccstatusline/settings.json,与上游一致
  const src = join(ctx.repo, 'global', 'json', 'ccstatusline.base.json');
  const dst = join(ctx.home, '.config', 'ccstatusline', 'settings.json');
  if (!existsSync(src)) fatal(`missing base: ${src}`);
  installLinkOrCopy(src, dst, ctx);
}

// ─── doctor ───────────────────────────────────────────
function doctor(ctx) {
  const py = spawnSync('python3', [join(ctx.repo, 'tools', 'scan-secrets.py'), ctx.repo], { encoding: 'utf8' });
  process.stdout.write(py.stdout);
  process.stderr.write(py.stderr);
  if (py.status !== 0) fatal(`doctor: secret pattern(s) detected`);
  log(`doctor: clean`);
}

// ─── check ────────────────────────────────────────────
function check(ctx) {
  const p = makePaths(ctx);
  let bad = 0;
  for (const [, dstRel] of MAP) {
    const dst = join(p.TARGET_HOME, dstRel);
    const homeRel = relative(ctx.home, dst);
    if (!existsSync(dst)) { warn(`missing: ${homeRel}`); bad = 1; continue; }
    let isLink = false;
    try { isLink = lstatSync(dst).isSymbolicLink(); } catch {}
    if (isLink) {
      const t = readlinkSync(dst);
      if (!existsSync(t)) { warn(`broken: ${homeRel} → ${t}`); bad = 1; }
      else log(`ok: ${homeRel}`);
    } else log(`ok (real): ${homeRel}`);
  }
  for (const h of discoverHooks(ctx.repo)) {
    const dst = join(p.HOOKS_DIR_TARGET, h);
    if (!existsSync(dst)) { warn(`missing hook: ${h}`); bad = 1; continue; }
    let isLink = false;
    try { isLink = lstatSync(dst).isSymbolicLink(); } catch {}
    if (isLink && !existsSync(readlinkSync(dst))) { warn(`broken hook: ${h}`); bad = 1; continue; }
    log(`ok hook: ${h}`);
  }
  if (bad) process.exit(1);
}

// ─── uninstall ───────────────────────────────────────
function uninstall(ctx) {
  const p = makePaths(ctx);
  log(`uninstall — restoring from latest backup`);
  if (existsSync(p.BACKUP_ROOT)) {
    const snaps = readdirSync(p.BACKUP_ROOT)
      .filter(d => { try { return statSync(join(p.BACKUP_ROOT, d)).isDirectory(); } catch { return false; } })
      .sort()
      .reverse();
    if (snaps.length > 0 && !ctx.dryRun) {
      const latest = join(p.BACKUP_ROOT, snaps[0]);
      log(`restoring from ${latest}`);
      spawnSync('cp', ['-a', `${latest}/.`, `${p.TARGET_HOME}/`]);
    }
  }
  for (const [, dstRel] of MAP) {
    const dst = join(p.TARGET_HOME, dstRel);
    try {
      if (lstatSync(dst).isSymbolicLink()) {
        log(`unlink: ${relative(ctx.home, dst)}`);
        if (!ctx.dryRun) unlinkSync(dst);
      }
    } catch {}
  }
  for (const h of discoverHooks(ctx.repo)) {
    const dst = join(p.HOOKS_DIR_TARGET, h);
    try {
      if (lstatSync(dst).isSymbolicLink()) {
        log(`unlink: hooks/${h}`);
        if (!ctx.dryRun) unlinkSync(dst);
      }
    } catch {}
  }
  const marker = join(ctx.home, '.claude', '.dotclaude-portable.version');
  if (existsSync(marker)) {
    log(`removing version marker`);
    if (!ctx.dryRun) rmSync(marker);
  }
  stripShellProfile(ctx);
  log(`done`);
}

// ─── rollback ────────────────────────────────────────
function rollback(ctx) {
  const p = makePaths(ctx);
  if (!existsSync(p.BACKUP_ROOT)) fatal(`no backups at ${p.BACKUP_ROOT}`);
  const snaps = readdirSync(p.BACKUP_ROOT)
    .filter(d => { try { return statSync(join(p.BACKUP_ROOT, d)).isDirectory(); } catch { return false; } })
    .sort()
    .reverse();
  const snap = snaps[ctx.rollbackN - 1];
  if (!snap) fatal(`no backup at slot #${ctx.rollbackN}`);
  log(`rolling back to ${snap}`);
  if (!ctx.dryRun) spawnSync('cp', ['-a', `${join(p.BACKUP_ROOT, snap)}/.`, `${p.TARGET_HOME}/`]);
  log(`done`);
}

// ─── install 主流程 ───────────────────────────────────
function install(ctx) {
  const p = makePaths(ctx);
  mkdirSync(p.TARGET_HOME, { recursive: true });
  const marker = join(ctx.home, '.claude', '.dotclaude-portable.version');
  if (!existsSync(marker)) backupExisting(ctx);
  else log(`already managed; skipping full backup`);
  for (const [src, dst, kind] of MAP) {
    renderInstall(join(ctx.repo, src), join(p.TARGET_HOME, dst), kind, ctx);
  }
  deployHooks(ctx);
  writeVersionFile(ctx);
  injectShellProfile(ctx);
  installPreSyncDocsHook(ctx);
  installPrePush(ctx);
  installCodingBridgeJson(ctx);
  const cbReady = installCodingBridgeMcp(ctx);
  installCcstatusline(ctx);
  log(`done. managed: ${p.TARGET_HOME}`);
  if (!cbReady && !ctx.dryRun) {
    warn(`coding-bridge fallback chain not fully wired; recommend: ./install.sh doctor`);
  }
}

// ─── arg 解析 ─────────────────────────────────────────
function printHelp() {
  console.log(`# install.sh — 一键把仓库内配置同步到 ~/.claude/
# 默认 symlink 模式（git pull 即生效）。
# 用法:
#   ./install.sh                 # 安装
#   ./install.sh --dry-run       # 只打印动作
#   ./install.sh --force         # 强制覆盖
#   ./install.sh --copy          # 拷贝模式（Windows 兜底）
#   ./install.sh --uninstall
#   ./install.sh doctor          # secret 扫描
#   ./install.sh --check         # symlink 健康巡检
#   ./install.sh --rollback N    # 回滚到第 N 个备份
#   ./install.sh install-pre-push  # 在 .git/hooks/pre-push 安装 secret 拦截
#   ./install.sh install-pre-sync-docs-hook  # 在 .git/hooks/pre-commit 安装 sync-docs 检查(跨机器必备)
#   ./install.sh install-memory-mcp  # 修复 MCP memory server 持久化路径
#   ./install.sh install-coding-bridge-mcp  # 验证 coding-bridge MCP（外部 review）
#   ./install.sh install-coding-bridge-allow # 合并 coding-bridge allow 到 settings.json
#   ./install.sh install-coding-bridge-json  # 写 coding-bridge MCP 定义到 ~/.claude.json
#   ./install.sh install-ccstatusline  # 装 ccstatusline-zh 并 symlink 配置到 ~/.config/ccstatusline/`);
}

function parseArgs(argv) {
  const positionals = [];
  const opts = { mode: 'symlink', dryRun: false, force: false, rollbackN: 1 };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--mode': opts.mode = argv[++i]; break;
      case '--repo': opts.repo = argv[++i]; break;
      case '--home': opts.home = argv[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--force': opts.force = true; break;
      case '--copy': opts.mode = 'copy'; break;
      case '--uninstall': positionals.push('uninstall'); break;
      case 'doctor': positionals.push('doctor'); break;
      case '--check': positionals.push('check'); break;
      case '--rollback':
        opts.rollbackN = Number(argv[++i] || 1);
        positionals.push('rollback'); break;
      case 'install-pre-push': positionals.push('install-pre-push'); break;
      case 'install-pre-sync-docs-hook': positionals.push('install-pre-sync-docs-hook'); break;
      case 'install-statusline': positionals.push('install-statusline'); break;
      case 'install-memory-mcp': positionals.push('install-memory-mcp'); break;
      case 'install-coding-bridge-mcp': positionals.push('install-coding-bridge-mcp'); break;
      case 'install-coding-bridge-allow': positionals.push('install-coding-bridge-allow'); break;
      case 'install-coding-bridge-json': positionals.push('install-coding-bridge-json'); break;
      case 'install-ccstatusline': positionals.push('install-ccstatusline'); break;
      case '-h':
      case '--help':
        positionals.push('help'); break;
      default:
        if (a.startsWith('-')) {
          err(`unknown arg: ${a}`);
          process.exit(2);
        }
        positionals.push(a);
    }
  }

  return {
    action: positionals[0] ?? 'install',
    ...opts,
  };
}

// ─── main ─────────────────────────────────────────────
async function main() {
  const raw = parseArgs(process.argv.slice(2));
  const ctx = {
    action: raw.action,
    mode: raw.mode,
    repo: raw.repo,
    home: raw.home,
    dryRun: raw.dryRun,
    force: raw.force,
    rollbackN: raw.rollbackN,
  };

  const handlers = {
    help: () => printHelp(),
    install: () => install(ctx),
    uninstall: () => uninstall(ctx),
    doctor: () => doctor(ctx),
    check: () => check(ctx),
    rollback: () => rollback(ctx),
    'install-pre-push': () => installPrePush(ctx),
    'install-pre-sync-docs-hook': () => installPreSyncDocsHook(ctx),
    'install-statusline': () => installStatusline(ctx),
    'install-memory-mcp': () => installMemoryMcp(ctx),
    'install-coding-bridge-mcp': () => installCodingBridgeMcp(ctx),
    'install-coding-bridge-allow': () => installCodingBridgeAllow(ctx),
    'install-coding-bridge-json': () => installCodingBridgeJson(ctx),
    'install-ccstatusline': () => installCcstatusline(ctx),
  };

  const fn = handlers[ctx.action];
  if (!fn) { err(`unknown action: ${ctx.action}`); process.exit(2); }
  fn();
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });