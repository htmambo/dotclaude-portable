#!/usr/bin/env node
// tools/configure.mjs — 交互式统一配置向导（v1.0.0）
// 管理范围：
//   1. 外部 Review 供应商：coding-bridge / kimi / codex（切换默认 + API key 写入仓库根 .env）
//   2. Claude Code 主供应商预设：minimax / anyrouter / selfminimax / xunfei / default
//   4. 辅助子模块：memory MCP / pre-push hook / pre-sync-docs hook
//
// 设计目标：
//   - 零外部依赖（纯 node:readline + ANSI）；与 install.mjs 平行存在
//   - 不破坏 install.mjs / uninstall 流程；本脚本只写仓库根 .env + ~/.claude/*.json，不改 ~/.zshrc
//   - 幂等：重复执行不会重复追加 / 覆盖已有 token
//
// 用法：
//   ./tools/configure.mjs                 # 交互式
//   ./tools/configure.mjs --no-color      # 禁色（CI / pipe）
//   ./tools/configure.mjs --dry-run       # 只打印动作
//
// 持久化约定：
//   仓库根 .env   — REVIEW_PROVIDER / CODING_BRIDGE_PROVIDER / SPARK_API_KEY / ARK_API_KEY
//   ~/.claude.json.mcpServers               — 同步 coding-bridge + kimi 段
//   ~/.claude/settings.json.permissions.allow — 同步 review tools allow
'use strict';

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, statSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { backupOnce } from './lib/backup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const HOME = process.env.HOME || '/root';
const CLAUDE_DIR = join(HOME, '.claude');
const CLAUDE_JSON = join(HOME, '.claude.json');
const SETTINGS_JSON = join(CLAUDE_DIR, 'settings.json');
const ENV_FILE = join(REPO_ROOT, '.env');

const NO_COLOR = process.argv.includes('--no-color') || process.env.NO_COLOR != null;
const DRY_RUN = process.argv.includes('--dry-run');

const c = NO_COLOR ? new Proxy({}, { get: () => (s) => s }) : {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

// 剥离字符串中的 ANSI CSI/OSC 转义序列，防止 preset.description 等
// 用户可控字段被注入 \x1b[2J（清屏）/\x1b]0;...\x07（设标题）等终端控制指令。
// 仅处理 CSI（\x1b[）与 OSC（\x1b]）；非完备的 sanitizer，但覆盖 preset 实际场景。
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function out(s) { process.stdout.write(s + '\n'); }
function info(s) { out(c.cyan(`▸ ${s}`)); }
function ok(s) { out(c.green(`  ✓ ${s}`)); }
function warn(s) { out(c.yellow(`  ⚠ ${s}`)); }
function err(s) { out(c.red(`  ✗ ${s}`)); }
function title(s) { out('\n' + c.bold(c.cyan(`━━ ${s} ━━`))); }

// ─── 原子写 ─────────────────────────────────────────────
function atomicWrite(file, content) {
  if (DRY_RUN) { out(c.dim(`[dry-run] would write ${file} (${content.length} bytes)`)); return; }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  // 强制 0600：API KEY 写入 ~/.claude.json 等敏感文件，绝不世界可读
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, file);
  // 兜底：已存在的目标文件，OS 不一定保留 mode（rename 在同分区内可能复用 inode）；
  // 显式 chmod 一次以确保权限收紧。
  try { chmodSync(file, 0o600); } catch {}
}
function atomicWriteJSON(file, data) {
  atomicWrite(file, JSON.stringify(data, null, 2) + '\n');
}
function readJSON(file) {
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
function readText(file) {
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}
// backupOnce 已抽到 ./lib/backup.mjs（参见 import）

// ─── .env 读写（KEY=VAL 形式，幂等覆盖） ─────────────
function parseEnv(text) {
  const map = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || /^\s*#/.test(line)) { map.set(`__raw_${i}`, line); continue; }
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) map.set(m[1], { value: m[2], line: line });
  }
  return { map, lines };
}
function serializeEnv(map) {
  return Array.from(map.values())
    .map(v => (typeof v === 'string' ? v : v.line))
    .join('\n');
}
let _setEnvCounter = 0; // 防 setEnvKey 在同毫秒内连续调用冲突
function setEnvKey(map, key, value) {
  const line = `${key}=${value}`;
  // 1) 同 key 已有条目（值或哨兵）→ 就地更新，避免 map 增长
  for (const [k, v] of map.entries()) {
    if (typeof v === 'object' && v.line && /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(v.line)
        && v.line.match(/^\s*([A-Z_][A-Z0-9_]*)/)?.[1] === key) {
      map.set(k, { value, line }); return true;
    }
  }
  // 2) 收集同 envKey 的旧哨兵 __new_* 条目，循环结束后批量删除（避免 Map iteration + delete 混用）
  const toDelete = [];
  for (const [k, v] of map.entries()) {
    if (typeof v === 'object' && v.line && /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(v.line)) {
      const m = v.line.match(/^\s*([A-Z_][A-Z0-9_]*)/)?.[1];
      if (m === key && k.startsWith('__new_')) toDelete.push(k);
    }
  }
  for (const k of toDelete) map.delete(k);
  // 3) 插入新条目
  map.set(`__new_${Date.now()}_${++_setEnvCounter}_${key}`, { value, line });
  return false;
}
function getEnvKey(map, key) {
  for (const v of map.values()) {
    if (typeof v === 'object' && v.line) {
      const m = v.line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === key) return m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return null;
}
function loadEnv() { return parseEnv(readText(ENV_FILE)); }
function saveEnv(parsed, header) {
  let lines = serializeEnv(parsed.map).split('\n');
  // 移除所有空 __raw_* 哨兵
  lines = lines.filter(l => l !== '');
  const banner = header ? ['', `# ─── dotclaude-portable configure (${new Date().toISOString()}) ───`] : [];
  atomicWrite(ENV_FILE, banner.concat(lines).join('\n') + '\n');
}
function readEnvKey(key) { return getEnvKey(loadEnv().map, key); }

// ─── 交互组件 ─────────────────────────────────────────
// 两种输入模式自动切换：
//   - TTY 模式：raw mode 按键级读取，方向键 / Enter / 数字快捷键 / Esc / q 全支持
//   - 非 TTY 模式：readline 行模式，数字 / 字母命令回车提交
//
// 两种 choose：
//   - chooseHorizontal：横向（← → / Tab 切换），用于顶层 5 项主菜单
//   - chooseVertical：竖向（↑ ↓ 切换），用于子菜单
// 两者共享 keypress 引擎与相同快捷键：1-9 直选 / Enter 确认 / b 返回 / q 退出 / Esc 退出

const IS_TTY = process.stdin.isTTY === true;
const TERM_COLS = (() => {
  if (!IS_TTY) return 80;
  return process.stdout.columns || process.env.COLUMNS || 80;
})();

// 单例 readline（仅非 TTY 模式用）：pipe 输入时连续创建新 interface 会 detach stdin
// TTY 模式不创建 readline —— readline 会抢占 stdin 上的 raw bytes
const _rl = IS_TTY ? null : createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const _lineQueue = [];
const _waiters = [];
if (_rl) {
  _rl.on('line', (line) => {
    if (_waiters.length) _waiters.shift()(line);
    else _lineQueue.push(line);
  });
}
function _nextLine() {
  if (!_rl) return Promise.reject(new Error('readline not available in TTY mode'));
  return new Promise((resolve) => {
    if (_lineQueue.length) resolve(_lineQueue.shift());
    else _waiters.push(resolve);
  });
}

// TTY 模式：单 keypress 收集器
// 关键：一次 onData 可能塞了多个 keypress（expect 压测 / 快速连按）
// 用一个**长驻**的 stdin 监听协程把 byte 流切成 keypress 推入队列；
// _readKeypress 只从队列 FIFO 拿一个，立即返回；下一个 keypress 自然被下一个
// 调用消费——这样 4 个连按方向键不会丢。
const _kpQueue = [];
const _kpWaiters = [];
let _kpBuf = '';
let _kpStarted = false;
function _isCompleteKey(buf) {
  if (buf.length === 0) return 0;
  const c0 = buf[0];
  if (c0 !== '\x1b') return 1;
  if (buf.length < 2) return 0;
  const c1 = buf[1];
  if (c1 !== '[' && c1 !== 'O') return 2;
  if (buf.length < 3) return 0;
  return /[A-Za-z~]/.test(buf[2]) ? 3 : 0;
}
function _startKpCollector() {
  if (_kpStarted || !IS_TTY) return;
  _kpStarted = true;
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', (chunk) => {
    _kpBuf += chunk.toString('utf8');
    while (_kpBuf.length > 0) {
      const n = _isCompleteKey(_kpBuf);
      if (n === 0) return;
      const key = _kpBuf.slice(0, n);
      _kpBuf = _kpBuf.slice(n);
      if (_kpWaiters.length) _kpWaiters.shift()(key);
      else _kpQueue.push(key);
    }
  });
  // 退出时关闭 raw mode
  process.on('exit', () => { if (stdin.isRaw) stdin.setRawMode(false); });
  // SIGINT 独立 handler：恢复 raw mode + 退出；once 避免与其他 handler 冲突
  process.once('SIGINT', () => {
    if (stdin.isRaw) stdin.setRawMode(false);
    process.exit(130);
  });
}
function _readKeypress() {
  if (!IS_TTY) return _nextLine();
  _startKpCollector();
  return new Promise((resolve) => {
    if (_kpQueue.length) resolve(_kpQueue.shift());
    else _kpWaiters.push(resolve);
  });
}

