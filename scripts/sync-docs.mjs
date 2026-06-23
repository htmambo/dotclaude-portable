#!/usr/bin/env node
// sync-docs.mjs — keep README in sync with hooks/, commands/, skills/.
// 范围: hooks → README Hooks 章节追加 bullet;
//       commands/skills → README 同步表追加表格行。
// CHANGELOG / install.mjs MAP / README 同步表非 commands/skills 行: 全不动(人工维护)。
// 用法:
//   node scripts/sync-docs.mjs           # dry-run
//   node scripts/sync-docs.mjs --apply   # 真改
//   node scripts/sync-docs.mjs --check   # git pre-commit:缺失则 exit 1
'use strict';

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const README_PATH = join(ROOT, 'README.md');
const HOOKS_DIR = join(ROOT, 'hooks');
const COMMANDS_DIR = join(ROOT, 'commands');
const SKILLS_DIR = join(ROOT, 'skills');

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

function mdFrontmatterDesc(absPath) {
  const text = readFileSync(absPath, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const desc = m[1].match(/^description:\s*(.+)$/m);
  return desc ? desc[1].trim() : null;
}

function sanitize(s) {
  return s.replace(/`/g, '「').replace(/\*/g, '·');
}

function listHookFiles() {
  if (!existsSync(HOOKS_DIR)) return [];
  return readdirSync(HOOKS_DIR).filter(f => /\.(mjs|sh)$/.test(f)).sort();
}
function listCommandFiles() {
  if (!existsSync(COMMANDS_DIR)) return [];
  return readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.md')).sort();
}
function listSkillDirs() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter(d => existsSync(join(SKILLS_DIR, d, 'SKILL.md')))
    .sort();
}

function buildHookBullet(filename) {
  const desc = hookOneLiner(join(HOOKS_DIR, filename));
  return `- \`hooks/${filename}\` — ${sanitize(desc)}`;
}

function buildCommandRow(filename) {
  const desc = mdFrontmatterDesc(join(COMMANDS_DIR, filename));
  const base = `| \`commands/${filename}\` | \`commands/${filename}\` | symlink |`;
  return desc ? base.replace(/symlink \|/, `symlink（${sanitize(desc)}） |`) : base;
}
function buildSkillRow(dir) {
  const desc = mdFrontmatterDesc(join(SKILLS_DIR, dir, 'SKILL.md'));
  const base = `| \`skills/${dir}/SKILL.md\` | \`skills/${dir}/SKILL.md\` | symlink |`;
  return desc ? base.replace(/symlink \|/, `symlink（${sanitize(desc)}） |`) : base;
}

function existingHooksInReadme(text) {
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
function findHookInsertionLine(text) {
  const lines = text.split('\n');
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^### Hooks\b/.test(lines[i])) { inSection = true; continue; }
    if (inSection && /^## /.test(lines[i])) { inSection = false; continue; }
    if (inSection && /^### /.test(lines[i])) { inSection = false; continue; }
    if (inSection && /^- Auto-deploy[：:]/.test(lines[i])) return i;
  }
  return -1;
}

function existingCommandsAndSkillsInReadme(text) {
  const lines = text.split('\n');
  const commands = new Set();
  const skills = new Set();
  let inSection = false;
  const cmdRe = /`commands\/([a-zA-Z0-9_-]+\.md)`/;
  const sklRe = /`skills\/([a-zA-Z0-9_-]+)\/SKILL\.md`/;
  for (const line of lines) {
    if (!inSection) {
      if (cmdRe.test(line)) inSection = true;
      else continue;
    }
    if (cmdRe.test(line)) {
      const m = line.match(cmdRe);
      commands.add(m[1]);
      continue;
    }
    if (sklRe.test(line)) {
      const m = line.match(sklRe);
      skills.add(m[1]);
      continue;
    }
    if (/^\|/.test(line) && !cmdRe.test(line) && !sklRe.test(line)) break;
    if (/^##\s/.test(line)) break;
  }
  return { commands, skills };
}
function findTableInsertionLine(text) {
  const lines = text.split('\n');
  const cmdRe = /`commands\/[a-zA-Z0-9_-]+\.md`/;
  const sklRe = /`skills\/[a-zA-Z0-9_-]+\/SKILL\.md`/;
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\|/.test(line)) continue;
    if (cmdRe.test(line) || sklRe.test(line)) lastIdx = i;
    else if (lastIdx !== -1) return lastIdx + 1;
  }
  return -1;
}

function sync(dryRun) {
  const text = readFileSync(README_PATH, 'utf8');
  const allChanges = [];

  const { hooks: existingHooks } = existingHooksInReadme(text);
  const onDiskHooks = listHookFiles();
  const missingHooks = onDiskHooks.filter(f => !existingHooks.has(f));
  if (missingHooks.length > 0) {
    const insertAt = findHookInsertionLine(text);
    if (insertAt === -1) return { error: 'Hooks section or Auto-deploy line not found in README' };
    allChanges.push({ kind: 'hooks', insertAt, lines: missingHooks.map(buildHookBullet) });
  }

  const { commands: existingCmds, skills: existingSkls } = existingCommandsAndSkillsInReadme(text);
  const onDiskCmds = listCommandFiles();
  const onDiskSkls = listSkillDirs();
  const missingCmds = onDiskCmds.filter(f => !existingCmds.has(f));
  const missingSkls = onDiskSkls.filter(d => !existingSkls.has(d));
  if (missingCmds.length > 0 || missingSkls.length > 0) {
    const insertAt = findTableInsertionLine(text);
    if (insertAt === -1) return { error: 'README sync table commands/skills sub-section not found' };
    const newRows = [...missingCmds.map(buildCommandRow), ...missingSkls.map(buildSkillRow)];
    allChanges.push({ kind: 'table', insertAt, lines: newRows });
  }

  if (allChanges.length === 0) return { changes: [], alreadyInSync: true };

  if (dryRun === 'check') {
    return {
      changes: allChanges.flatMap(c => c.lines.map(line => ({ kind: c.kind, line }))),
      alreadyInSync: false,
    };
  }
  const lines = text.split('\n');
  const sorted = [...allChanges].sort((a, b) => b.insertAt - a.insertAt);
  for (const c of sorted) lines.splice(c.insertAt, 0, ...c.lines);
  const updated = lines.join('\n');
  if (!dryRun) writeFileSync(README_PATH, updated);

  return {
    changes: allChanges.flatMap(c => c.lines.map(line => ({ kind: c.kind, line }))),
    alreadyInSync: false,
  };
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const check = args.includes('--check');

const result = sync(check ? 'check' : (apply ? false : true));

if (result.error) {
  console.error(`[sync-docs] ERROR: ${result.error}`);
  process.exit(2);
}

if (result.alreadyInSync) {
  console.log('[sync-docs] OK — README in sync with hooks/commands/skills');
  process.exit(0);
}

console.log(`[sync-docs] ${apply ? 'APPLY' : (check ? 'CHECK-FAIL' : 'DRY-RUN')} — ${result.changes.length} item(s) missing:`);
for (const c of result.changes) {
  console.log(`  [${c.kind}] ${c.line}`);
}

if (check) {
  console.error('\nFix: run `node scripts/sync-docs.mjs --apply`');
  process.exit(1);
}

if (apply) {
  sync(false);
  console.log('\n[sync-docs] applied to README.md');
}
