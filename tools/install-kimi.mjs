#!/usr/bin/env node
// tools/install-kimi.mjs — install-kimi.sh 的 Node.js 核心实现
// 把仓库内"机器无关"配置同步到 Kimi Code CLI 的数据目录
// （默认 ~/.kimi-code/，可用 KIMI_CODE_HOME 重定位）。
// 与 install.mjs（Claude Code）平行实现，idiom 保持一致。
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
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { backupOnce, pruneFileBackups } from './lib/backup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DEFAULT = join(__dirname, '..');

// ─── 日志 ──────────────────────────────────────────────
function log(msg) { console.log(`[install-kimi] ${msg}`); }
function warn(msg) { console.warn(`[install-kimi][warn] ${msg}`); }
function err(msg) { console.error(`[install-kimi][err] ${msg}`); }
function fatal(msg) { err(msg); process.exit(1); }

// ─── 路径常量 ──────────────────────────────────────────
// Kimi Code 数据根：KIMI_CODE_HOME 优先，默认 ~/.kimi-code
function kimiHome(ctx) {
  return process.env.KIMI_CODE_HOME || join(ctx.home, '.kimi-code');
}

function makePaths(ctx) {
  const root = kimiHome(ctx);
  return {
    ROOT: root,
    CONFIG_TOML: join(root, 'config.toml'),
    MCP_JSON: join(root, 'mcp.json'),
    HOOKS_DIR: join(root, 'hooks'),
    MARKER: join(root, '.dotclaude-portable-kimi.version'),
  };
}

// ─── 原子写 ────────────────────────────────────────────
function atomicWriteFile(file, content, { mode = 0o644 } = {}) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, file);
  try { chmodSync(file, mode); } catch {}
}

function atomicWriteJSON(file, data, opts) {
  atomicWriteFile(file, JSON.stringify(data, null, 2) + '\n', opts);
}

