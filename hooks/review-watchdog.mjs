#!/usr/bin/env node
// review-watchdog: PostToolUse hook for Write|Edit on code files.
// Reads tool payload from stdin, scans session transcript for runReview calls,
// emits a stderr warning if a code file was touched without runReview this turn.
// Exit 0 in all cases (non-blocking; constraint-level rule, not enforcement).

import { readFileSync } from 'node:fs';
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

function findTranscript() {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) return null;
  const cwd = process.cwd();
  // Claude Code stores transcripts under ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
  // where encoded-cwd = cwd with leading '/' -> '-' and all remaining '/' -> '-'.
  const encoded = cwd.replace(/^\//, '-').replace(/\//g, '-');
  const candidate = resolve(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
  return candidate;
}

function transcriptHasRunReview(path) {
  if (!path) return false;
  try {
    const text = readFileSync(path, 'utf8');
    // Cheap heuristics: any of the tool names or the unified helper appears in the tail.
    const tail = text.slice(-200_000); // last ~200KB is enough for one turn
    return /runReview|review_code|review_plan|mcp__coding-bridge__/.test(tail);
  } catch {
    return false;
  }
}

function main() {
  const raw = readStdin();
  if (!raw) return 0;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return 0; // unparseable: silent pass-through
  }

  const toolName = payload.tool_name || '';
  if (toolName !== 'Write' && toolName !== 'Edit') return 0;

  const filePath = payload.tool_input?.file_path || '';
  if (!isCodeFile(filePath)) return 0;

  const transcript = findTranscript();
  if (transcriptHasRunReview(transcript)) return 0;

  process.stderr.write(
    `[review-watchdog] 触及代码文件 ${filePath}，本轮响应未检测到 runReview 调用。\n` +
    `如已调请忽略；如未调请补 runReview({kind:"code"})。\n`
  );
  return 0;
}

main();