#!/usr/bin/env node
// sync-docs.mjs — keep README Hooks section in sync with hooks/*.mjs.
// 范围(最小): 只追加缺失的 hook bullet 到 README Hooks 章节,不改任何已有行。
// CHANGELOG / install.mjs MAP / README 同步表: 全不动(人工维护)。
// 用法:
//   node scripts/sync-docs.mjs           # dry-run:列出将追加的 bullet
//   node scripts/sync-docs.mjs --apply   # 真追加到 README
//   node scripts/sync-docs.mjs --check   # git pre-commit:缺失则 exit 1
'use strict';

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const README_PATH = join(ROOT, 'README.md');
const HOOKS_DIR = join(ROOT, 'hooks');

// 从 hook 文件头提取 one-liner 描述。
// 约定:第 2 行起第一个 // 或 # 注释为描述。
function hookOneLiner(absPath) {
  const lines = readFileSync(absPath, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#!')) continue;
    const m = t.match(/^(?:\/\/|#)\s*(.+)/);
    if (m) return m[1].trim();
    return '(no description)';
  }
  return '(no description)';
}

// 检测 README 中 Hooks 章节下哪些 hook 名已被记录。
function existingHooksInReadme(text) {
  // 按行扫描:进入 Hooks 章节后,直到下一个 ##/### 跳出,扫 bullet 中的 hook 名。
  // 比 regex 更可靠,避开 multiline + lookahead + 中英标点陷阱。
  const lines = text.split('\n');
  const hooks = new Set();
  let inSection = false;
  const re = /hooks\/([a-zA-Z0-9_-]+\.(?:mjs|sh))/g;
  for (const line of lines) {
    if (/^### Hooks\b/.test(line)) { inSection = true; continue; }
    if (inSection && /^## /.test(line)) break;
    if (inSection && /^### /.test(line)) break;
    if (!inSection) continue;
    let m;
    while ((m = re.exec(line)) !== null) hooks.add(m[1]);
  }
  return { hooks };
}

function listHookFiles() {
  if (!existsSync(HOOKS_DIR)) return [];
  return readdirSync(HOOKS_DIR)
    .filter(f => /\.(mjs|sh)$/.test(f))
    .sort();
}

// 构造新 bullet: `- `hooks/<f>.mjs` — <one-liner>`
// 反引号在 desc 里会破坏 markdown 嵌套,替换为中文「」或脱敏
function buildBullet(filename) {
  let desc = hookOneLiner(join(HOOKS_DIR, filename));
  desc = desc.replace(/`/g, '「').replace(/\*/g, '·');
  return `- \`hooks/${filename}\` — ${desc}`;
}

function findInsertionLine(text) {
  // Hooks 章节的 bullet 行最后一行是 "Auto-deploy: ..." (固定)
  // 在 Auto-deploy 行之前插入新 bullet。
  // 若 Hooks 章节不存在或 Auto-deploy 行不存在,返回 -1。
  const lines = text.split('\n');
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^### Hooks\b/.test(lines[i])) { inSection = true; continue; }
    // README 用 ## H2 跳章节(下一节),### H3 也兜底
    if (inSection && /^## /.test(lines[i])) { inSection = false; continue; }
    if (inSection && /^### /.test(lines[i])) { inSection = false; continue; }
    // 中文 README 多用全角冒号 U+FF1A,ASCII ':' 兜底
    if (inSection && /^- Auto-deploy[：:]/.test(lines[i])) return i;
  }
  return -1;
}

function sync(dryRun) {
  const text = readFileSync(README_PATH, 'utf8');
  const { hooks: existing } = existingHooksInReadme(text);
  const onDisk = listHookFiles();
  const missing = onDisk.filter(f => !existing.has(f));

  if (missing.length === 0) return { changes: [], alreadyInSync: true };

  const insertAt = findInsertionLine(text);
  if (insertAt === -1) {
    return {
      changes: [],
      error: 'Hooks section or Auto-deploy line not found in README',
    };
  }

  const newBullets = missing.map(buildBullet);

  // dry-run 也更新 in-memory text 用于核对
  if (dryRun === 'check') {
    return { changes: missing.map((f, i) => ({ file: f, bullet: newBullets[i] })), alreadyInSync: false };
  }

  const lines = text.split('\n');
  lines.splice(insertAt, 0, ...newBullets);
  const updated = lines.join('\n');
  if (!dryRun) writeFileSync(README_PATH, updated);

  return {
    changes: missing.map((f, i) => ({ file: f, bullet: newBullets[i] })),
    alreadyInSync: false,
  };
}

// 入口
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const check = args.includes('--check');

const result = sync(check ? 'check' : (apply ? false : true));

if (result.error) {
  console.error(`[sync-docs] ERROR: ${result.error}`);
  console.error('  Fix: ensure README has "### Hooks (N 已落地)" section with "- Auto-deploy:" line');
  process.exit(2);
}

if (result.alreadyInSync) {
  const msg = '[sync-docs] OK — README Hooks section covers all hook files';
  if (check) console.log(msg); else console.log(msg);
  process.exit(0);
}

console.log(`[sync-docs] ${apply ? 'APPLY' : (check ? 'CHECK-FAIL' : 'DRY-RUN')} — ${result.changes.length} hook(s) missing in README:`);
for (const c of result.changes) {
  console.log(`  + ${c.bullet}`);
}

if (check) {
  console.error('\nFix: run `node scripts/sync-docs.mjs --apply`');
  process.exit(1);
}

if (apply) {
  // 触发真写
  sync(false);
  console.log('\n[sync-docs] applied to README.md');
}