// ─── ${VAR} 占位符渲染（与 install.mjs 行为一致）─────────
function renderTemplate(text, env = process.env) {
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

// symlink 目标必须在仓库内才允许 unlink（防止误删用户指向别处的 symlink）
function linkPointsIntoRepo(dst, ctx) {
  let t;
  try { t = readlinkSync(dst); } catch { return false; }
  const abs = isAbsolute(t) ? t : join(dirname(dst), t);
  const repoPrefix = ctx.repo.endsWith(sep) ? ctx.repo : ctx.repo + sep;
  return abs === ctx.repo || abs.startsWith(repoPrefix);
}

// ─── symlink / copy 安装 ───────────────────────────────
function installLinkOrCopy(src, dst, ctx) {
  if (!existsSync(src)) fatal(`源文件缺失: ${src}`);
  mkdirSync(dirname(dst), { recursive: true });

  let existing = null;
  try { existing = lstatSync(dst); } catch {}

  if (existing?.isSymbolicLink()) {
    const cur = readlinkSync(dst);
    if (cur === src) {
      log(`跳过（已链接）: ${dst}`);
      return;
    }
    warn(`已存在 symlink → ${cur}`);
    if (!ctx.force) fatal(`请用 --force 覆盖`);
    if (!ctx.dryRun) unlinkSync(dst);
  } else if (existing) {
    if (!ctx.force) warn(`已存在: ${dst}（将备份后覆盖）`);
    if (!ctx.dryRun) {
      const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      renameSync(dst, `${dst}.bak.${ts}`);
      pruneFileBackups(dst);
    }
  }

  if (ctx.dryRun) {
    log(`${ctx.mode}: ${dst} → ${relative(ctx.repo, src)}`);
    return;
  }
  if (ctx.mode === 'symlink') {
    symlinkSync(src, dst);
    log(`链接: ${dst} → ${relative(ctx.repo, src)}`);
    return;
  }
  copyFileSync(src, dst);
  log(`拷贝: ${dst}`);
  try {
    const srcStat = statSync(src);
    if (srcStat.mode & 0o111) chmodSync(dst, 0o755);
  } catch (e) {
    warn(`chmod 跳过 ${dst}: ${e.message}`);
  }
}

// ─── 同步内容映射 ──────────────────────────────────────
// Kimi Code 概念映射：
//   ~/.claude/CLAUDE.md          → AGENTS.md（全局指令）
//   ~/.claude/skills/<n>/SKILL.md → skills/<n>/SKILL.md（目录形式 skill，格式兼容）
//   ~/.claude/commands/*.md      → skills/*.md（扁平形式 skill，/skill:<名字> 调用；--with-commands 才装）
//   ~/.claude/hooks/*            → hooks/（脚本本体；注册走 config.toml [[hooks]]）
const MAP = [
  ['global/CLAUDE.md', 'AGENTS.md'],
  ['skills/fullauto/SKILL.md', 'skills/fullauto/SKILL.md'],
];

// Claude 的 hook 注册在 settings.json；Kimi 注册在 config.toml 的 [[hooks]]。
// 事件名一致（PreToolUse/PostToolUse/UserPromptSubmit），matcher 是正则。
const HOOK_TOML = {
  'guard-read-size.mjs': { event: 'PreToolUse', matcher: 'Read' },
  'review-watchdog.mjs': { event: 'PostToolUse', matcher: 'Write|Edit' },
  'warn-context.mjs': { event: 'UserPromptSubmit' },
};

// nudge-review.sh 是 git commit-msg hook，与 Kimi 运行时无关，不部署
const HOOK_SKIP = new Set(['nudge-review.sh']);

function discoverHooks(repoRoot) {
  const dir = join(repoRoot, 'hooks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /\.(mjs|sh)$/.test(f) && !HOOK_SKIP.has(f))
    .sort();
}

function deployHooks(ctx) {
  const files = discoverHooks(ctx.repo);
  const p = makePaths(ctx);
  for (const h of files) {
    installLinkOrCopy(join(ctx.repo, 'hooks', h), join(p.HOOKS_DIR, h), ctx);
    if (!HOOK_TOML[h]) warn(`hook ${h}: 无 [[hooks]] 注册映射，仅部署文件`);
  }
}

// ─── config.toml 托管块（[[hooks]] + [[permission.rules]]） ──
// 幂等：块标记内整体替换；卸载按块剥离。只追加表（array-of-tables），
// 不写顶层标量，因此块放在文件任何位置（含 EOF）都是合法 TOML。
const BLOCK_START = '# >>> dotclaude-portable-kimi start >>>';
const BLOCK_END = '# <<< dotclaude-portable-kimi end <<<';

function tomlStr(s) { return JSON.stringify(s); } // 基本字符串：引号/反斜杠转义规则一致

function buildConfigBlock(ctx) {
  const p = makePaths(ctx);
  const lines = [BLOCK_START, '# 由 install-kimi.sh 托管；手工改动会在下次 install 时被覆盖'];
  for (const h of discoverHooks(ctx.repo)) {
    const spec = HOOK_TOML[h];
    if (!spec) continue;
    const cmd = `node "${join(p.HOOKS_DIR, h)}"`;
    lines.push('', '[[hooks]]', `event = ${tomlStr(spec.event)}`);
    if (spec.matcher) lines.push(`matcher = ${tomlStr(spec.matcher)}`);
    lines.push(`command = ${tomlStr(cmd)}`);
  }
  // coding-bridge MCP 工具放行（对应 Claude settings.json 的 permissions.allow）
  lines.push(
    '', '[[permission.rules]]',
    'decision = "allow"',
    'pattern = "mcp__coding-bridge__*"',
    BLOCK_END,
  );
  return lines.join('\n') + '\n';
}

function upsertConfigBlock(ctx) {
  const p = makePaths(ctx);
  const block = buildConfigBlock(ctx);
  if (ctx.dryRun) { log(`[dry-run] 将更新 ${p.CONFIG_TOML} 中的托管块`); return; }
  mkdirSync(p.ROOT, { recursive: true });
  let txt = existsSync(p.CONFIG_TOML) ? readFileSync(p.CONFIG_TOML, 'utf8') : '';
  const start = txt.indexOf(BLOCK_START);
  const end = txt.indexOf(BLOCK_END);
  if (start >= 0 && end > start) {
    txt = txt.slice(0, start) + block + txt.slice(end + BLOCK_END.length);
  } else {
    if (txt && !txt.endsWith('\n')) txt += '\n';
    if (txt) txt += '\n';
    txt += block;
  }
  if (existsSync(p.CONFIG_TOML)) { const bak = backupOnce(p.CONFIG_TOML); if (bak) log(`备份: ${bak}`); }
  atomicWriteFile(p.CONFIG_TOML, txt, { mode: 0o600 });
  log(`config.toml: 托管块已更新`);
}

function stripConfigBlock(ctx) {
  const p = makePaths(ctx);
  if (!existsSync(p.CONFIG_TOML)) return;
  let txt = readFileSync(p.CONFIG_TOML, 'utf8');
  const start = txt.indexOf(BLOCK_START);
  const end = txt.indexOf(BLOCK_END);
  if (start < 0 || end <= start) return;
  log(`从 ${p.CONFIG_TOML} 剥离托管块`);
  if (ctx.dryRun) return;
  txt = (txt.slice(0, start) + txt.slice(end + BLOCK_END.length)).replace(/\n{3,}/g, '\n\n');
  atomicWriteFile(p.CONFIG_TOML, txt, { mode: 0o600 });
}

// ─── mcp.json 合并 ─────────────────────────────────────
// Kimi 与 Claude 同为 mcpServers 结构；渲染 ${HOME}/${USER} 占位后合并。
// 已存在的同名 server 默认保留，--force 才覆盖。
function installMcpJson(ctx) {
  const p = makePaths(ctx);
  const base = join(ctx.repo, 'global', 'json', 'mcp.base.json');
  if (!existsSync(base)) fatal(`缺少 base 文件: ${base}`);
  let rendered;
  try { rendered = JSON.parse(renderTemplate(readFileSync(base, 'utf8'))); }
  catch (e) { fatal(`mcp.base.json 解析失败: ${e.message}`); }
  const srcServers = rendered.mcpServers ?? {};

  let tgt = {};
  if (existsSync(p.MCP_JSON)) {
    try { tgt = JSON.parse(readFileSync(p.MCP_JSON, 'utf8')); }
    catch (e) { fatal(`${p.MCP_JSON} JSON 解析失败: ${e.message}`); }
  }
  const tgtServers = tgt.mcpServers ?? {};
  const toAdd = Object.keys(srcServers).filter(n => ctx.force || !(n in tgtServers));
  if (toAdd.length === 0) { log(`mcp.json: 所有 server 已存在；无需改动`); return; }
  if (ctx.dryRun) { log(`[dry-run] 将合并到 ${p.MCP_JSON}: ${toAdd.join(', ')}`); return; }

  mkdirSync(p.ROOT, { recursive: true });
  if (existsSync(p.MCP_JSON)) { const bak = backupOnce(p.MCP_JSON); if (bak) log(`备份: ${bak}`); }
  for (const n of toAdd) tgtServers[n] = srcServers[n];
  tgt.mcpServers = tgtServers;
  atomicWriteJSON(p.MCP_JSON, tgt, { mode: 0o600 });
  log(`mcp.json: 已合并 ${toAdd.length} 个 server: ${toAdd.join(', ')}`);
  for (const n of Object.keys(srcServers)) {
    if (!toAdd.includes(n)) log(`mcp.json: 保留已有 ${n}（用 --force 覆盖）`);
  }
}

// ─── version marker ──────────────────────────────────
function writeVersionFile(ctx) {
  const p = makePaths(ctx);
  let ver = '0.0.0';
  const verFile = join(ctx.repo, 'VERSION');
  if (existsSync(verFile)) ver = readFileSync(verFile, 'utf8').trim();
  if (ctx.dryRun) { log(`[dry-run] 将写入 ${p.MARKER}（${ver}）`); return; }
  mkdirSync(p.ROOT, { recursive: true });
  writeFileSync(p.MARKER, `repo=${ctx.repo}\nversion=${ver}\ntarget=kimi-code\ninstalled_at=${new Date().toISOString()}\n`, { mode: 0o600 });
}

// ─── check ────────────────────────────────────────────
function check(ctx) {
  const p = makePaths(ctx);
  let bad = 0;
  const entries = [...MAP];
  if (ctx.withCommands) {
    for (const c of discoverCommands(ctx.repo)) entries.push([join('commands', c), join('skills', c)]);
  }
  for (const [, dstRel] of entries) {
    const dst = join(p.ROOT, dstRel);
    if (!existsSync(dst)) { warn(`缺失: ${dstRel}`); bad = 1; continue; }
    let isLink = false;
    try { isLink = lstatSync(dst).isSymbolicLink(); } catch {}
    if (isLink) {
      const t = readlinkSync(dst);
      if (!existsSync(t)) { warn(`断链: ${dstRel} → ${t}`); bad = 1; }
      else log(`正常: ${dstRel}`);
    } else log(`正常（实体文件）: ${dstRel}`);
  }
  for (const h of discoverHooks(ctx.repo)) {
    const dst = join(p.HOOKS_DIR, h);
    if (!existsSync(dst)) { warn(`缺失 hook: ${h}`); bad = 1; continue; }
    let isLink = false;
    try { isLink = lstatSync(dst).isSymbolicLink(); } catch {}
    if (isLink && !existsSync(readlinkSync(dst))) { warn(`断链 hook: ${h}`); bad = 1; continue; }
    log(`正常 hook: ${h}`);
  }
  // mcp.json：存在、可解析、且包含 base 里全部 server
  if (!existsSync(p.MCP_JSON)) { warn(`缺失: mcp.json`); bad = 1; }
  else {
    let tgtMcp = null;
    try { tgtMcp = JSON.parse(readFileSync(p.MCP_JSON, 'utf8')); }
    catch { warn(`mcp.json 解析失败`); bad = 1; }
    if (tgtMcp) {
      let baseServers = {};
      try {
        const base = join(ctx.repo, 'global', 'json', 'mcp.base.json');
        baseServers = JSON.parse(renderTemplate(readFileSync(base, 'utf8'))).mcpServers ?? {};
      } catch { warn(`mcp.base.json 解析失败`); bad = 1; }
      const tgtServers = tgtMcp.mcpServers ?? {};
      const missing = Object.keys(baseServers).filter(n => !(n in tgtServers));
      if (missing.length > 0) { warn(`mcp.json: 缺少 server: ${missing.join(', ')}`); bad = 1; }
      else log(`正常: mcp.json`);
    }
  }
  if (existsSync(p.CONFIG_TOML)) {
    const txt = readFileSync(p.CONFIG_TOML, 'utf8');
    if (txt.includes(BLOCK_START) && txt.includes(BLOCK_END)) {
      log(`正常: config.toml 托管块`);
      // 托管块内每个 hook command 的引号路径必须存在
      const block = txt.slice(txt.indexOf(BLOCK_START), txt.indexOf(BLOCK_END));
      for (const line of block.split('\n')) {
        if (!line.startsWith('command = ')) continue;
        const segs = [...line.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m => {
          try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
        });
        const last = segs[segs.length - 1] ?? '';
        const inner = [...last.matchAll(/"([^"]*)"/g)].map(m => m[1]);
        const hookPath = inner[inner.length - 1] ?? '';
        if (!hookPath || !existsSync(hookPath)) {
          warn(`config.toml: hook command 路径失效: ${line.trim()}`); bad = 1;
        }
      }
    } else { warn(`config.toml: 托管块缺失`); bad = 1; }
  } else { warn(`缺失: config.toml`); bad = 1; }
  if (bad) process.exit(1);
}

// ─── commands（opt-in，扁平 skill 形式）─────────────────
function discoverCommands(repoRoot) {
  const dir = join(repoRoot, 'commands');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith('.md')).sort();
}

function deployCommands(ctx) {
  const p = makePaths(ctx);
  for (const c of discoverCommands(ctx.repo)) {
    installLinkOrCopy(join(ctx.repo, 'commands', c), join(p.ROOT, 'skills', c), ctx);
  }
  warn(`commands 已作为扁平 skill 安装（/skill:<名字> 调用）；注意其正文面向 Claude（改 .claude/settings.local.json），在 Kimi 下需人工改写`);
}

// ─── uninstall ───────────────────────────────────────
function uninstall(ctx) {
  const p = makePaths(ctx);
  const entries = [...MAP];
  for (const c of discoverCommands(ctx.repo)) entries.push([join('commands', c), join('skills', c)]);
  for (const [, dstRel] of entries) {
    const dst = join(p.ROOT, dstRel);
    try {
      if (lstatSync(dst).isSymbolicLink()) {
        if (!linkPointsIntoRepo(dst, ctx)) { log(`跳过（symlink 指向仓库外）: ${dstRel}`); continue; }
        log(`解除链接: ${dstRel}`);
        if (!ctx.dryRun) unlinkSync(dst);
      }
    } catch {}
  }
  for (const h of discoverHooks(ctx.repo)) {
    const dst = join(p.HOOKS_DIR, h);
    try {
      if (lstatSync(dst).isSymbolicLink()) {
        if (!linkPointsIntoRepo(dst, ctx)) { log(`跳过（symlink 指向仓库外）: hooks/${h}`); continue; }
        log(`解除链接: hooks/${h}`);
        if (!ctx.dryRun) unlinkSync(dst);
      }
    } catch {}
  }
  stripConfigBlock(ctx);
  if (existsSync(p.MARKER)) {
    log(`删除 version marker`);
    if (!ctx.dryRun) rmSync(p.MARKER);
  }
  warn(`mcp.json 中合并的 mcpServers 条目未移除（避免误删手工改动）；如需回滚请用 ${p.MCP_JSON}.bak.* 备份`);
  log(`完成`);
}

// ─── install 主流程 ───────────────────────────────────
function install(ctx) {
  const p = makePaths(ctx);
  mkdirSync(p.ROOT, { recursive: true });
  for (const [src, dst] of MAP) {
    installLinkOrCopy(join(ctx.repo, src), join(p.ROOT, dst), ctx);
  }
  if (ctx.withCommands) deployCommands(ctx);
  deployHooks(ctx);
  upsertConfigBlock(ctx);
  installMcpJson(ctx);
  writeVersionFile(ctx);
  log(`完成。托管目录: ${p.ROOT}`);
  warn(`AGENTS.md 内容源自 global/CLAUDE.md（面向 Claude Code 编写），请审查其中 Claude 专有指令（codex fallback / OMC 等）后再给 Kimi 使用`);
  warn(`hooks 脚本按 Claude payload 编写，Kimi 事件格式一致但未逐一实测，请触发一次验证`);
}

// ─── arg 解析 ─────────────────────────────────────────
function printHelp() {
  console.log(`# install-kimi.sh — 一键把仓库内配置同步到 ~/.kimi-code/（Kimi Code CLI）
# 默认 symlink 模式（git pull 即生效）。数据根可用 KIMI_CODE_HOME 重定位。
# 用法:
#   ./install-kimi.sh                 # 安装
#   ./install-kimi.sh --dry-run       # 只打印动作
#   ./install-kimi.sh --force         # 强制覆盖（含 mcp.json 同名 server）
#   ./install-kimi.sh --copy          # 拷贝模式（Windows 兜底）
#   ./install-kimi.sh --with-commands # 额外把 commands/*.md 装为扁平 skill
#   ./install-kimi.sh --check         # 巡检 symlink / config 托管块
#   ./install-kimi.sh --uninstall     # 摘除 symlink + 剥离 config.toml 托管块
# 同步内容:
#   global/CLAUDE.md            → AGENTS.md（全局指令，内容需人工审查）
#   skills/fullauto/SKILL.md    → skills/fullauto/SKILL.md（格式兼容）
#   hooks/*.mjs                 → hooks/ + config.toml [[hooks]] 注册
#   global/json/mcp.base.json   → 合并进 mcp.json 的 mcpServers
#   coding-bridge 权限          → config.toml [[permission.rules]] allow`);
}

function parseArgs(argv) {
  const positionals = [];
  const opts = { mode: 'symlink', dryRun: false, force: false, withCommands: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--mode': opts.mode = argv[++i]; break;
      case '--repo': opts.repo = argv[++i]; break;
      case '--home': opts.home = argv[++i]; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--force': opts.force = true; break;
      case '--copy': opts.mode = 'copy'; break;
      case '--with-commands': opts.withCommands = true; break;
      case '--uninstall': positionals.push('uninstall'); break;
      case '--check': positionals.push('check'); break;
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
    home: raw.home || homedir(),
    dryRun: raw.dryRun,
    force: raw.force,
    withCommands: raw.withCommands,
  };

  const handlers = {
    help: () => printHelp(),
    install: () => install(ctx),
    check: () => check(ctx),
    uninstall: () => uninstall(ctx),
  };

  const fn = handlers[ctx.action];
  if (!fn) { err(`未知动作: ${ctx.action}`); process.exit(2); }
  await fn();
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
