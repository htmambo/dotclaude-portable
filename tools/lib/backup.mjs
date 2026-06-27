// tools/lib/backup.mjs — 公共 backupOnce（自 install.mjs + configure.mjs 抽离）
// 仅首次备份；symlink 跳过；命名 = `<file>.bak.YYYYMMDDHHMMSS`。
'use strict';

import { existsSync, readdirSync, copyFileSync, lstatSync } from 'node:fs';
import { dirname, basename } from 'node:path';

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