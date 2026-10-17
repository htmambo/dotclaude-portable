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
  accessSync,
  constants as fsConstants,
} from 'node:fs';
import { dirname, join, basename, relative } from 'node:path';
import { homedir } from 'node:os';
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

// ─── LSP server 安装（manifest 驱动） ─────────────────
// NOTE: 仅 Unix-like 系统（PATH 用 ':' 分隔；依赖 HOME env）。Windows 不在本期范围。

// semver "1.2.3" / "v1.2.3" → [1,2,3]；非法返回 null
function parseSemver(s) {
  const m = String(s).match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (parts.some(n => Number.isNaN(n) || n < 0)) return null;
  return parts;
}
// 比较：a<b → -1; a==b → 0; a>b → 1；任一非法 → null
function compareSemver(a, b) {
  const pa = parseSemver(a), pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}
// PATH 探测（不开 shell，等价 `command -v`，含 +x 权限检查）
function commandExists(cmd) {
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue;
    try { accessSync(join(dir, cmd), fsConstants.X_OK); return true; } catch {}
  }
  try { accessSync(join(process.env.HOME ?? '', '.local', 'bin', cmd), fsConstants.X_OK); return true; } catch {}
  return false;
}
// 从版本命令输出提取 semver；返回 null 表示无法探测
function getVersion(cmd, regexStr) {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', timeout: 10_000 });
  if (r.error) {
    if (r.error.code !== 'ENOENT') warn(`[警告] 版本探测异常: ${r.error.message}`);
    return null;
  }
  if (r.signal === 'SIGTERM') {
    warn(`[警告] 版本探测超时: ${cmd.join(' ')}`);
    return null;
  }
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const m = out.match(new RegExp(regexStr));
  return m ? m[1] : null;
}
function loadLspManifest(repoDir) {
  const p = join(repoDir, 'global', 'json', 'lsp-servers.base.json');
  if (!existsSync(p)) fatal(`缺少 LSP manifest: ${p}`);
  let m;
  try { m = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { fatal(`LSP manifest 解析失败: ${e.message}`); }
  if (!m.servers || typeof m.servers !== 'object') fatal('LSP manifest: 缺少 "servers" 对象');
  return m;
}
function installLspServers(ctx) {
  const manifest = loadLspManifest(ctx.repo);
  const summary = { installed: [], skipped: [], failed: [] };

  for (const [name, spec] of Object.entries(manifest.servers)) {
    // spec 基础校验
    if (!spec || typeof spec !== 'object') {
      warn(`[跳过] ${name}: spec 格式非法`); summary.skipped.push(name); continue;
    }
    if (!Array.isArray(spec.versionCheck) || spec.versionCheck.length === 0) {
      warn(`[跳过] ${name}: 缺少 versionCheck 数组`); summary.skipped.push(name); continue;
    }
    if (!Array.isArray(spec.command) || spec.command.length === 0) {
      warn(`[跳过] ${name}: 缺少 command 数组`); summary.skipped.push(name); continue;
    }

    if (spec.prerequisite && !commandExists(spec.prerequisite)) {
      const url = spec.prerequisiteUrl ? `（${spec.prerequisiteUrl}）` : '';
      warn(`[跳过] ${name}: 需要先装 ${spec.prerequisite}${url}`);
      summary.skipped.push(name);
      continue;
    }

    const cur = getVersion(spec.versionCheck, spec.versionRegex ?? '(\\d+\\.\\d+\\.\\d+)');
    if (cur && !ctx.force) {
      const cmp = compareSemver(cur, spec.minVersion);
      if (cmp === null) {
        warn(`[警告] ${name}: 版本比较失败 (当前=${cur}, 要求=${spec.minVersion})，默认执行安装`);
      } else if (cmp >= 0) {
        log(`[跳过] ${name}: v${cur} ≥ ${spec.minVersion}`);
        summary.skipped.push(name);
        continue;
      }
    }

    if (ctx.dryRun) {
      log(`[dry-run] ${name}: ${spec.command.join(' ')}`);
      summary.skipped.push(name);
      continue;
    }

    log(`[install] ${name}: ${spec.command.join(' ')}`);
    // stderr → pipe（捕获用于 EACCES 诊断）；stdout → inherit（实时显示进度）
    const r = spawnSync(spec.command[0], spec.command.slice(1), {
      encoding: 'utf8',
      stdio: ['inherit', 'inherit', 'pipe'],
      timeout: 180_000,
    });
    if (r.status === 0) {
      log(`[已安装] ${name}`);
      summary.installed.push(name);
    } else {
      const stderrText = r.stderr ?? '';
      const isEacces = /EACCES|permission denied/i.test(stderrText);
      const reason = r.error
        ? `错误: ${r.error.code ?? r.error.message}`
        : r.signal
          ? `被 ${r.signal} 终止（可能超时）`
          : `退出码 ${r.status}`;
      if (isEacces && spec.tool === 'npm') {
        warn(`[失败] ${name}: ${reason} — 需要 sudo 或配置 npm prefix（参考 https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally）`);
      } else {
        warn(`[失败] ${name}: ${reason}`);
      }
      summary.failed.push(name);
    }
  }

  if (summary.failed.length > 0) {
    warn(`LSP server 安装完成，${summary.failed.length} 个失败（已安装=${summary.installed.length} 跳过=${summary.skipped.length}）`);
    return false;
  }
  log(`LSP server 就绪（已安装=${summary.installed.length} 跳过=${summary.skipped.length}）`);
  return true;
}

// ─── symlink / copy 安装 ───────────────────────────────
function installLinkOrCopy(src, dst, ctx) {
  if (!existsSync(src)) fatal(`源文件缺失: ${src}`);
  mkdirSync(dirname(dst), { recursive: true });

  // 已存在的处理
  let existing = null;
  try { existing = lstatSync(dst); } catch {}

  if (existing?.isSymbolicLink()) {
    const cur = readlinkSync(dst);
    if (cur === src) {
      log(`跳过（已链接）: ${relative(ctx.home, dst)}`);
      return;
    }
    warn(`已存在 symlink → ${cur}`);
    if (!ctx.force) fatal(`请用 --force 覆盖`);
    if (!ctx.dryRun) unlinkSync(dst);
  } else if (existing) {
    if (!ctx.force) warn(`已存在: ${relative(ctx.home, dst)}（用 --force 覆盖）`);
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
    log(`链接: ${relative(ctx.home, dst)} → ${relative(ctx.repo, src)}`);
    return;
  }
  copyFileSync(src, dst);
  log(`拷贝: ${relative(ctx.home, dst)}`);
  // 仅当源文件本身有 x 位才设 0o755；避免给 JSON / md 等配置文件加不必要的执行位
  try {
    const srcStat = statSync(src);
    if (srcStat.mode & 0o111) chmodSync(dst, 0o755);
  } catch (e) {
    warn(`chmod 跳过 ${dst}: ${e.message}`);
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
    log(`跳过渲染（已存在）: ${homeRel}`);
    return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  if (kind === 'symlink') {
    installLinkOrCopy(src, dst, ctx);
    return;
  }
  // render
  if (!existsSync(src)) fatal(`源文件缺失: ${src}`);
  const raw = readFileSync(src, 'utf8');
  const out = renderTemplate(raw);
  if (ctx.dryRun) {
    log(`渲染+安装: ${homeRel}`);
    return;
  }
  atomicWriteFile(dst, out, { mode: 0o600 });
  log(`渲染+安装: ${homeRel}`);
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
  log(`已备份现有文件到 ${snap}`);
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
      if (ctx.dryRun) log(`[dry-run] 将清理: ${join(backupRoot, d)}`);
      else {
        log(`清理旧备份: ${join(backupRoot, d)}`);
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
      log(`shell 配置文件已有标记: ${f}`); continue;
    }
    log(`追加到 ${f}`);
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
    log(`从 ${f} 剥离 dotclaude-portable 块`);
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
  if (ctx.dryRun) { log(`[dry-run] 将写入 ${marker}（${ver}）`); return; }
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
# dotclaude-portable pre-commit 钩子
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
    echo '[dotclaude-portable pre-commit] 未找到 node；跳过 sync-docs 检查' >&2
    exit 0
  fi
  REPO_ROOT="\$(cd -- "\$(dirname -- "\${BASH_SOURCE[0]}")/../.." &>/dev/null && pwd)"
  node "\${REPO_ROOT}/scripts/sync-docs.mjs" --check
fi
`;
  if (ctx.dryRun) { log(`[dry-run] 将安装 sync-docs pre-commit hook 到 ${hook}`); return; }
  // 已存在 hook：无 ctx.force 则 skip + warn，避免静默覆盖用户自定义 hook
  if (existsSync(hook) && !ctx.force) {
    warn(`pre-commit hook 已存在于 ${hook}；跳过（用 --force 覆盖）`);
    return;
  }
  if (existsSync(hook)) log(`覆盖已存在的 pre-commit hook ${hook}（--force）`);
  log(`安装 sync-docs pre-commit hook → ${hook}`);
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
python3 "\${REPO_ROOT}/tools/scan-secrets.py" "\${REPO_ROOT}" || { echo '[pre-push] 检测到 secret；中止推送' >&2; exit 1; }
`;
  if (ctx.dryRun) { log(`[dry-run] 将安装 pre-push hook 到 ${hook}`); return; }
  // 已存在 hook：无 ctx.force 则 skip + warn
  if (existsSync(hook) && !ctx.force) {
    warn(`pre-push hook 已存在于 ${hook}；跳过（用 --force 覆盖）`);
    return;
  }
  if (existsSync(hook)) log(`覆盖已存在的 pre-push hook ${hook}（--force）`);
  log(`安装 pre-push hook → ${hook}`);
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
  if (already) { log(`memory MCP 已配置: ${memFile}`); return; }

  if (ctx.dryRun) { log(`[dry-run] 将修改 ${mcpConfig}`); return; }
  const memBak = backupOnce(mcpConfig);
  if (memBak) log(`备份: ${memBak}`);

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
  log(`memory MCP 已配置: MEMORY_FILE_PATH=${memFile}`);
  warn(`重启 Claude Code 以激活新配置`);
}

// ─── coding-bridge JSON（合并到 ~/.claude.json.mcpServers） ──
function installCodingBridgeJson(ctx) {
  const p = makePaths(ctx);
  if (!existsSync(p.CLAUDE_JSON)) {
    warn(`未找到 ${p.CLAUDE_JSON}；跳过（先运行一次 Claude Code 完成初始化，再重跑）`);
    return;
  }

  let d;
  try { d = JSON.parse(readFileSync(p.CLAUDE_JSON, 'utf8')); }
  catch (e) { warn(`${p.CLAUDE_JSON} 解析失败: ${e.message}；跳过`); return; }

  // 已存在的跳过，缺失的补齐
  const servers = d.mcpServers ?? {};
  const hasCb = servers['coding-bridge']?.command === 'uvx';
  if (hasCb) {
    log(`coding-bridge: 已在 ${p.CLAUDE_JSON} 的 mcpServers 中`);
    return;
  }
  if (ctx.dryRun) {
    if (!hasCb) log(`[dry-run] 将添加 coding-bridge 到 ${p.CLAUDE_JSON} 的 mcpServers`);
    return;
  }

  const cjBak = backupOnce(p.CLAUDE_JSON); if (cjBak) log(`备份: ${cjBak}`);
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
  d.mcpServers = servers;
  atomicWriteJSON(p.CLAUDE_JSON, d, { mode: 0o600 });
  const added = [!hasCb && 'coding-bridge'].filter(Boolean);
  log(`已添加 ${added.join(' + ')} 到 ${p.CLAUDE_JSON} 的 mcpServers`);
}

// ─── coding-bridge allow（合并到 settings.json.permissions.allow） ──
function installCodingBridgeAllow(ctx) {
  const p = makePaths(ctx);
  if (!existsSync(p.SETTINGS_JSON)) {
    warn(`未找到 ${p.SETTINGS_JSON}；跳过 allowlist`);
    return;
  }
  let d;
  try { d = JSON.parse(readFileSync(p.SETTINGS_JSON, 'utf8')); }
  catch (e) { warn(`${p.SETTINGS_JSON} 解析失败: ${e.message}；跳过`); return; }

  const need = [
    'mcp__coding-bridge__review_code',
    'mcp__coding-bridge__review_plan',
  ];
  const perms = d.permissions ?? {};
  const allow = perms.allow ?? [];
  const added = need.filter(t => !allow.includes(t));
  if (added.length === 0) { log(`coding-bridge allowlist: 已存在；无需改动`); return; }
  if (ctx.dryRun) { log(`[dry-run] 将添加 ${added.join(', ')} 到 ${p.SETTINGS_JSON} 的 permissions.allow`); return; }

  const sBak = backupOnce(p.SETTINGS_JSON); if (sBak) log(`备份: ${sBak}`);
  allow.push(...added);
  perms.allow = allow;
  d.permissions = perms;
  atomicWriteJSON(p.SETTINGS_JSON, d, { mode: 0o600 });
  log(`已添加 ${added.length} 条: ${added.join(', ')}`);
}

// ─── coding-bridge mcp verify ──────────────────
function installCodingBridgeMcp(ctx) {
  const p = makePaths(ctx);
  let ok = true;

  // 1. ~/.claude.json.mcpServers.coding-bridge
  let cbOk = false;
  if (existsSync(p.CLAUDE_JSON)) {
    try {
      const d = JSON.parse(readFileSync(p.CLAUDE_JSON, 'utf8'));
      const s = d?.mcpServers ?? {};
      cbOk = s['coding-bridge']?.command === 'uvx';
    } catch {}
  }
  if (cbOk) log(`coding-bridge MCP: uvx 条目已在 ${p.CLAUDE_JSON}（claude mcp list 可见）`);
  else { warn(`coding-bridge MCP: 不在 ${p.CLAUDE_JSON} 的 mcpServers 中（运行 ./install.sh install-coding-bridge-json）`); ok = false; }

  // 2. uvx（用 PATH 探测 + 常见安装位置；不调 shell 子进程避免 DEP0190）
  const uvxFound = ['uvx'].some(name => {
    const pathEnv = process.env.PATH ?? '';
    for (const dir of pathEnv.split(':')) {
      if (dir && existsSync(join(dir, name))) return true;
    }
    const homeBin = join(ctx.home, '.local', 'bin', name);
    return existsSync(homeBin);
  });
  if (uvxFound) log(`uvx: 已安装`);
  else { warn(`uvx 未安装；安装命令: curl -LsSf https://astral.sh/uv/install.sh | sh`); ok = false; }

  // 3. env（仅 coding-bridge 需要）
  // 新版：coding-bridge-mcp 内部按 provider 优先级匹配 key
  // (API_KEY → SPARK_API_KEY / ARK_API_KEY)，所以三个 key 独立可设
  const spark = process.env.SPARK_API_KEY || process.env.CODING_BRIDGE_API_KEY;
  const ark = process.env.ARK_API_KEY || process.env.CODING_BRIDGE_API_KEY;
  if (spark || ark) {
    const provider = process.env.CODING_BRIDGE_PROVIDER || 'xfyun-coding';
    log(`coding-bridge env: PROVIDER=${provider}; spark=${spark ? '已设置' : '未设置'}; ark=${ark ? '已设置' : '未设置'}`);
  } else { warn(`coding-bridge KEY 未设置（SPARK_API_KEY / ARK_API_KEY / CODING_BRIDGE_API_KEY 任一）；请在 ~/.zshrc 中 export`); ok = false; }

  // 4. settings.json allowlist（含 coding-bridge）
  installCodingBridgeAllow(ctx);

  if (ok) log(`coding-bridge MCP: 就绪（重启 Claude Code 以激活）`);
  else warn(`coding-bridge MCP 未完全接好；见上方警告`);
  return ok;
}

// ─── install-statusline ──────────────────────────────
function installStatusline(ctx) {
  const base = join(ctx.repo, 'global', 'json', 'statusline.base.json');
  const target = makePaths(ctx).SETTINGS_JSON;
  if (!existsSync(base)) fatal(`缺少 base 文件: ${base}`);
  log(`合并 statusLine 到 ${target}`);
  if (ctx.dryRun) { log(`[dry-run] 将合并: ${readFileSync(base, 'utf8').trim()}`); return; }
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target) && !lstatSync(target).isSymbolicLink()) { const stBak = backupOnce(target); if (stBak) log(`备份: ${stBak}`); }
  let tgt = {};
  try { tgt = JSON.parse(readFileSync(target, 'utf8')); }
  catch (e) { fatal(`${target} JSON 解析失败: ${e.message}`); }
  const baseCfg = JSON.parse(readFileSync(base, 'utf8'));
  tgt.statusLine = { ...(tgt.statusLine ?? {}), ...(baseCfg.statusLine ?? {}) };
  atomicWriteJSON(target, tgt, { mode: 0o600 });
  log(`statusLine 已合并`);
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
    log(`ccstatusline-zh: 已安装（${found}）`);
    return;
  }

  log(`未找到 ccstatusline-zh；执行: npm i -g ccstatusline-zh`);
  if (ctx.dryRun) { log(`[dry-run] 将执行: npm install -g ccstatusline-zh`); return; }

  const r = spawnSync('npm', ['install', '-g', 'ccstatusline-zh'], {
    encoding: 'utf8', stdio: 'inherit',
  });
  if (r.status !== 0) {
    fatal(`ccstatusline-zh 安装失败（npm 退出码 ${r.status}）；请手动执行: npm i -g ccstatusline-zh`);
  }
  log(`ccstatusline-zh: 已通过 npm i -g 安装`);
}

