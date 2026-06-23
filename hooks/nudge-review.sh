#!/usr/bin/env bash
# nudge-review.sh — commit-msg hook: 提交前提醒跑外部代码审核
# 来源: dotclaude-portable 仓库,跨项目可复用(详见 README)
#
# 触发逻辑:
# 1. 若 staged 含非 .md 文件(真代码改动),检查 commit message 是否含:
#      - "Review: APPROVED"   — 走完整外部审核并通过
#      - "Review: N/A <reason>" — 显式豁免,带理由(typo / doc-only / revert / trivial)
# 2. 仅 .md 改动 → 任何 message 放行(文档无需审核)
# 3. message 不符合 → stderr 提示 + exit 1 abort commit
#
# 绕过: git commit --no-verify (本次 hook 跳过,但下次仍会卡)
#       或 git commit --no-verify --message="..." (绕过但失去护栏)
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

# 仅 md 改动 → 任何 message 放行
if [[ -z "$NON_MD_STAGED" ]]; then
  exit 0
fi

# 有非 md 改动 → 必须含 Review 字段(允许行首缩进)
if echo "$MSG" | grep -qE '^[[:space:]]*Review: (APPROVED|N/A .+)'; then
  exit 0
fi

echo "" >&2
echo "[nudge-review] 非 markdown 文件被改动,commit message 必须含外部审核标记:" >&2
echo "  Review: APPROVED            — 走完整外部审核并通过" >&2
echo "  Review: N/A <reason>        — 显式豁免,带理由(typo / doc-only / trivial)" >&2
echo "" >&2
echo "受影响文件:" >&2
echo "$NON_MD_STAGED" | sed 's/^/  /' >&2
echo "" >&2
echo "绕过(不建议): git commit --no-verify" >&2
echo "警告: 这将跳过所有检查,可能导致未经审核的代码被提交,请谨慎使用。" >&2
exit 1