// 解析方向键 / 功能键（ANSI 转义序列）
function _parseKey(s) {
  if (s === '\x1b[A' || s === '\x1bOA') return 'up';
  if (s === '\x1b[B' || s === '\x1bOB') return 'down';
  if (s === '\x1b[C' || s === '\x1bOC') return 'right';
  if (s === '\x1b[D' || s === '\x1bOD') return 'left';
  if (s === '\t') return 'tab';
  if (s === '\x1b[Z') return 'shift-tab';
  if (s === '\x1b' || s === '\x1b\x1b') return 'esc';
  if (s === '\x03') return 'ctrl-c';
  if (s === '\r' || s === '\n') return 'enter';
  if (s === '\x7f' || s === '\b') return 'backspace';
  return s; // 原始字符（含数字 1-9, 字母 q/b/e 等）
}

async function prompt(question, { default: def = '', hidden = false } = {}) {
  const display = hidden ? c.gray('(输入隐藏；空 = 保持不变)') : c.gray(def ? ` [默认: ${def}]` : '');
  process.stdout.write(`  ${question}${display}: `);
  if (hidden && IS_TTY) {
    // TTY hidden：与全局 keypress 收集器共享 stdin；逐 key 收集
    _startKpCollector();
    let buf = '';
    while (true) {
      const k = await _readKeypress();
      if (k === '\n' || k === '\r' || k === '\x04') { process.stdout.write('\n'); return buf || def; }
      if (k === '\x03') process.exit(130);
      if (k === '\x7f' || k === '\b') { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
      else if (k.length === 1) { buf += k; process.stdout.write('*'); }
    }
  }
  const line = await _nextLine();
  return line || def;
}

// 渲染单选项文本（带 ANSI：当前项反色高亮+下划线）
function _renderOpt(opt, isActive) {
  if (IS_TTY && isActive) {
    return `\x1b[7m\x1b[1m\x1b[4m ${opt.label} \x1b[0m`; // 反色+加粗+下划线
  }
  return ` ${opt.label} `;
}

// 把横向菜单折成多行（终端宽度不够时）
function _wrapHorizontal(items, maxCols) {
  // 每项显示宽度 = 标签长度 + 2（前后空格）
  const widths = items.map(it => it.text.length);
  // 单行总宽 = sum(widths) + (n-1)*3（项间 " │ "）
  const SEP = 3;
  const totalSingle = widths.reduce((a, b) => a + b, 0) + (items.length - 1) * SEP;
  if (totalSingle <= maxCols - 2) return [items]; // 单行足够
  // 折行：尽量均匀
  const cols = Math.max(1, Math.floor((maxCols - 2 + SEP) / (Math.max(...widths) + SEP)));
  const rows = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return rows;
}

// 横向菜单：TTY 时方向键 + 高亮；非 TTY 时数字键
async function chooseHorizontal(question, options, { default: defIdx = 0 } = {}) {
  out('');
  out(`  ${c.bold(question)} ${c.dim('(← → / Tab 切换, Enter 进入, 1-9 直选, q 退出)')}`);
  // 非 TTY 走 readline 数字键（向后兼容）
  if (!IS_TTY) {
    out('');
    options.forEach((o, i) => {
      const marker = i === defIdx ? c.cyan('▸') : ' ';
      const desc = o.description ? c.dim(` — ${o.description}`) : '';
      out(`  ${marker} ${c.bold(`${i + 1}`)}) ${o.label}${desc}`);
    });
    out(`  ${c.gray('b) 返回上一级   q) 退出')}`);
    const ans = (await prompt('请选择', { default: String(defIdx + 1) })).trim().toLowerCase();
    if (ans === 'q' || ans === 'quit' || ans === 'exit' || ans === 'e') return { quit: true };
    if (ans === 'b' || ans === 'back') return { back: true };
    const n = parseInt(ans, 10);
    if (Number.isNaN(n) || n < 1 || n > options.length) { warn(`无效输入: ${ans}`); return chooseHorizontal(question, options, { default: defIdx }); }
    return { choice: options[n - 1] };
  }

  // TTY 模式：方向键 + 渲染
  let cur = defIdx;
  // 准备渲染项
  const items = options.map((o, i) => ({ text: _renderOpt(o, i === cur), idx: i, opt: o }));
  let rows = _wrapHorizontal(items, TERM_COLS);
  const render = () => {
    // 移到菜单起始（向上 N 行）
    if (_menuLines > 0) process.stdout.write(`\x1b[${_menuLines}A`);
    process.stdout.write('\x1b[0J'); // 清到屏幕底部
    out(`  ${c.bold(question)} ${c.dim('(← → / Tab 切换, Enter 进入, 1-9 直选, q 退出)')}`);
    for (const row of rows) {
      const line = '  ' + row.map(it => it.text).join(c.dim(' │ '));
      out(line);
    }
    _menuLines = rows.length + 1; // 包括标题行
    // 状态行：当前项 + 索引
    process.stdout.write(`\x1b[2m  [${cur + 1}/${options.length}] ${options[cur].description || ''}\x1b[0m\n`);
    _menuLines += 1;
  };
  let _menuLines = 0;
  render();

  // 事件循环
  while (true) {
    const k = _parseKey(await _readKeypress());
    if (k === 'ctrl-c') process.exit(130);
    if (k === 'esc' || k === 'q' || k === 'e' || k === 'Q' || k === 'E') return { quit: true };
    if (k === 'b' || k === 'B') return { back: true };
    if (k === 'right' || k === 'tab') {
      cur = (cur + 1) % options.length;
    } else if (k === 'left' || k === 'shift-tab') {
      cur = (cur - 1 + options.length) % options.length;
    } else if (k >= '1' && k <= '9') {
      const n = parseInt(k, 10);
      if (n >= 1 && n <= options.length) return { choice: options[n - 1] };
    } else if (k === 'enter') {
      return { choice: options[cur] };
    } else if (k === 'up' || k === 'down') {
      // 横向菜单也接受上下 → 跳到首/末
      cur = k === 'up' ? 0 : options.length - 1;
    } else {
      continue; // 忽略其他键
    }
    // 重新渲染
    rows = _wrapHorizontal(options.map((o, i) => ({ text: _renderOpt(o, i === cur), idx: i, opt: o })), TERM_COLS);
    render();
  }
}

// 竖向菜单：TTY 时方向键 + 高亮；非 TTY 时数字键
async function chooseVertical(question, options, { default: defIdx = 0 } = {}) {
  if (!IS_TTY) {
    // 复用旧的 choose 数字键逻辑
    out('');
    out(`  ${c.bold(question)}`);
    options.forEach((o, i) => {
      const marker = i === defIdx ? c.cyan('▸') : ' ';
      const activeMid = o.active === true ? `${c.green('当前在用')} — ` : '';
      const safeDesc = o.description ? stripAnsi(o.description) : '';
      const desc = (safeDesc || activeMid) ? c.dim(` — ${activeMid}${safeDesc}`) : '';
      out(`  ${marker} ${c.bold(`${i + 1}`)}) ${o.label}${desc}`);
    });
    out(`  ${c.gray('b) 返回上一级   q) 退出')}`);
    const ans = (await prompt('请选择', { default: String(defIdx + 1) })).trim().toLowerCase();
    if (ans === 'q' || ans === 'quit' || ans === 'exit' || ans === 'e') return { quit: true };
    if (ans === 'b' || ans === 'back') return { back: true };
    const n = parseInt(ans, 10);
    if (Number.isNaN(n) || n < 1 || n > options.length) { warn(`无效输入: ${ans}`); return chooseVertical(question, options, { default: defIdx }); }
    return { choice: options[n - 1] };
  }
  out('');
  out(`  ${c.bold(question)} ${c.dim('(↑ ↓ 切换, Enter 确认, 1-9 直选, b 返回, q 退出)')}`);
  let cur = defIdx;
  const render = () => {
    if (_menuLines > 0) process.stdout.write(`\x1b[${_menuLines}A`);
    process.stdout.write('\x1b[0J');
    out(`  ${c.bold(question)} ${c.dim('(↑ ↓ 切换, Enter 确认, 1-9 直选, b 返回, q 退出)')}`);
    for (let i = 0; i < options.length; i++) {
      if (i === cur) {
        out(`  ${c.cyan('▸')} \x1b[7m\x1b[1m ${i + 1}) ${options[i].label} \x1b[0m${c.dim(options[i].description || '')}`);
      } else {
        out(`    ${c.bold(`${i + 1}`)}) ${options[i].label}${c.dim(options[i].description ? ' — ' + options[i].description : '')}`);
      }
    }
    _menuLines = options.length + 1;
  };
  let _menuLines = 0;
  render();
  while (true) {
    const k = _parseKey(await _readKeypress());
    if (k === 'ctrl-c') process.exit(130);
    if (k === 'esc' || k === 'q' || k === 'Q' || k === 'e' || k === 'E') return { quit: true };
    if (k === 'b' || k === 'B') return { back: true };
    if (k === 'down') { cur = (cur + 1) % options.length; }
    else if (k === 'up') { cur = (cur - 1 + options.length) % options.length; }
    else if (k >= '1' && k <= '9') {
      const n = parseInt(k, 10);
      if (n >= 1 && n <= options.length) return { choice: options[n - 1] };
    } else if (k === 'enter') { return { choice: options[cur] }; }
    else { continue; }
    render();
  }
}

// 旧的 choose 改名向下兼容（其它地方还在用）
const choose = chooseVertical;

async function confirm(question, defaultYes = false) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const ans = (await prompt(`${question} ${hint}`)).trim().toLowerCase();
  if (ans === '') return defaultYes;
  return ans === 'y' || ans === 'yes';
}