function installCcstatusline(ctx) {
  ensureCcstatuslineInstalled(ctx);
  // 配置文件路径固定 ~/.config/ccstatusline/settings.json,与上游一致
  const src = join(ctx.repo, 'global', 'json', 'ccstatusline.base.json');
  const dst = join(ctx.home, '.config', 'ccstatusline', 'settings.json');
  if (!existsSync(src)) fatal(`缺少 base 文件: ${src}`);
  installLinkOrCopy(src, dst, ctx);
}

// ─── doctor ───────────────────────────────────────────
function doctor(ctx) {
  const py = spawnSync('python3', [join(ctx.repo, 'tools', 'scan-secrets.py'), ctx.repo], { encoding: 'utf8' });
  process.stdout.write(py.stdout);
  process.stderr.write(py.stderr);
  if (py.status !== 0) fatal(`doctor: 检测到 secret 特征`);
  log(`doctor: 检查通过`);
}

// ─── check ────────────────────────────────────────────
function check(ctx) {
  const p = makePaths(ctx);
  let bad = 0;
  for (const [, dstRel] of MAP) {
    const dst = join(p.TARGET_HOME, dstRel);
    const homeRel = relative(ctx.home, dst);
    if (!existsSync(dst)) { warn(`缺失: ${homeRel}`); bad = 1; continue; }
    let isLink = false;
    try { isLink = lstatSync(dst).isSymbolicLink(); } catch {}
    if (isLink) {
      const t = readlinkSync(dst);
      if (!existsSync(t)) { warn(`断链: ${homeRel} → ${t}`); bad = 1; }
      else log(`正常: ${homeRel}`);
    } else log(`正常（实体文件）: ${homeRel}`);
  }
  for (const h of discoverHooks(ctx.repo)) {
    const dst = join(p.HOOKS_DIR_TARGET, h);
    if (!existsSync(dst)) { warn(`缺失 hook: ${h}`); bad = 1; continue; }
    let isLink = false;
    try { isLink = lstatSync(dst).isSymbolicLink(); } catch {}
    if (isLink && !existsSync(readlinkSync(dst))) { warn(`断链 hook: ${h}`); bad = 1; continue; }
    log(`正常 hook: ${h}`);
  }
  if (bad) process.exit(1);
}

