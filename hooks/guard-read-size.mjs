#!/usr/bin/env node
// PreToolUse(Read) 守卫:在读取前拦截过大文件 / 图片,避免撑爆 API 32MB 请求体。
// 输入:stdin 收到 hook JSON;输出:超阈值时打印 deny JSON,否则静默放行。
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const IMG_MAX = 2 * 1024 * 1024; // 图片/PDF 阈值,默认 2MB
const TXT_MAX = 5 * 1024 * 1024; // 文本阈值,默认 5MB
// 媒体扩展名走 IMG_MAX 分支;包含压缩档是因其 base64 后膨胀更剧烈,且常被误读为文本。
const MEDIA = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'pdf', 'gz', 'zip', 'tar', 'bz2', '7z', 'rar', 'xz', 'zst'];

let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { process.exit(0); }

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

// 只管 Read;其它工具直接放行
if (input.tool_name !== 'Read') process.exit(0);
const file = input.tool_input?.file_path;
if (file == null || typeof file !== 'string') process.exit(0);

let size = 0;
let stat;
try { stat = statSync(file); } catch { process.exit(0); } // 文件不存在等 → 放行
if (!stat.isFile()) process.exit(0); // 目录/设备/FIFO 不适用体积阈值,放行
size = stat.size;

const mb = (n) => (n / 1024 / 1024).toFixed(1);
// 用 path.extname 替代 split('.') — 无扩展名文件(extname 返回 '')自然归入 txt 分支,
// 复合扩展如 archive.tar.gz 也只取最后一段 (.gz),与 MEDIA 列表匹配更明确。
const ext = extname(file).slice(1).toLowerCase();
const isMedia = MEDIA.includes(ext);

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

if (isMedia && size > IMG_MAX) {
  deny(`拦截:${file} 是 ${mb(size)}MB 的图片/PDF/压缩档。base64 编码后膨胀约 1/3 且会永久占用上下文(/compact 也清不掉),极易撑爆 32MB 请求上限。如确需,请先压缩/裁剪,或改取其文本内容。`);
}
if (!isMedia && size > TXT_MAX) {
  deny(`拦截:${file} 有 ${mb(size)}MB,过大。请改用 Read 的 offset/limit 分段读取,或用 Grep 定位关键行,避免一次性灌入上下文。`);
}

process.exit(0);