// ─── 业务：Review 供应商配置 ───────────────────────────
// 外部 Review 供应商：扁平化 3 个独立 action
// 1) 迅飞 KEY → SPARK_API_KEY
// 2) 火山 KEY → ARK_API_KEY
// 3) 供应商   → CODING_BRIDGE_PROVIDER (xfyun-coding / volcengine-coding)
// 三者互相独立，可同时设；coding-bridge-mcp 内部按 provider 优先级匹配 key
// （API_KEY → SPARK_API_KEY / ARK_API_KEY）
const REVIEW_ACTIONS = [
  { id: 'spark-key',   label: '迅飞 KEY',    envKey: 'SPARK_API_KEY',         friendly: 'xfyun coding KEY' },
  { id: 'ark-key',     label: '火山 KEY',    envKey: 'ARK_API_KEY',           friendly: 'volcengine ark KEY' },
  { id: 'provider',    label: '供应商',      envKey: 'CODING_BRIDGE_PROVIDER', friendly: 'coding-bridge 后端' },
];

const CODING_BRIDGE_PROVIDERS = [
  { id: 'xfyun-coding', label: 'xfyun-coding', description: '讯飞 coding（默认）' },
  { id: 'volcengine-coding', label: 'volcengine-coding', description: '火山引擎 ark' },
];

// 按用户原始规则：先查 .env，已存在→提醒并询问是否修改；无/空→直接输入
async function ensureApiKey(envKeyName, friendlyName) {
  const cur = readEnvKey(envKeyName);
  if (cur && cur.trim() !== '') {
    out('');
    warn(`检测到 .env 已存在 ${c.bold(envKeyName)}: ${c.green(maskValue(envKeyName, cur))}`);
    const change = await confirm(`是否修改 ${friendlyName}？`, false);
    if (!change) {
      info(`  保持 ${envKeyName} 不变`);
      return null;
    }
    out(`  ${c.dim('空回车 = 保持现有值（不修改）')}`);
    const ans = await prompt(`新 ${friendlyName}`, { default: '', hidden: true });
    if (!ans || ans === cur) return null; // 空回车或原值 → 不动
    return ans;
  }
  // 不存在 / 空 → 直接提示输入
  out('');
  info(`.env 中没有 ${c.bold(envKeyName)}，请输入 ${friendlyName}:`);
  const ans = await prompt(friendlyName, { default: '', hidden: true });
  if (!ans) {
    warn(`未输入 ${friendlyName}，将跳过该变量`);
    return null;
  }
  return ans;
}

async function configureReviewProvider() {
  title('外部 Review 供应商（三项独立，可同时设）');
  // 显示当前三个 envKey 状态
  for (const a of REVIEW_ACTIONS) {
    const v = readEnvKey(a.envKey);
    let status;
    if (a.id === 'provider') {
      status = v ? `${v} (已设)` : c.yellow('未设置');
    } else {
      status = v ? c.green('已设置') : c.yellow('未设置');
    }
    info(`  ${c.bold(a.label.padEnd(10))}  ${a.envKey} = ${status}`);
  }

  // 把 action 转成 choose 选项（带实时状态）
  const opts = REVIEW_ACTIONS.map(a => {
    const v = readEnvKey(a.envKey);
    let status;
    if (a.id === 'provider') {
      status = v ? `${v} (已设)` : c.yellow('未设置');
    } else {
      status = v ? c.green('已设置') : c.yellow('未设置');
    }
    return { id: a.id, label: a.label, description: `${a.envKey} = ${status}` };
  });

  const sel = await choose('选择要执行的动作', opts, { default: 0 });
  if (sel.quit) return 'quit';
  if (sel.back) return 'back';
  const action = REVIEW_ACTIONS.find(a => a.id === sel.choice.id);
  if (!action) return 'continue';

  const env = loadEnv();
  const updated = new Set();
  if (action.id === 'provider') {
    // 选供应商：走 CODING_BRIDGE_PROVIDERS pick
    const cur = readEnvKey(action.envKey) || 'xfyun-coding';
    const cbSel = await choose('coding-bridge 后端', CODING_BRIDGE_PROVIDERS,
      { default: CODING_BRIDGE_PROVIDERS.findIndex(p => p.id === cur) }
    );
    if (cbSel.quit) return 'quit';
    if (cbSel.back) return 'back';
    setEnvKey(env.map, action.envKey, cbSel.choice.id); updated.add(action.envKey);
    await syncClaudeJsonCodingBridge(cbSel.choice.id);
  } else {
    // 设 KEY：走 ensureApiKey
    const newKey = await ensureApiKey(action.envKey, action.friendly);
    if (newKey !== null) { setEnvKey(env.map, action.envKey, newKey); updated.add(action.envKey); }
  }

  saveEnv(env, updated.size > 0);
  ok(`已更新 .env: ${[...updated].join(', ') || '（无变化）'}`);
  info('提示：手动 `export $(cat .env | xargs)` 或在 shell rc 里 source .env 即可生效');
  return 'continue';
}

// 把 coding-bridge 同步到 ~/.claude.json.mcpServers（写字面值，不破坏其他 server）
// 设计：与 _applyKeysToClaudeJson 对齐——MCP env 段是字面值，不经 shell 展开，
// 故必须写已解析的 KEY；占位符 ${...} 会导致鉴权失败。
// kimi MCP 段由 install.mjs:installCodingBridgeJson 写入，configure 侧不重复。
async function syncClaudeJsonCodingBridge(cbProvider) {
  // ST-7 硬化：读 .env 字面值；缺 key 时不写空值/占位符
  const provider = readEnvKey('CODING_BRIDGE_PROVIDER') || cbProvider || 'xfyun-coding';
  const spark = readEnvKey('SPARK_API_KEY') || '';
  const ark = readEnvKey('ARK_API_KEY') || '';
  const generic = readEnvKey('CODING_BRIDGE_API_KEY') || '';
  let activeKey;
  if (provider === 'xfyun-coding') activeKey = spark || generic;
  else if (provider === 'volcengine-coding') activeKey = ark || generic;
  else activeKey = generic;
  // provider 指定但专属 key 缺失 → 静默回退到 generic 会用错 key，warn 提示
  if (activeKey && ((provider === 'xfyun-coding' && !spark) || (provider === 'volcengine-coding' && !ark))) {
    warn(`未设置 ${provider === 'xfyun-coding' ? 'SPARK_API_KEY' : 'ARK_API_KEY'}，回退使用 CODING_BRIDGE_API_KEY`);
  }
  if (!activeKey) {
    warn(`.env 缺 SPARK_API_KEY / ARK_API_KEY / CODING_BRIDGE_API_KEY；跳过 coding-bridge MCP 写入（避免写入空值/占位符）`);
    return;
  }

  const cfg = readJSON(CLAUDE_JSON) || {};
  cfg.mcpServers = cfg.mcpServers || {};
  const exists = cfg.mcpServers['coding-bridge']?.command === 'uvx';
  // 已存在但 env 含占位符 ${...}（旧 install 路径遗留坏值）→ 修正为字面值
  // 精确匹配 ${...} 模板语法，避免 key 字面值偶含 ${ 被误判触发无谓重写
  const curEnv = cfg.mcpServers['coding-bridge']?.env || {};
  const hasPlaceholder = Object.values(curEnv).some(v => typeof v === 'string' && /\$\{[^}]+\}/.test(v));
  if (exists && !hasPlaceholder) {
    info(`coding-bridge 已存在于 ${CLAUDE_JSON}（字面值完好，保留）`);
    return;
  }
  backupOnce(CLAUDE_JSON);
  const existingEnv = cfg.mcpServers['coding-bridge']?.env || {};
  cfg.mcpServers['coding-bridge'] = {
    command: 'uvx',
    args: ['--from', 'git+https://github.com/htmambo/coding-bridge-mcp.git', 'coding-bridge-mcp'],
    env: {
      ...existingEnv,          // 保留用户自定义 env 键（与 _applyKeysToClaudeJson 逐键设语义对齐）
      PROVIDER: provider,
      API_KEY: activeKey,
      SPARK_API_KEY: spark,
      ARK_API_KEY: ark,
    },
  };
  atomicWriteJSON(CLAUDE_JSON, cfg);
  ok(`已写入 coding-bridge → ${CLAUDE_JSON}（字面值，provider=${provider}）`);
}
async function syncSettingsAllow() {
  const settings = readJSON(SETTINGS_JSON) || {};
  settings.permissions = settings.permissions || {};
  settings.permissions.allow = settings.permissions.allow || [];
  const needed = ['mcp__coding-bridge__review_code', 'mcp__coding-bridge__review_plan', 'mcp__kimi__kimi'];
  const missing = needed.filter(t => !settings.permissions.allow.includes(t));
  if (missing.length === 0) {
    info('settings.json.permissions.allow: review tools 已就位');
    return;
  }
  backupOnce(SETTINGS_JSON);
  settings.permissions.allow = settings.permissions.allow.concat(missing);
  atomicWriteJSON(SETTINGS_JSON, settings);
  ok(`已追加 allow: ${missing.join(', ')}`);
}

