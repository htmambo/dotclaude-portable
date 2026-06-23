#!/usr/bin/env node
// UserPromptSubmit 守卫:用会话 transcript 文件大小近似当前请求体大小,
// 接近 API 32MB 上限时通过 systemMessage 提醒用户——趁 /compact 仍可成功时主动处理。
// 注意:transcript 大小是请求体的近似代理,不是精确值;hook 拿不到真实请求体字节数。
import { readFileSync, statSync } from 'node:fs';

const MB = 1024 * 1024;
const WARN_SOFT = 24 * MB;      // 温和提醒 — 给系统提示与本轮留 ~8MB 余量
const WARN_HARD = 28 * MB;      // 强烈警告 — 余量仅 ~4MB,失败风险陡升
const WARN_CRITICAL = 30 * MB;  // 紧急 — 提交可能直接被 API 拒绝

let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { process.exit(0); }

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

const t = input.transcript_path;
if (!t) process.exit(0);

let size = 0;
try { size = statSync(t).size; } catch { process.exit(0); }

if (size < WARN_SOFT) process.exit(0); // ≥24MB 才警告,与原版 `size > WARN` 一致

const mb = Math.round(size / MB);
let message;
if (size >= WARN_CRITICAL) {
  message = `🚨 transcript 已 ${mb}MB,逼近 API 32MB 请求上限。当前提交大概率失败。请立刻 /clear(关键成果先落盘),不要继续读入任何图片或大文件。`;
} else if (size >= WARN_HARD) {
  message = `⚠️ transcript 已 ${mb}MB,距 32MB 仅 ~4MB。请先保存关键成果,立即 /compact;暂停读入图片/大文件,避免被迫 /clear。`;
} else {
  message = `💡 transcript 已 ${mb}MB,接近 API 32MB 请求上限。趁 /compact 仍可成功:请先保存关键成果,再 /compact;暂停读入图片/大文件。`;
}

process.stdout.write(JSON.stringify({ systemMessage: message }));
process.exit(0);
