#!/usr/bin/env node
// review-watchdog: PostToolUse hook for Write|Edit on code files.
// 职责（§1.5 循环审核协议）：
//   1) 落盘 sessionId 到 ~/.claude/state/last-session-<encoded-cwd> 供 commit-msg hook 读取
//   2) 解析 transcript 最后一次 review tool_result 的 verdict
//   3) 区分 NO_REVIEW / IN_FLIGHT / HAS_RESULT 三态，避免审核进行中误报"未检测到"
//   4) 若上次 verdict 未通过（REJECTED/NEEDS_CHANGES/UNKNOWN）-> 提示修复后重审
// 非阻塞（exit 0）；constraint-level 规则，非强制。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { homedir } from 'node:os';

const CODE_EXTS = new Set([
  '.py', '.ts', '.js', '.tsx', '.jsx', '.go', '.rs',
  '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.sh', '.sql',
]);
const CONFIG_FILES = new Set([
  'pyproject.toml', 'package.json', 'Cargo.toml', 'go.mod',
  'tsconfig.json', 'requirements.txt', 'Pipfile',
]);
const SKIP_PATH_PREFIXES = ['docs/', '.omc/'];
const SKIP_PATH_SUFFIXES = ['.md', '.markdown'];

const REVIEW_TOOL_NAMES = new Set([
  'mcp__coding-bridge__review_code',
  'mcp__coding-bridge__review_plan',
  'mcp__kimi__kimi',
  'mcp__codex__codex',
]);

const MAX_ROUNDS = process.env.REVIEW_MAX_ROUNDS || 5;

function isCodeFile(filePath) {
  if (!filePath) return false;
  const norm = filePath.replace(/\\/g, '/');
  for (const pre of SKIP_PATH_PREFIXES) {
    if (norm.includes(`/${pre}`) || norm.startsWith(pre)) return false;
  }
  for (const suf of SKIP_PATH_SUFFIXES) {
    if (norm.endsWith(suf)) return false;
  }
  const name = basename(norm);
  if (CONFIG_FILES.has(name)) return true;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return CODE_EXTS.has(name.slice(dot).toLowerCase());
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function encodeCwd(cwd) {
  // 与 findTranscript 的 encoded 形式一致，跨 bash/python 可复现
  return cwd.replace(/^\//, '-').replace(/\//g, '-');
}

function findTranscript() {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) return null;
  const encoded = encodeCwd(process.cwd());
  return resolve(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
}

// 落盘 sessionId 供 commit-msg hook 读取（best-effort，永不抛错）
function persistSessionId() {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) return;
  const encoded = encodeCwd(process.cwd());
  const stateDir = resolve(homedir(), '.claude', 'state');
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      resolve(stateDir, `last-session-${encoded}`),
      JSON.stringify({ sessionId, cwd: process.cwd(), ts: Date.now() }),
      'utf8',
    );
  } catch {
    // 落盘失败不影响 hook 主流程
  }
}

