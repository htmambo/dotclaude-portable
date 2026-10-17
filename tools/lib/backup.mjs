// tools/lib/backup.mjs — 公共 backupOnce（自 install.mjs + configure.mjs 抽离）
// 仅首次备份；symlink 跳过；命名 = `<file>.bak.YYYYMMDDHHMMSS`。
'use strict';

import { existsSync, readdirSync, copyFileSync, lstatSync, rmSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';

export function backupOnce(file) {
  if (!existsSync(file)) return null;
  try { if (lstatSync(file).isSymbolicLink()) return null; } catch {}
  const dir = dirname(file);
  const base = basename(file);
  const existing = readdirSync(dir).filter(f => f.startsWith(base + '.bak.'));
  if (existing.length > 0) return null;
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const bak = `${file}.bak.${ts}`;
  copyFileSync(file, bak);
  return bak;
}

// pruneFileBackups：清理 `<file>.bak.*` 旧备份，只保留最新 keep 个
// （时间戳命名，按名称倒序即最新在前）
export function pruneFileBackups(file, keep = 3) {
  const dir = dirname(file);
  const base = basename(file);
  let names;
  try { names = readdirSync(dir).filter(f => f.startsWith(base + '.bak.')); }
  catch { return []; }
  names.sort().reverse();
  const removed = [];
  for (const f of names.slice(keep)) {
    try { rmSync(join(dir, f)); removed.push(f); } catch {}
  }
  return removed;
}
