#!/usr/bin/env bash
# nudge-review.sh - commit-msg hook: 提交前校验外部审核通过
# 来源: dotclaude-portable 仓库,跨项目可复用(详见 README)
#
# 触发逻辑(§1.5 循环审核协议):
# 1. 若 staged 含非 .md 文件(真代码改动),检查 commit message:
#      - "Review: APPROVED"   - 走完整外部审核并通过(transcript 校验)
#      - "Review: N/A <reason>" - 显式豁免,带理由(typo / doc-only / trivial)
# 2. 仅 .md 改动 -> 任何 message 放行(文档无需审核)
# 3. message 含 "Review: APPROVED" 时,额外校验 transcript 最后审核 verdict 真为 APPROVED;
#    不符则 abort。session 发现 3 档:env > 落盘文件 > mtime 最新 transcript。
# 4. 无 python3 或无法发现 session -> TRANSCRIPT VERIFICATION SKIPPED 警告 + 字面量降级放行
#    (不因环境缺失卡住 commit,但绕过可见)
#
# 依赖: python3(用于 transcript jsonl 解析)。无则降级。
#
# 绕过: git commit --no-verify (本次 hook 跳过,但下次仍会卡)
#
# 建议安装(其他项目):
#   cp /path/to/dotclaude-portable/hooks/nudge-review.sh .git/hooks/commit-msg
#   chmod +x .git/hooks/commit-msg

set -euo pipefail

MSG_FILE="$1"
if [[ -z "$MSG_FILE" || ! -f "$MSG_FILE" ]]; then
  echo "[nudge-review] commit-msg hook called without msg file; abort" >&2
  exit 1
fi

# 读 commit message(忽略注释行)
MSG=$(grep -v '^#' "$MSG_FILE" | sed '/^$/d')

# 检查 staged 是否含非 md 改动
STAGED=$(git diff --cached --name-only --diff-filter=ACMRT 2>/dev/null || true)
NON_MD_STAGED=$(echo "$STAGED" | grep -v '\.md$' | grep -v '^$' || true)

# 仅 md 改动 -> 任何 message 放行
if [[ -z "$NON_MD_STAGED" ]]; then
  exit 0
fi

# N/A 豁免优先(带理由)
if echo "$MSG" | grep -qE '^[[:space:]]*Review: N/A .+'; then
  exit 0
fi

# 计算 encoded-cwd(与 review-watchdog.mjs encodeCwd 一致: 去前导 / , / -> -)
CWD=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ENCODED=$(echo "$CWD" | sed 's|^/|-|; s|/|-|g')

# 依赖检测: python3
if ! command -v python3 >/dev/null 2>&1; then
  if echo "$MSG" | grep -qE '^[[:space:]]*Review: APPROVED'; then
    echo "[nudge-review] 警告: 未找到 python3,TRANSCRIPT VERIFICATION SKIPPED,仅字面量放行。" >&2
    exit 0
  fi
  echo "[nudge-review] 非 markdown 文件被改动,commit message 必须含外部审核标记:" >&2
  echo "  Review: APPROVED            - 走完整外部审核并通过" >&2
  echo "  Review: N/A <reason>        - 显式豁免,带理由" >&2
  echo "受影响文件:" >&2
  echo "$NON_MD_STAGED" | sed 's/^/  /' >&2
  exit 1
fi