// ─── uninstall ───────────────────────────────────────
function uninstall(ctx) {
  const p = makePaths(ctx);
  log(`卸载 — 从最近备份恢复`);
  if (existsSync(p.BACKUP_ROOT)) {
    const snaps = readdirSync(p.BACKUP_ROOT)
      .filter(d => { try { return statSync(join(p.BACKUP_ROOT, d)).isDirectory(); } catch { return false; } })
      .sort()
      .reverse();
    if (snaps.length > 0 && !ctx.dryRun) {
      const latest = join(p.BACKUP_ROOT, snaps[0]);
      log(`从 ${latest} 恢复`);
      spawnSync('cp', ['-a', `${latest}/.`, `${p.TARGET_HOME}/`]);
    }
  }
  for (const [, dstRel] of MAP) {
    const dst = join(p.TARGET_HOME, dstRel);
    try {
      if (lstatSync(dst).isSymbolicLink()) {
        log(`解除链接: ${relative(ctx.home, dst)}`);
        if (!ctx.dryRun) unlinkSync(dst);
      }
    } catch {}
  }
  for (const h of discoverHooks(ctx.repo)) {
    const dst = join(p.HOOKS_DIR_TARGET, h);
    try {
      if (lstatSync(dst).isSymbolicLink()) {
        log(`解除链接: hooks/${h}`);
        if (!ctx.dryRun) unlinkSync(dst);
      }
    } catch {}
  }
  const marker = join(ctx.home, '.claude', '.dotclaude-portable.version');
  if (existsSync(marker)) {
    log(`删除 version marker`);
    if (!ctx.dryRun) rmSync(marker);
  }
  stripShellProfile(ctx);
  log(`完成`);
}