// 从 tool_result.content 提取 verdict（契约见 §1.5 + docs/samples/）
// 返回 APPROVED | REJECTED | NEEDS_CHANGES | UNKNOWN
function extractVerdict(toolResultContent) {
  let textStr = '';
  if (Array.isArray(toolResultContent)) {
    textStr = toolResultContent
      .filter((c) => c && c.type === 'text')
      .map((c) => c.text || '')
      .join('\n');
  } else if (typeof toolResultContent === 'string') {
    textStr = toolResultContent;
  }
  if (!textStr) return 'UNKNOWN';

  // 解析外层 JSON -> result.agent_messages
  let agentMessages = '';
  try {
    const parsed = JSON.parse(textStr);
    agentMessages = (parsed && parsed.result && parsed.result.agent_messages) || '';
  } catch {
    agentMessages = textStr; // 兜底：文本本身即 agent_messages
  }
  if (!agentMessages) return 'UNKNOWN';

  // (a) ```json fence 内 JSON 的 verdict 字段（kimi 形态）
  const fence = agentMessages.match(/```json\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const j = JSON.parse(fence[1]);
      if (j && j.verdict) return normalizeVerdictWord(j.verdict);
    } catch {
      // fence 内非合法 JSON，落 (b)
    }
  }
  // (b) markdown 多级提取（coding-bridge 形态）；各级均取最后一个匹配，
  //     规避正文前言先提及 APPROVED/REJECTED 导致误判（§1.5 契约要求 last-match）
  // b1: 加粗 **VERDICT**（review_plan 的 "## Verdict\n\n**REJECTED**"）
  const boldAll = [...agentMessages.matchAll(/\*\*(APPROVED|REJECTED|NEEDS_CHANGES)\*\*/g)];
  if (boldAll.length) return normalizeVerdictWord(boldAll[boldAll.length - 1][1]);
  // b2: 标题 "审查结论：VERDICT" / "Verdict: VERDICT"（review_code 形态）
  const titleAll = [...agentMessages.matchAll(/(?:审查结论|Verdict|verdict)[:：]\s*\*{0,2}(APPROVED|REJECTED|NEEDS_CHANGES)\b/g)];
  if (titleAll.length) return normalizeVerdictWord(titleAll[titleAll.length - 1][1]);
  // b3: 兜底取最后一个裸词匹配（verdict 段通常在回复末尾）
  const all = [...agentMessages.matchAll(/\b(APPROVED|REJECTED|NEEDS_CHANGES)\b/g)];
  if (all.length) return normalizeVerdictWord(all[all.length - 1][1]);
  return 'UNKNOWN';
}

function normalizeVerdictWord(v) {
  const u = String(v).toUpperCase().trim();
  if (u === 'APPROVED') return 'APPROVED';
  if (u === 'REJECTED' || u === 'NEEDS_CHANGES') return u;
  return 'UNKNOWN';
}

// 扫 transcript，返回 {state, verdict?, toolName?}
// state: NO_REVIEW（无 review tool_use）| IN_FLIGHT（有 use 无 result）| HAS_RESULT
function parseLastReviewVerdict(path) {
  if (!path) return { state: 'NO_REVIEW' };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { state: 'NO_REVIEW' };
  }

  const lines = text.split('\n');
  // Pass 1: 收集 review tool_use id -> name
  const useIds = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const content = obj && obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c && c.type === 'tool_use' && REVIEW_TOOL_NAMES.has(c.name)) {
        useIds.set(c.id, c.name);
      }
    }
  }
  if (useIds.size === 0) return { state: 'NO_REVIEW' };

  // Pass 2: 找最后一个 review tool_result
  let last = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const content = obj && obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c && c.type === 'tool_result' && useIds.has(c.tool_use_id)) {
        const verdict = extractVerdict(c.content);
        last = { verdict, toolName: useIds.get(c.tool_use_id) };
      }
    }
  }
  if (!last) return { state: 'IN_FLIGHT' };
  return { state: 'HAS_RESULT', verdict: last.verdict, toolName: last.toolName };
}

function main() {
  const raw = readStdin();
  if (!raw) return 0;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return 0;
  }

  const toolName = payload.tool_name || '';
  if (toolName !== 'Write' && toolName !== 'Edit') return 0;

  const filePath = payload.tool_input && payload.tool_input.file_path;
  if (!filePath || !isCodeFile(filePath)) return 0;

  // 始终落盘 sessionId（供 nudge-review.sh commit-msg hook 读取）
  persistSessionId();

  const r = parseLastReviewVerdict(findTranscript());

  if (r.state === 'NO_REVIEW') {
    process.stderr.write(
      `[review-watchdog] 触及代码文件 ${filePath}，本会话未检测到 runReview 调用。\n` +
      `如已调请忽略；如未调请补 runReview({kind:"code"})。\n`,
    );
    return 0;
  }

  if (r.state === 'IN_FLIGHT') {
    // 审核进行中（tool_use 已发，result 未回写）；温和提示，不误报"未检测到"
    process.stderr.write(
      `[review-watchdog] 触及代码文件 ${filePath}，本会话有审核进行中（result 未回写）。\n` +
      `建议等待审核结果再继续改码，避免在 REJECTED 前提下叠加修改。\n`,
    );
    return 0;
  }

  // HAS_RESULT
  if (r.verdict === 'APPROVED') {
    // 上轮已通过；APPROVED 后的代码变更由 commit 闸门把关，此处不噪音
    return 0;
  }

  // REJECTED / NEEDS_CHANGES / UNKNOWN -> §1.5 循环提醒
  process.stderr.write(
    `[review-watchdog] 上次审核 verdict=${r.verdict}（${r.toolName}）未通过。\n` +
    `§1.5 循环审核协议：修复 risks 后须重新调用同 kind review 直至 APPROVED（Round ≤ ${MAX_ROUNDS}）。\n` +
    `当前修改 ${filePath}，完成后请补 runReview({kind:"code"})。\n`,
  );
  return 0;
}

main();