# session 发现 3 档: env > 落盘文件 > mtime 最新 transcript
# 用 set +e 包裹,避免子例程内命令非零在 pipefail 下 abort 整个 hook
set +e
discover_session_id() {
  # (a) env
  if [[ -n "${CLAUDE_CODE_SESSION_ID:-}" ]]; then
    echo "$CLAUDE_CODE_SESSION_ID"
    return 0
  fi
  # (b) review-watchdog 落盘文件(heredoc 传参,规避路径注入 + 空输出校验)
  local state_file="$HOME/.claude/state/last-session-${ENCODED}"
  if [[ -f "$state_file" ]]; then
    local sid
    sid=$(python3 - "$state_file" <<'PY' 2>/dev/null
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    s = d.get('sessionId', '') if isinstance(d, dict) else ''
    if s:
        print(s)
except Exception:
    pass
PY
)
    if [[ -n "$sid" ]]; then
      echo "$sid"
      return 0
    fi
  fi
  # (c) 项目 transcript 目录下 mtime 最新
  local tdir="$HOME/.claude/projects/${ENCODED}"
  if [[ -d "$tdir" ]]; then
    local latest
    latest=$(ls -t "$tdir"/*.jsonl 2>/dev/null | head -1 || true)
    if [[ -n "$latest" ]]; then
      basename "$latest" .jsonl
      return 0
    fi
  fi
  return 1
}
set -e

# 从 transcript 提取最后一次 review tool_result 的 verdict
# 输出: APPROVED | REJECTED | NEEDS_CHANGES | UNKNOWN | NO_REVIEW | NO_TRANSCRIPT
extract_last_verdict() {
  local session_id="$1"
  local transcript="$HOME/.claude/projects/${ENCODED}/${session_id}.jsonl"
  if [[ ! -f "$transcript" ]]; then
    echo "NO_TRANSCRIPT"
    return
  fi
  python3 - "$transcript" <<'PY'
import json, sys, re
path = sys.argv[1]
REVIEW = {"mcp__coding-bridge__review_code","mcp__coding-bridge__review_plan","mcp__codex__codex"}
use_ids = {}
try:
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: obj = json.loads(line)
            except: continue
            c = obj.get("message", {}).get("content", [])
            if not isinstance(c, list): continue
            for b in c:
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") in REVIEW:
                    use_ids[b.get("id")] = b.get("name")
except Exception:
    pass
if not use_ids:
    print("NO_REVIEW"); sys.exit(0)
last = None
try:
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: obj = json.loads(line)
            except: continue
            c = obj.get("message", {}).get("content", [])
            if not isinstance(c, list): continue
            for b in c:
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id") in use_ids:
                    content = b.get("content", "")
                    txt = ""
                    if isinstance(content, list):
                        txt = "\n".join(x.get("text","") for x in content if isinstance(x, dict) and x.get("type") == "text")
                    elif isinstance(content, str):
                        txt = content
                    am = ""
                    try:
                        p = json.loads(txt); am = (p.get("result") or {}).get("agent_messages", "")
                    except Exception:
                        am = txt
                    if not am:
                        last = "UNKNOWN"; continue
                    v = None
                    # (a) ```json fence verdict 字段(codex 形态)
                    m = re.search(r"```json\s*([\s\S]*?)```", am)
                    if m:
                        try:
                            j = json.loads(m.group(1)); v = j.get("verdict")
                        except Exception: v = None
                    # (b) 多级 last-match(与 review-watchdog.mjs 一致;规避正文前言误判)
                    if not v:
                        bold = list(re.finditer(r"\*\*(APPROVED|REJECTED|NEEDS_CHANGES)\*\*", am))
                        if bold: v = bold[-1].group(1)
                    if not v:
                        title = list(re.finditer(r"(?:审查结论|Verdict|verdict)[:：]\s*\*{0,2}(APPROVED|REJECTED|NEEDS_CHANGES)\b", am))
                        if title: v = title[-1].group(1)
                    if not v:
                        allm = list(re.finditer(r"\b(APPROVED|REJECTED|NEEDS_CHANGES)\b", am))
                        if allm: v = allm[-1].group(1)
                    last = (v or "UNKNOWN").upper()
except Exception:
    pass
print(last or "UNKNOWN")
PY
}

# message 含 APPROVED -> transcript 校验
if echo "$MSG" | grep -qE '^[[:space:]]*Review: APPROVED'; then
  SESSION_ID=$(discover_session_id || true)
  if [[ -z "$SESSION_ID" ]]; then
    echo "[nudge-review] 警告: 无法发现 session id,TRANSCRIPT VERIFICATION SKIPPED,仅字面量放行。" >&2
    echo "  (session 发现 3 档均失败: env / ~/.claude/state/last-session-${ENCODED} / transcript mtime)" >&2
    exit 0
  fi
  VERDICT=$(extract_last_verdict "$SESSION_ID")
  case "$VERDICT" in
    APPROVED)
      exit 0
      ;;
    NO_TRANSCRIPT|NO_REVIEW)
      echo "[nudge-review] 警告: transcript 未找到审核记录($VERDICT),TRANSCRIPT VERIFICATION SKIPPED,仅字面量放行。" >&2
      echo "  (session=$SESSION_ID)" >&2
      exit 0
      ;;
    *)
      echo "[nudge-review] commit message 声称 Review: APPROVED,但 transcript 最后审核 verdict=$VERDICT" >&2
      echo "  session=$SESSION_ID" >&2
      echo "  §1.5 循环审核协议: verdict=APPROVED 才可标记。请修复 risks 后重审至 APPROVED," >&2
      echo "  或改用 Review: N/A <reason> 显式豁免。" >&2
      echo "  绕过(不建议): git commit --no-verify" >&2
      exit 1
      ;;
  esac
fi

# message 不符合
echo "" >&2
echo "[nudge-review] 非 markdown 文件被改动,commit message 必须含外部审核标记:" >&2
echo "  Review: APPROVED            - 走完整外部审核并通过(transcript 校验)" >&2
echo "  Review: N/A <reason>        - 显式豁免,带理由(typo / doc-only / trivial)" >&2
echo "" >&2
echo "受影响文件:" >&2
echo "$NON_MD_STAGED" | sed 's/^/  /' >&2
echo "" >&2
echo "绕过(不建议): git commit --no-verify" >&2
echo "警告: 这将跳过所有检查,可能导致未经审核的代码被提交,请谨慎使用。" >&2
exit 1