// ─── 业务：主供应商预设 ───────────────────────────────
// 动态扫描 ~/.claude/*.json，过滤系统文件 + 非 env 配置，作为预设列表
// 用户只需要把任意命名.json（含 ANTHROPIC_BASE_URL/TOKEN 即可）放到 ~/.claude/ 下就能用
const PRESET_EXCLUDE = new Set([
  'settings.json',         // Claude Code 自己的 settings
  '.mcp.json',             // OMC 内部 MCP 配置
  'providers.json',        // Claude Code provider 列表
  'execution_config.json', // OMC 执行配置
  'stats-cache.json',
  'mcp-needs-auth-cache.json',
  'settings.local.json',
  'default.json',          // 占位（无 env 段）— 显式排除
]);
// 仓库内项目自带预设目录（用户可见的命名 = 去掉 .base 后缀）
const REPO_PRESET_DIR = join(REPO_ROOT, 'global', 'json');
function _scanPresets() {
  const seen = new Map(); // id → entry（~/.claude/ 优先；global/json/ 同名 skip）
  // 1) ~/.claude/*.json（用户级，优先）
  if (existsSync(CLAUDE_DIR)) {
    for (const f of readdirSync(CLAUDE_DIR).filter(f => f.endsWith('.json') && !PRESET_EXCLUDE.has(f))) {
      const p = join(CLAUDE_DIR, f);
      try {
        const stat = statSync(p);
        const json = readJSON(p);
        if (json && json.env) {
          const id = f.replace(/\.json$/, '');
          seen.set(id, { file: f, path: p, mtime: stat.mtimeMs, json, source: 'user' });
        }
      } catch {}
    }
  }
  // 2) global/json/*.base.json（仓库自带，id 去掉 .base 后缀；与 user 同名时 skip）
  if (existsSync(REPO_PRESET_DIR)) {
    for (const f of readdirSync(REPO_PRESET_DIR).filter(f => f.endsWith('.base.json'))) {
      const p = join(REPO_PRESET_DIR, f);
      try {
        const stat = statSync(p);
        const json = readJSON(p);
        if (json && json.env) {
          const id = f.replace(/\.base\.json$/, '');
          if (!seen.has(id)) seen.set(id, { file: f, path: p, mtime: stat.mtimeMs, json, source: 'repo' });
        }
      } catch {}
    }
  }
  // 按 mtime 倒序
  const curSettings = readJSON(SETTINGS_JSON) || {};
  const curEnv = curSettings.env || {};
  return [...seen.values()].sort((a, b) => b.mtime - a.mtime).map(it => {
    const env = it.json.env || {};
    const url = env.ANTHROPIC_BASE_URL || '（无 base_url）';
    const model = env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_OPUS_MODEL || '';
    // 用 URL 解析剥离 userinfo（user:pass@host），避免 user:pass 泄到终端
    let shortUrl = url;
    try { shortUrl = new URL(url).hostname; } catch { /* 保留原串，split('/')[0] 兜底 */ }
    // active：preset.env 是 settings.env 的 (key,value) 子集 → 该预设已完整应用
    // 仅布尔比对结果；token 等 secret 不进入 description，绝不回显明文
    const active = Object.keys(env).length > 0
      && Object.keys(env).every(k => Object.prototype.hasOwnProperty.call(curEnv, k) && curEnv[k] === env[k]);
    // 厂商元数据：title/description 为惰性顶层 key（同 permissions/hooks，从不合并进 settings.json）
    const metaTitle = typeof it.json.title === 'string' && it.json.title.trim() ? it.json.title.trim() : '';
    const metaDesc = typeof it.json.description === 'string' && it.json.description.trim() ? it.json.description.trim() : '';
    const urlModel = `${shortUrl}${model ? ' · ' + model : ''}${it.source === 'repo' ? ' · 仓库' : ''}`;
    // 三段格式：label=title||file；tail=description||url+model
    const label = metaTitle || it.file;
    const desc = metaDesc || urlModel;
    return { id: it.file.replace(/(\.base)?\.json$/, ''), label, file: it.file, path: it.path, description: desc, active, title: metaTitle, metaDesc };
  });
}
async function configureMainPreset() {
  title('Claude Code 主供应商预设');
  info(`当前 settings.json env 线索:`);
  const cur = readJSON(SETTINGS_JSON);
  const curBaseUrl = cur?.env?.ANTHROPIC_BASE_URL || '（未设）';
  const curModel = cur?.model || '（未设）';
  info(`  ANTHROPIC_BASE_URL = ${c.bold(curBaseUrl)}`);
  info(`  model = ${c.bold(curModel)}`);

  const presets = _scanPresets();
  if (presets.length === 0) {
    err(`~/.claude/ 下没找到任何预设 JSON（每个预设需要含 env 段）`);
    return 'continue';
  }
  info(`  检测到 ${presets.length} 个预设：${presets.map(p => p.id).join(', ')}`);
  const activePreset = presets.find(p => p.active);
  if (activePreset) {
    const tag = c.bold(activePreset.title || activePreset.file);
    ok(`当前在用：${tag}（env 与 settings.json 完全匹配）`);
  } else {
    warn(`当前 settings.json 的 env 未完整匹配任何预设（可能为手动修改或混合来源）`);
  }
  const sel = await choose(`选择预设（写入 ~/.claude/settings.json 的 env，共 ${presets.length} 项）`, presets);
  if (sel.quit) return 'quit';
  if (sel.back) return 'back';

  // _scanPresets 已统一两个来源并把 path 填好；不再手动拼
  const fromPath = sel.choice.path;
  if (!existsSync(fromPath)) {
    err(`找不到预设源：${fromPath}`);
    return 'continue';
  }
  const preset = readJSON(fromPath);
  if (!preset?.env) { err(`预设 ${sel.choice.label} 没有 env 段，跳过`); return 'continue'; }

  const settings = readJSON(SETTINGS_JSON) || {};
  backupOnce(SETTINGS_JSON);
  settings.env = { ...(settings.env || {}), ...preset.env };
  if (preset.model) settings.model = preset.model;
  atomicWriteJSON(SETTINGS_JSON, settings);
  ok(`已合并 ${sel.choice.label} 的 env 到 ${SETTINGS_JSON}`);
  warn('提示：重启 Claude Code 让 env 生效；ANTHROPIC_AUTH_TOKEN 等 secret 字段已原样保留');
  return 'continue';
}

// ─── 业务：辅助子模块 ─────────────────────────────────
const SUBSYSTEMS = [
  { id: 'memory-mcp', label: 'Memory MCP', check: 'installMemoryMcp', description: '持久化路径修复（install-memory-mcp）' },
  { id: 'pre-push', label: 'Pre-push Hook', check: 'installPrePush', description: 'secret 拦截（install-pre-push）' },
  { id: 'pre-sync-docs', label: 'Pre-sync-docs Hook', check: 'installPreSyncDocsHook', description: 'sync-docs 检查（install-pre-sync-docs-hook）' },
];
async function configureSubsystems() {
  title('辅助子模块');
  out(`  ${c.dim('提示：实际安装请用 ./install.sh install-<name>')}`);
  out(`  ${c.dim('这里只检查 / 报告状态，不做真实安装（避免脚本逻辑分叉）')}`);
  out('');
  for (const sub of SUBSYSTEMS) {
    const status = checkSubsystemStatus(sub.id);
    const icon = status.ok ? c.green('✓') : c.yellow('○');
    out(`  ${icon} ${c.bold(sub.label)} — ${c.dim(sub.description)}`);
    out(`    ${c.dim(status.detail)}`);
  }
  return 'continue';
}
function checkSubsystemStatus(id) {
  if (id === 'memory-mcp') {
    const cfg = readJSON(join(CLAUDE_DIR, '.mcp.json'));
    const mem = cfg?.mcpServers?.memory;
    if (!mem) return { ok: false, detail: '.mcp.json.mcpServers.memory 未配置' };
    return { ok: true, detail: `memory 已配置（${mem.command}）` };
  }
  if (id === 'pre-push') {
    const f = join(REPO_ROOT, '.git', 'hooks', 'pre-push');
    return existsSync(f) ? { ok: true, detail: `${f} 存在` } : { ok: false, detail: `${f} 不存在` };
  }
  if (id === 'pre-sync-docs') {
    const f = join(REPO_ROOT, '.git', 'hooks', 'pre-commit');
    if (!existsSync(f)) return { ok: false, detail: `${f} 不存在` };
    const txt = readText(f);
    return /sync-docs|pre-sync/i.test(txt)
      ? { ok: true, detail: 'pre-commit 包含 sync-docs 检查' }
      : { ok: false, detail: 'pre-commit 不含 sync-docs 检查' };
  }
  return { ok: false, detail: 'unknown' };
}