// ─── rollback ────────────────────────────────────────
function rollback(ctx) {
  const p = makePaths(ctx);
  if (!existsSync(p.BACKUP_ROOT)) fatal(`${p.BACKUP_ROOT} 下没有备份`);
  const snaps = readdirSync(p.BACKUP_ROOT)
    .filter(d => { try { return statSync(join(p.BACKUP_ROOT, d)).isDirectory(); } catch { return false; } })
    .sort()
    .reverse();
  const snap = snaps[ctx.rollbackN - 1];
  if (!snap) fatal(`第 #${ctx.rollbackN} 个备份槽位不存在`);
  log(`回滚到 ${snap}`);
  if (!ctx.dryRun) spawnSync('cp', ['-a', `${join(p.BACKUP_ROOT, snap)}/.`, `${p.TARGET_HOME}/`]);
  log(`完成`);
}

// ─── install 主流程 ───────────────────────────────────
function install(ctx) {
  const p = makePaths(ctx);
  mkdirSync(p.TARGET_HOME, { recursive: true });
  const marker = join(ctx.home, '.claude', '.dotclaude-portable.version');
  if (!existsSync(marker)) backupExisting(ctx);
  else log(`已在托管中；跳过全量备份`);
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
  log(`完成。托管目录: ${p.TARGET_HOME}`);
  if (!cbReady && !ctx.dryRun) {
    warn(`coding-bridge fallback 链未完全接好；建议运行: ./install.sh doctor`);
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
#   ./install.sh install-ccstatusline  # 装 ccstatusline-zh 并 symlink 配置到 ~/.config/ccstatusline/
#   ./install.sh install-lsp-servers   # 装 TS/Python/Rust 真实 LSP server 后端（manifest 驱动）`);
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
      case 'install-lsp-servers': positionals.push('install-lsp-servers'); break;
      case '-h':
      case '--help':
        positionals.push('help'); break;
      default:
        if (a.startsWith('-')) {
          err(`未知参数: ${a}`);
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
    repo: raw.repo ?? REPO_DEFAULT,
    home: raw.home ?? homedir(),
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
    'install-lsp-servers': () => installLspServers(ctx),
  };

  const fn = handlers[ctx.action];
  if (!fn) { err(`未知动作: ${ctx.action}`); process.exit(2); }
  // handler 返回 false 表示部分失败（如 install-lsp-servers 有 server 装失败），传导为非零退出码
  const ok = await fn();
  if (ok === false) process.exit(1);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