// ─── 业务：应用 / 重启 Claude Code ─────────────────────
// 把 .env 里的 KEY 直接写入 ~/.claude.json 的 mcpServers.coding-bridge.env
// （**字面值**，不再用 ${...} 占位符）—— MCP 进程启动时直接从 env 段读 KEY，
// 不依赖 shell env 是否 export；也不受 shell rc 路径差异影响。
// 同时检测 Claude Code 进程是否在跑。
function _detectClaudeCode() {
  // pgrep 命中含 claude 的进程；排除本进程（configure.mjs 也含 claude 字符串）
  // pgrep 找不到时退出码 1，不算错
  const r = spawnSync('pgrep', ['-fl', 'claude-code|@anthropic-ai/claude-code'], { encoding: 'utf8' });
  const pids = [];
  for (const line of (r.stdout || '').split('\n')) {
    const m = line.match(/^(\d+)\s+/);
    if (m) {
      const pid = parseInt(m[1], 10);
      if (pid !== process.pid) pids.push(pid);
    }
  }
  return { running: pids.length > 0, pids };
}
function _applyKeysToClaudeJson(dotenv, dryRun) {
  // 把 .env 里的 KEY 字面值写入 ~/.claude.json.mcpServers.coding-bridge.env
  // 保留原有 mcpServers 其它段（kimi 等）
  const cfg = readJSON(CLAUDE_JSON) || {};
  cfg.mcpServers = cfg.mcpServers || {};
  if (cfg.mcpServers['coding-bridge']?.command !== 'uvx') {
    cfg.mcpServers['coding-bridge'] = {
      command: 'uvx',
      args: ['--from', 'git+https://github.com/htmambo/coding-bridge-mcp.git', 'coding-bridge-mcp'],
      env: { PROVIDER: 'xfyun-coding' },
    };
  }
  const cb = cfg.mcpServers['coding-bridge'];
  cb.env = cb.env || {};
  const provider = dotenv.CODING_BRIDGE_PROVIDER || 'xfyun-coding';
  cb.env.PROVIDER = provider;
  // 通用 API_KEY 字段：写当前选中 provider 的实际 key（xfyun→SPARK、volcengine→ARK）
  // coding-bridge-mcp 内部优先匹配 SPARK_API_KEY / ARK_API_KEY；API_KEY 作为兜底
  // 严格相等匹配（不 startsWith）：未来新增 provider 需显式 if-else，避免误选 key
  let activeKey = '';
  if (provider === 'xfyun-coding') activeKey = dotenv.SPARK_API_KEY || dotenv.CODING_BRIDGE_API_KEY || '';
  else if (provider === 'volcengine-coding') activeKey = dotenv.ARK_API_KEY || dotenv.CODING_BRIDGE_API_KEY || '';
  else activeKey = dotenv.CODING_BRIDGE_API_KEY || '';
  cb.env.API_KEY = activeKey;
  // 保留两个专属 key（即使当前 provider 不用，也给未来切换用）
  cb.env.SPARK_API_KEY = dotenv.SPARK_API_KEY || '';
  cb.env.ARK_API_KEY = dotenv.ARK_API_KEY || '';
  if (dryRun) return cfg;
  backupOnce(CLAUDE_JSON);
  atomicWriteJSON(CLAUDE_JSON, cfg);
  return cfg;
}
// 抽公共逻辑：解析 .env → 校验 → 写 KEY → 检测 Claude Code
// 返回 { lines, hasError, dotenvFlat, haveSpark, haveArk, haveProvider } 给两条 caller 共用
function _applyCore() {
  const dotenv = loadEnv().map;
  const dotenvFlat = {};
  for (const v of dotenv.values()) {
    if (typeof v === 'object' && v.line) {
      const m = v.line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) dotenvFlat[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  const haveSpark = !!dotenvFlat.SPARK_API_KEY;
  const haveArk = !!dotenvFlat.ARK_API_KEY;
  const haveProvider = !!dotenvFlat.CODING_BRIDGE_PROVIDER;
  const lines = [];
  let hasError = false;
  if (Object.keys(dotenvFlat).length === 0) {
    lines.push(c.red(`  ✗ 找不到 ${ENV_FILE} 或为空`));
    lines.push(c.dim('  先在 "外部 Review 供应商" 设一个 KEY'));
    hasError = true;
  } else if (!haveSpark && !haveArk) {
    lines.push(c.red('  ✗ .env 没有 SPARK_API_KEY / ARK_API_KEY 任一'));
    lines.push(c.dim('  先在 "外部 Review 供应商" 设 KEY 再应用'));
    hasError = true;
  } else {
    if (DRY_RUN) {
      lines.push(c.yellow(`  [dry-run] would write ${CLAUDE_JSON} mcpServers.coding-bridge.env`));
    } else {
      _applyKeysToClaudeJson(dotenvFlat, false);
      lines.push(c.green(`  ✓ KEY 字面值已写入 ${CLAUDE_JSON}`));
      lines.push(c.dim(`    mcpServers.coding-bridge.env：PROVIDER + SPARK_API_KEY + ARK_API_KEY`));
    }
    const cc = _detectClaudeCode();
    if (cc.running) {
      lines.push(c.yellow(`  ⚠ 检测到 Claude Code 进程 (pid: ${cc.pids.join(', ')})`));
      lines.push(c.dim('    请手动退出 (Ctrl-C / Cmd-Q) 后重新启动'));
      lines.push(c.dim(`    新启动会读 ${CLAUDE_JSON} 新的 env 段，KEY 字面值直接生效`));
    } else {
      lines.push(c.green('  ✓ 未检测到 Claude Code 进程；下次启动自动应用'));
    }
    lines.push('');
    lines.push(c.dim(`  env 状态: SPARK=${haveSpark ? '✓' : '✗'}  ARK=${haveArk ? '✓' : '✗'}  PROVIDER=${dotenvFlat.CODING_BRIDGE_PROVIDER || '未设'}`));
  }
  return { lines, hasError, dotenvFlat, haveSpark, haveArk, haveProvider };
}
async function configureApply() {
  title('应用 / 重启 Claude Code');
  const { lines, hasError } = _applyCore();
  for (const l of lines) out(l);
  return 'continue';
}

// ─── 顶层菜单 ────────────────────────────────────────
// Statusline / HUD 不在主菜单（已经走 install-ccstatusline symlink 装），
// 它的状态在"辅助子模块"面板里只读展示
const TOP_MENU = [
  { id: 'review', label: '外部 Review 供应商', description: '迅飞/火山 KEY + coding-bridge 后端' },
  { id: 'preset', label: 'Claude Code 主供应商预设', description: '动态扫描 ~/.claude/*.json' },
  { id: 'apply', label: '应用 / 重启 Claude Code', description: '把 KEY 注入 shell env + 检测 MCP' },
  { id: 'subs', label: '辅助子模块（只读）', description: 'memory MCP / pre-push / pre-sync-docs / statusline 状态' },
  { id: 'show', label: '查看当前 .env', description: '打印仓库根 .env 关键键' },
];

// ─── 面板系统：业务函数改为"返回面板"或"返回子面板" ───
// 面板类型：
//   { kind: 'pick', title, hint, options, breadcrumb?, onChoose(choice) → next | 'done' | 'push' }
//   { kind: 'message', title, lines, onAnyKey() }
//   { kind: 'input', title, prompt, hidden, default, onSubmit(value) → next | 'done' }
//   { kind: 'confirm', title, question, defaultYes, onSubmit(yes) → next | 'done' }
// 这样 main 状态机不调业务函数——业务函数"返回"面板描述。

// ─── 旧业务函数保留（用于子流程内部用 prompt/ensureApiKey）；TUI 模式用新结构 ───

// ─── 状态机主循环 ─────────────────────────────────────
function maskValue(key, val) {
  if (!/API_KEY|AUTH_TOKEN|TOKEN|SECRET/i.test(key)) return val;
  if (val.length <= 8) return '***';
  return val.slice(0, 4) + c.gray('…') + val.slice(-4);
}

// 渲染单条面板行
function _wrapHorizontalTexts(texts, maxCols) {
  // texts[i] 含 ANSI；按"显示宽度"估算（粗略，忽略 ANSI）
  const widths = texts.map(t => t.replace(/\x1b\[[0-9;]*m/g, '').length);
  const SEP = 3;
  if (widths.reduce((a, b) => a + b, 0) + (texts.length - 1) * SEP <= maxCols - 2) return [texts];
  const cols = Math.max(1, Math.floor((maxCols - 2 + SEP) / (Math.max(...widths) + SEP)));
  const rows = [];
  for (let i = 0; i < texts.length; i += cols) rows.push(texts.slice(i, i + cols));
  return rows;
}
function _renderMainRow(items, activeIdx) {
  const texts = items.map((it, i) => {
    if (i === activeIdx) return `\x1b[7m\x1b[1m\x1b[4m ${it.label} \x1b[0m`;
    return ` ${it.label} `;
  });
  const rows = _wrapHorizontalTexts(texts, TERM_COLS);
  return rows.map(r => '  ' + r.join(c.dim(' │ '))).join('\n');
}

// 部分 mask：首尾几个字符明文，中间 *；用于 hidden 模式（屏幕防偷窥但仍可核对）
function partialMask(s) {
  if (!s) return '_';
  if (s.length <= 8) return '*'.repeat(s.length); // 太短全 mask
  const head = s.slice(0, 4);
  const tail = s.slice(-4);
  const mid = '*'.repeat(Math.max(2, s.length - 8));
  return head + mid + tail;
}

function _renderSubRow(items, activeIdx, focusHere) {
  return items.map((it, i) => {
    const isActive = i === activeIdx;
    // 状态颜色：isSet=true → 绿；未设 → 黄；不传 isSet → 默认 dim
    const setColor = it.isSet === true ? c.green : (it.isSet === false ? c.yellow : c.dim);
    const descText = it.description ? stripAnsi(it.description) : '';
    // 预设面板专属：active=true → 该预设 env 与 settings.json 完全匹配（当前在用）
    // 作为中段插入：label — 当前在用 — tail；非 active 时整段省略（activeMid 为空串）
    const activeMid = it.active === true ? `${c.green('当前在用')} — ` : '';
    if (isActive && focusHere) {
      return `  ${c.cyan('▸')} \x1b[7m\x1b[1m ${it.label} \x1b[0m — ${activeMid}${setColor(descText.replace(/^[^=]+=\s*/, ''))}`;
    } else if (isActive) {
      return `  ${c.cyan('▸')} ${c.bold(it.label)} — ${activeMid}${setColor(descText.replace(/^[^=]+=\s*/, ''))}`;
    }
    return `    ${it.label} — ${activeMid}${setColor(descText.replace(/^[^=]+=\s*/, ''))}`;
  }).join('\n');
}

function _clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

// 渲染整个屏幕（两区同显）
function _renderScreen(state) {
  if (!IS_TTY) return; // 非 TTY 不重画（保持原行为）
  _clearScreen();
  // 静态头
  out(c.bold(c.cyan('dotclaude-portable 配置向导 v1.0.0')));
  out(c.dim(`  repo: ${REPO_ROOT}    home: ${HOME}`));
  const envNote = existsSync(ENV_FILE) ? '' : c.yellow(' (将创建)');
  out(c.dim(`  .env: ${ENV_FILE}${envNote}`));
  if (DRY_RUN) out(c.yellow('  --dry-run 模式：所有写操作只打印不落盘'));
  out('');

  // 主菜单区
  const focus = state.focus;
  const mainRow = _renderMainRow(TOP_MENU, state.mainIdx);
  out(focus === 'main' ? mainRow : c.dim(mainRow));
  // 主项描述
  const mainDesc = TOP_MENU[state.mainIdx].description;
  out(`  ${c.dim('→ ' + mainDesc)}`);
  out(c.dim('  ─────────────────────────────────────────────'));
  out('');

  // 面包屑 + 子区
  const panel = state.panel;
  if (panel.kind === 'pick') {
    if (panel.breadcrumb) out(`  ${c.gray(panel.breadcrumb)}`);
    out(`  ${c.bold(panel.title)} ${c.dim('(↑↓ 切换, ←→ 切主菜单, 1-9 直选, Enter 确认, q 退出)')}`);
    out('');
    out(_renderSubRow(panel.options, state.subIdx, focus === 'sub'));
  } else if (panel.kind === 'message') {
    if (panel.breadcrumb) out(`  ${c.gray(panel.breadcrumb)}`);
    out(`  ${c.bold(panel.title)}`);
    out('');
    for (const line of panel.lines) out('  ' + line);
    out('');
    out(c.dim('  按任意键返回主菜单（q 退出）'));
  } else if (panel.kind === 'input') {
    if (panel.breadcrumb) out(`  ${c.gray(panel.breadcrumb)}`);
    out(`  ${c.bold(panel.title)}`);
    out('');
    const buf = (state && state._inputBuf) || '';
    const display = panel.hidden ? partialMask(buf) : buf;
    out(`  ${panel.prompt}: ${c.cyan(display || '_')}`);
    if (panel.hidden) out(c.dim('  （输入隐藏；Enter 确认，Backspace 删除）'));
  } else if (panel.kind === 'confirm') {
    if (panel.breadcrumb) out(`  ${c.gray(panel.breadcrumb)}`);
    out(`  ${c.bold(panel.title)}`);
    out('');
    const hint = panel.defaultYes ? '[Y/n]' : '[y/N]';
    out(`  ${panel.question} ${c.dim(hint)} ${c.cyan('_')}`);
  } else if (panel.kind === 'empty') {
    out(c.dim('  （该子项无选项）'));
  }

  out('');
  out(c.dim('  ─────────────────────────────────────────────'));
  out(c.dim('  ↑↓/←→ 移动, Enter 确认, 1-9 直选, q 退出, b 返回'));
}

// 业务回调：每个主项对应一个"入口面板"
function _getEntryPanel(mainIdx) {
  const id = TOP_MENU[mainIdx].id;
  let panel;
  switch (id) {
    case 'review': panel = _panelReviewTop(); break;
    case 'preset': panel = _panelPreset(); break;
    case 'apply':  panel = _panelApply(); break;
    case 'subs':   panel = _panelSubsystems(); break;
    case 'show':   panel = _panelShowEnv(); break;
    default:       return { kind: 'empty' };
  }
  panel._entryMainId = id; // 在 _getEntryPanel 内部 / message 出栈时识别入口来源
  return panel;
}

// ─── 面板状态机显式 API（push/replace/pop） ───
// _context 标识当前 sub-panel 业务派发点；与 breadcrumb 文本解耦
//   context 序列（与 mainIdx 对应）：
//     'review'            — 外部 Review 供应商入口
//     'review-provider'   — Review > 供应商（pick）
//     'review-key'        — Review > KEY（input/confirm 流程中）
//     'preset'            — 主供应商预设入口
//     'apply'             — 应用入口
//     'subs'              — 辅助子模块
//     'show'              — 查看 .env
const _panelOps = {
  // push：新面板入栈；保留旧面板在 panelStack 顶（message 出栈时会 pop 恢复）
  push(state, panel) {
    if (process.env.DEBUG_TUI === '1') console.error(`[TUI] push depth=${state.panelStack.length + 1} kind=${panel.kind}`);
    state.panelStack.push(state.panel);
    state.panel = panel;
  },
  // replace：直接替换当前面板（不增栈深；message 出栈不动）
  replace(state, panel) {
    if (process.env.DEBUG_TUI === '1') console.error(`[TUI] replace depth=${state.panelStack.length} kind=${panel.kind}`);
    state.panel = panel;
  },
};

// ─── Review 业务完整 TUI 化（替代 _handleSubPick 的降级路径） ──
// 3 个独立 action：迅飞 KEY / 火山 KEY / 供应商
function _tuiReviewRun(state) {
  const choice = state.panel.options[state.subIdx];
  const action = REVIEW_ACTIONS.find(a => a.id === choice.id);
  if (!action) return;
  const env0 = loadEnv();
  state._tuiEnv = env0;
  state._tuiUpdated = new Set();
  if (action.id === 'provider') {
    // 选供应商：push pick 面板
    const cur = readEnvKey(action.envKey) || 'xfyun-coding';
    _panelOps.push(state, {
      kind: 'pick',
      breadcrumb: '主菜单 > 外部 Review 供应商 > 供应商',
      title: 'coding-bridge 后端',
      options: CODING_BRIDGE_PROVIDERS.map(p => ({ id: p.id, label: p.label, description: p.description })),
      defaultIdx: CODING_BRIDGE_PROVIDERS.findIndex(p => p.id === cur),
    });
    state.subIdx = state.panel.defaultIdx ?? 0;
    state._tuiEnvKey = action.envKey; // finalize 时用
    state._tuiSyncFn = () => syncClaudeJsonCodingBridge(CODING_BRIDGE_PROVIDERS[state.subIdx].id);
    state._context = 'review-provider';
    state._render();
  } else {
    // 迅飞 KEY / 火山 KEY：直接走 input 面板
    _tuiPushKeyPanel(state, action.envKey, action.friendly, null);
  }
}
function _tuiReviewProviderSelected(state) {
  // 选完供应商 → 写 env + 弹结果
  // _tuiReviewRun 在 provider 分支 push 了 review top（line 928）到 panelStack，
  // 然后替换 state.panel = inner supplier pick（**没** push inner pick）。
  // 所以 panelStack 顶 = review top，state.panel = inner supplier pick。
  // message 出栈要拿到 review top——但 message 任意键处理 pop 后会重生成
  // （_topEntry 标志），所以这里**不 push**，让 panelStack 仍 = [review_top]
  // message 出栈 pop → review_top → _topEntry 触发重生成 ✅
  const cb = state.panel.options[state.subIdx];
  setEnvKey(state._tuiEnv.map, state._tuiEnvKey, cb.id);
  state._tuiUpdated.add(state._tuiEnvKey);
  if (state._tuiSyncFn) { try { state._tuiSyncFn(); } catch (e) { err(`同步失败: ${e.message}`); } }
  saveEnv(state._tuiEnv, state._tuiUpdated.size > 0);
  _panelOps.replace(state, {
    kind: 'message',
    breadcrumb: '主菜单 > 外部 Review 供应商 > 供应商 > 结果',
    title: '✓ 已切换供应商',
    lines: [
      c.green(`  ${state._tuiEnvKey} = ${cb.id}`),
      c.dim('  coding-bridge-mcp 启动时会按这个 provider 匹配对应的 KEY（API_KEY → SPARK_API_KEY / ARK_API_KEY）'),
      c.dim('  KEY 是独立的（见 "迅飞 KEY" / "火山 KEY"）'),
      c.dim('  按任意键返回'),
    ],
  });
  state._tuiEnv = null; state._tuiUpdated = null; state._tuiEnvKey = null; state._tuiSyncFn = null;
  state._context = 'review';
  state._render();
}
function _tuiPushKeyPanel(state, envKeyName, friendlyName, syncFn) {
  state._tuiEnvKey = envKeyName; state._tuiFriendly = friendlyName; state._tuiSyncFn = syncFn;
  state._context = 'review-key';
  const cur = readEnvKey(envKeyName);
  if (cur && cur.trim() !== '') {
    _panelOps.push(state, {
      kind: 'confirm',
      breadcrumb: '主菜单 > 外部 Review 供应商 > API key',
      title: `检测到已存在 ${envKeyName}`,
      question: `当前: ${maskValue(envKeyName, cur)}  →  是否修改？`,
      defaultYes: false,
    });
    state._tuiKeyConfirm = true;
  } else {
    _panelOps.push(state, {
      kind: 'input',
      breadcrumb: '主菜单 > 外部 Review 供应商 > API key',
      title: `请输入 ${friendlyName}`,
      prompt: envKeyName,
      hidden: false, // 明文显示方便复制粘贴后核对
      default: '',
    });
    state._tuiKeyInput = true;
  }
  state._render();
}
function _tuiFinalizeReview(state) {
  saveEnv(state._tuiEnv, state._tuiUpdated.size > 0);
  if (state._tuiSyncFn) { try { state._tuiSyncFn(); } catch (e) { err(`同步失败: ${e.message}`); } }
  if (state._tuiUpdated.has('CODING_BRIDGE_PROVIDER')) {
    try { syncSettingsAllow(); } catch {}
  }
  // 弹一个 message 面板展示结果
  // 注意：input panel 也没 push（confirm y 也没 push）——panelStack 顶仍是 review top
  _panelOps.replace(state, {
    kind: 'message',
    breadcrumb: '主菜单 > 外部 Review 供应商 > 结果',
    title: '✓ 已更新 .env',
    lines: [
      c.green(`  已更新键: ${[...state._tuiUpdated].join(', ') || '（无变化）'}`),
      '',
      c.dim('  提示：手动 `export $(cat .env | xargs)` 或在 shell rc 里 source .env 即可生效'),
      c.dim('  按任意键返回'),
    ],
  });
  // 清临时状态
  state._tuiEnv = null; state._tuiUpdated = null; state._tuiEnvKey = null; state._tuiFriendly = null; state._tuiSyncFn = null; state._tuiCbId = null; state._tuiKeyConfirm = false; state._tuiKeyInput = false;
  state._context = 'review';
  state._render();
}

// ─── Preset TUI 化 ─────────────────────────────────────
// 选中某预设 → 合并 env 到 ~/.claude/settings.json（深合并，保留其它字段）→ 弹结果
function _tuiPresetApply(state) {
  const choice = state.panel.options[state.subIdx];
  // _scanPresets 已填好完整 path（含 ~/.claude/ 或 global/json/ 来源）
  const presetPath = choice.path;
  if (!existsSync(presetPath)) {
    _panelOps.push(state, { kind: 'message', breadcrumb: state.panel.breadcrumb, title: '✗ 预设文件不存在', lines: [c.red(`  ${presetPath}`)] });
    state._render(); return;
  }
  const preset = readJSON(presetPath);
  if (!preset?.env) {
    _panelOps.push(state, { kind: 'message', breadcrumb: state.panel.breadcrumb, title: '✗ 预设缺少 env 段', lines: [c.dim(`  ${presetPath}`)] });
    state._render(); return;
  }
  const settings = readJSON(SETTINGS_JSON) || {};
  backupOnce(SETTINGS_JSON);
  const beforeKeys = Object.keys(settings.env || {});
  settings.env = { ...(settings.env || {}), ...preset.env };
  if (preset.model) settings.model = preset.model;
  atomicWriteJSON(SETTINGS_JSON, settings);
  // 弹结果 message
  const allKeys = Object.keys(preset.env);
  _panelOps.push(state, {
    kind: 'message',
    breadcrumb: '主菜单 > Claude Code 主供应商预设 > 结果',
    title: '✓ 已合并预设到 ~/.claude/settings.json',
    lines: [
      c.green(`  预设文件: ${choice.file}`),
      `  ANTHROPIC_BASE_URL = ${c.bold(preset.env.ANTHROPIC_BASE_URL || '（无）')}`,
      `  model = ${c.bold(preset.model || '（未设）')}`,
      c.dim(`  env 段已合并：${allKeys.length} 个键（其它字段 statusLine / enabledPlugins / permissions / extraKnownMarketplaces 保留）`),
      '',
      c.yellow('  提示：重启 Claude Code 让 env 生效'),
      c.dim('  按任意键返回主菜单'),
    ],
  });
  state._render();
}

// ─── Apply TUI 化 ──────────────────────────────────────
// 复用 _applyCore，结果以 message 面板展示
function _tuiApply(state) {
  const { lines, hasError } = _applyCore();
  _panelOps.push(state, {
    kind: 'message',
    breadcrumb: '主菜单 > 应用 > 结果',
    title: hasError ? '✗ 应用失败' : '✓ 应用完成',
    lines,
  });
  state._render();
}

// ─── 各主项的入口面板构造 ──────────────────────────────
function _panelReviewTop() {
  // 3 个独立 action：迅飞 KEY / 火山 KEY / 供应商
  // 注意：description 不能含 ANSI——必须纯文本；颜色在 _renderSubRow 里按 isSet 标志上
  const opts = REVIEW_ACTIONS.map(a => {
    const v = readEnvKey(a.envKey);
    const isSet = !!(v && v.trim() !== '');
    let status;
    if (a.id === 'provider') {
      status = v ? `${v} (已设)` : '未设置';
    } else {
      status = isSet ? '已设置' : '未设置';
    }
    return { id: a.id, label: a.label, description: `${a.envKey} = ${status}`, isSet };
  });
  return {
    kind: 'pick',
    _topEntry: true,
    breadcrumb: '主菜单 > 外部 Review 供应商',
    title: '操作（三项独立，可同时设）',
    options: opts,
    defaultIdx: 0,
  };
}
function _panelPreset() {
  const cur = readJSON(SETTINGS_JSON);
  const presets = _scanPresets();
  if (presets.length === 0) {
    return {
      kind: 'message',
      breadcrumb: '主菜单 > Claude Code 主供应商预设',
      title: '当前 env 线索 + 无预设',
      lines: [
        `  ANTHROPIC_BASE_URL = ${c.bold(cur?.env?.ANTHROPIC_BASE_URL || '（未设）')}`,
        `  model = ${c.bold(cur?.model || '（未设）')}`,
        '',
        c.yellow('  ~/.claude/ 下没找到任何预设 JSON'),
        c.dim('  每个预设需要含 env 段（ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN）'),
        c.dim('  命名随意：myproxy.json / openai-relay.json 等'),
      ],
    };
  }
  return {
    kind: 'pick',
    _topEntry: true,
    breadcrumb: '主菜单 > Claude Code 主供应商预设',
    title: '选择预设（合并到 ~/.claude/settings.json）',
    options: presets,
    // 高亮当前 active 预设（preset.env 是 settings.env 的 (key,value) 子集）
    defaultIdx: Math.max(0, presets.findIndex(p => p.active)),
  };
}
function _panelApply() {
  // .env 是 dotenv 格式（不是 JSON），用 loadEnv 解析
  const envMap = loadEnv().map;
  const dotenv = {};
  for (const v of envMap.values()) {
    if (typeof v === 'object' && v.line) {
      const m = v.line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) dotenv[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  const haveSpark = !!dotenv.SPARK_API_KEY;
  const haveArk = !!dotenv.ARK_API_KEY;
  const haveProvider = !!dotenv.CODING_BRIDGE_PROVIDER;
  const ready = haveSpark || haveArk;
  const spark = haveSpark ? c.green('已设置') : c.yellow('未设置');
  const ark = haveArk ? c.green('已设置') : c.yellow('未设置');
  const provider = haveProvider ? dotenv.CODING_BRIDGE_PROVIDER : c.yellow('未设置');
  const desc = `SPARK=${spark}  ARK=${ark}  PROVIDER=${provider}`;
  return {
    kind: 'pick',
    breadcrumb: '主菜单 > 应用 / 重启 Claude Code',
    title: ready ? '把 KEY 写入 ~/.claude.json mcpServers.coding-bridge.env' : '⚠ 缺 KEY，无法应用',
    options: [{ id: 'apply', label: ready ? '立即应用' : '无法应用', description: desc }],
    defaultIdx: 0,
  };
}
function _panelSubsystems() {
  const cur = readJSON(SETTINGS_JSON);
  const statusline = cur?.statusLine?.command || '（未设）';
  const lines = [
    ...SUBSYSTEMS.map(sub => {
      const status = checkSubsystemStatus(sub.id);
      const icon = status.ok ? c.green('✓') : c.yellow('○');
      return `  ${icon} ${c.bold(sub.label)} — ${c.dim(sub.description)}\n    ${c.dim(status.detail)}`;
    }),
    '',
    `  ${c.green('✓')} ${c.bold('Statusline / HUD')} — ${c.dim('ccstatusline-zh / omc-hud')}`,
    `    ${c.dim('当前 command: ' + statusline)}`,
    c.dim('  （statusline 走 symlink 装：./install.sh install-ccstatusline）'),
  ];
  return {
    kind: 'message',
    _topEntry: true,
    breadcrumb: '主菜单 > 辅助子模块（只读）',
    title: '子系统状态',
    lines,
  };
}
function _panelShowEnv() {
  const keys = ['REVIEW_PROVIDER', 'CODING_BRIDGE_PROVIDER', 'SPARK_API_KEY', 'ARK_API_KEY'];
  const lines = keys.map(k => {
    const v = readEnvKey(k);
    return `  ${c.bold(k)} = ${v ? c.green(maskValue(k, v)) : c.gray('(未设)')}`;
  });
  return {
    kind: 'message',
    _topEntry: true,
    breadcrumb: '主菜单 > 查看当前 .env',
    title: '当前 .env',
    lines,
  };
}

// 非 TTY 模式 / 降级路径用：打印关键 env 键
async function showCurrentEnv() {
  const panel = _panelShowEnv();
  out('');
  out(c.bold(panel.title));
  for (const line of panel.lines) out(line);
  out('');
  return 'continue';
}

async function main() {
  // 一次性 header（非 TTY 模式直接走原简单循环）
  if (!IS_TTY) {
    out(c.bold(c.cyan('dotclaude-portable 配置向导 v1.0.0')));
    out(c.dim(`  repo: ${REPO_ROOT}`));
    out(c.dim(`  home: ${HOME}`));
    out(c.dim(`  .env: ${ENV_FILE}${existsSync(ENV_FILE) ? '' : c.yellow(' (将创建)')}`));
    if (DRY_RUN) warn('--dry-run 模式：所有写操作只打印不落盘');
    while (true) {
      out('');
      const sel = await chooseHorizontal('主菜单', TOP_MENU.map(o => ({ label: o.label, description: o.description })));
      if (sel.quit || sel.back) { ok('bye'); break; }
      const idx = TOP_MENU.findIndex(o => o.label === sel.choice.label);
      const item = TOP_MENU[idx];
      let result = 'continue';
      try {
        if (item.id === 'review') result = await configureReviewProvider();
        else if (item.id === 'preset') result = await configureMainPreset();
        else if (item.id === 'apply') result = await configureApply();
        else if (item.id === 'subs') result = await configureSubsystems();
        else if (item.id === 'show') result = await showCurrentEnv();
      } catch (e) { err(`执行失败: ${e.message}`); if (!DRY_RUN) console.error(e); }
      if (result === 'quit') { ok('bye'); break; }
    }
    return;
  }

  // TTY 模式：分屏同显
  const state = {
    mainIdx: 0,
    subIdx: 0,
    focus: 'main', // 初始焦点在主菜单（让用户先选主项再操作子菜单）
    panel: _getEntryPanel(0),
    panelStack: [],
    // _context 标识当前 sub-panel 业务派发点；与 breadcrumb 文本解耦
    //   入口面板：'review' / 'preset' / 'apply' / 'subs' / 'show'
    //   下钻面板：'review-provider' / 'review-key'
    _context: 'review', // 初始化 = mainIdx 0 = review
    // TUI 化业务临时态
    _tuiEnv: null, _tuiUpdated: null, _tuiCbId: null,
    _tuiEnvKey: null, _tuiFriendly: null, _tuiSyncFn: null,
    _tuiKeyConfirm: false, _tuiKeyInput: false,
    _inputBuf: '',
    _render: () => _renderScreen(state),
  };
  // 同步 defaultIdx
  if (state.panel.kind === 'pick') state.subIdx = state.panel.defaultIdx ?? 0;

  state._render();
  let running = true;
  while (running) {
    const k = _parseKey(await _readKeypress());
    if (k === 'ctrl-c') { running = false; break; }
    // 全局 q/e 退出：仅在 pick/message 面板时；input/confirm 面板由分支自己处理
    if ((state.panel.kind === 'pick' || state.panel.kind === 'message')
        && (k === 'q' || k === 'Q' || k === 'e' || k === 'E' || k === 'esc')) {
      running = false; break;
    }

    // confirm / input 面板的按键单独处理
    if (state.panel.kind === 'confirm') {
      if (k === 'y' || k === 'Y') {
        if (state._tuiKeyConfirm) {
          // 走"修改"分支：直接替换 confirm → input（不 push，panelStack 顶仍是 review top）
          // 不设 hidden=true：明文显示方便复制粘贴后核对
          state.panel = {
            kind: 'input',
            breadcrumb: state.panel.breadcrumb,
            title: `请输入 ${state._tuiFriendly || state._tuiEnvKey}`,
            prompt: state._tuiEnvKey,
            hidden: false,
            default: '',
          };
          state._tuiKeyConfirm = false; state._tuiKeyInput = true;
          state._inputBuf = '';
          state._render();
        }
        continue;
      }
      if (k === 'n' || k === 'N') {
        if (state._tuiKeyConfirm) {
          // 保持现状 → 直接 finalize（不写 key）
          state._tuiKeyConfirm = false;
          _tuiFinalizeReview(state);
        }
        continue;
      }
      // 其它键忽略
      continue;
    }
    if (state.panel.kind === 'input') {
      if (k === 'enter' || k === '\r' || k === '\n') {
        if (state._tuiKeyInput) {
          // trim：API key 首尾空格会致鉴权失败（保留中间空格）
          const val = state._inputBuf.trim();
          state._inputBuf = '';
          state._tuiKeyInput = false;
          const cur = readEnvKey(state._tuiEnvKey);
          if (val && val !== cur) {
            setEnvKey(state._tuiEnv.map, state._tuiEnvKey, val);
            state._tuiUpdated.add(state._tuiEnvKey);
          }
          // input 流程不 push（confirm y 也没 push）—— panelStack 顶仍是 review top
          _tuiFinalizeReview(state);
        }
        continue;
      }
      if (k === 'backspace' || k === '\x7f' || k === '\b') {
        state._inputBuf = state._inputBuf.slice(0, -1);
        state._render();
        continue;
      }
      if (k === 'ctrl-c' || k === 'q' || k === 'Q' || k === 'esc') { running = false; break; }
      if (k.length === 1 && k >= ' ' && k <= '~') {
        // 字符模式下不重画全屏（避免 stdout 写阻塞导致后续 stdin onData 延迟）
        // 直接更新光标行。接受所有可打印 ASCII（含 : $ 等 API key 常见字符）；
        // 转义由 atomicWriteJSON 的 JSON.stringify 处理。
        state._inputBuf += k;
        const display = state.panel.hidden ? partialMask(state._inputBuf) : state._inputBuf;
        process.stdout.write(`\r\x1b[2K  ${state.panel.prompt}: ${c.cyan(display || '_')}`);
        continue;
      }
      continue;
    }

    // 全局导航
    if (k === 'left') {
      // 左右键：始终切主项（无论焦点在哪）；同时把焦点带到主菜单
      state.mainIdx = (state.mainIdx - 1 + TOP_MENU.length) % TOP_MENU.length;
      state.panel = _getEntryPanel(state.mainIdx);
      state.subIdx = (state.panel.kind === 'pick' ? (state.panel.defaultIdx ?? 0) : 0);
      state.panelStack = [];
      state._context = TOP_MENU[state.mainIdx].id;
      state.focus = 'main';
      state._render(); continue;
    }
    if (k === 'right') {
      // 左右键：始终切主项（无论焦点在哪）；同时把焦点带到主菜单
      state.mainIdx = (state.mainIdx + 1) % TOP_MENU.length;
      state.panel = _getEntryPanel(state.mainIdx);
      state.subIdx = (state.panel.kind === 'pick' ? (state.panel.defaultIdx ?? 0) : 0);
      state.panelStack = [];
      state._context = TOP_MENU[state.mainIdx].id;
      state.focus = 'main';
      state._render(); continue;
    }
    if (k === 'tab') {
      state.focus = state.focus === 'main' ? 'sub' : 'main';
      state._render(); continue;
    }
    if (k === 'down') {
      if (state.focus === 'main') { state.focus = 'sub'; }
      else if (state.panel.kind === 'pick') { state.subIdx = (state.subIdx + 1) % state.panel.options.length; }
      state._render(); continue;
    }
    if (k === 'up') {
      if (state.focus === 'sub' && state.subIdx === 0) { state.focus = 'main'; }
      else if (state.focus === 'sub' && state.panel.kind === 'pick') { state.subIdx = (state.subIdx - 1 + state.panel.options.length) % state.panel.options.length; }
      else if (state.focus === 'main') {
        state.mainIdx = (state.mainIdx - 1 + TOP_MENU.length) % TOP_MENU.length;
        state.panel = _getEntryPanel(state.mainIdx);
        state.subIdx = (state.panel.kind === 'pick' ? (state.panel.defaultIdx ?? 0) : 0);
        state.panelStack = [];
        state._context = TOP_MENU[state.mainIdx].id;
      }
      state._render(); continue;
    }

    // 主区在焦点时：1-9 直选主项
    if (state.focus === 'main' && k >= '1' && k <= '9') {
      const n = parseInt(k, 10) - 1;
      if (n >= 0 && n < TOP_MENU.length) {
        state.mainIdx = n; state.panel = _getEntryPanel(state.mainIdx);
        state.subIdx = (state.panel.kind === 'pick' ? (state.panel.defaultIdx ?? 0) : 0);
        state.panelStack = [];
        state._context = TOP_MENU[state.mainIdx].id;
      }
      state._render(); continue;
    }

    // 子区在焦点时
    if (state.focus === 'sub' && state.panel.kind === 'pick') {
      if (k >= '1' && k <= '9') {
        const n = parseInt(k, 10) - 1;
        if (n >= 0 && n < state.panel.options.length) { state.subIdx = n; state._render(); continue; }
      }
      if (k === 'enter') {
        // 派发：review / preset 走 TUI 流程；其它业务走降级路径
        if (state._context === 'review-provider') {
          // 选完供应商 → 写 env + 弹结果
          _tuiReviewProviderSelected(state);
        } else if (state._context === 'review') {
          _tuiReviewRun(state);
        } else if (state._context === 'preset') {
          _tuiPresetApply(state);
        } else if (state._context === 'apply') {
          _tuiApply(state);
        } else {
          await _handleSubPickLegacy(state);
        }
        continue;
      }
    }
    // message 面板：任意键回主区（出栈恢复上一面板）
    if (state.focus === 'sub' && state.panel.kind === 'message' && k.length > 0) {
      if (state.panelStack.length > 0) {
        state.panel = state.panelStack.pop();
        // 出栈后强制重生成主项入口 panel——因为下钻流程里改过 .env，
        // 原 panel 对象已缓存旧状态（isSet=false 等）；不重生成会显示陈旧
        if (state.panel._topEntry) {
          state.panel = _getEntryPanel(state.mainIdx);
          state._context = TOP_MENU[state.mainIdx].id; // 重生成后同步 _context
        } else {
          // 非入口面板（说明是 _tuiPresetApply / _tuiApply 的下钻 message 出栈）
          // 沿用之前 _tui* 设置的 _context（已在 _tui* 函数里设好）
        }
        state.subIdx = (state.panel.kind === 'pick' ? (state.panel.defaultIdx ?? 0) : 0);
        state.focus = 'sub'; // 弹出后保留子区焦点（用户可继续操作子项）
      } else {
        state.focus = 'main';
      }
      state._render();
      continue;
    }
  }
  _clearScreen();
  ok('bye');
  // 显式 exit：避免 _startKpCollector / kpWaiters 残留导致 stdin 监听挂住
  process.exit(0);
}

async function _handleSubPickLegacy(state) {
  // 非 review 业务的降级路径：临时切回数字键模式
  if (!IS_TTY) return;
  const stdin = process.stdin;
  if (stdin.isRaw) { stdin.setRawMode(false); stdin.pause(); }
  _clearScreen();
  out(c.bold(c.cyan('━━━ 业务执行中（临时切到数字键模式）━━━')));
  out('');
  const item = TOP_MENU[state.mainIdx];
  let result = 'continue';
  try {
    if (item.id === 'preset') result = await configureMainPreset();
    else if (item.id === 'apply') result = await configureApply();
    else if (item.id === 'subs') result = await configureSubsystems();
    else if (item.id === 'show') result = await showCurrentEnv();
  } catch (e) { err(`执行失败: ${e.message}`); if (!DRY_RUN) console.error(e); }
  out('');
  out(c.dim('  按回车返回 TUI 主菜单...'));
  await _nextLine();
  _kpStarted = false;
  _kpBuf = ''; _kpQueue.length = 0; _kpWaiters.length = 0;
  state._render();
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
