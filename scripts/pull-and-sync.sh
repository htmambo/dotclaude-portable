#!/usr/bin/env bash
# pull-and-sync.sh — 日常更新入口:fetch → 检测远端更新 → ff-only pull → install --check。
#
# 设计要点:
# - 默认拒绝非快进合并 (--ff-only)。本地若有未推送 commit 与远端分歧,
#   自动化处理风险太高 (merge / rebase 选择影响历史),abort + 提示用户手工处理。
# - install --check 失败 (broken symlink / missing file) 仅 warn,不 abort:
#   这是状态问题,与 git pull 成功无关 — 状态问题交给 ./install.sh --force 处理。
#
# 用法:
#   ./scripts/pull-and-sync.sh         # 标准:fetch + 自动 pull(若有更新) + check
#   ./scripts/pull-and-sync.sh --check # 只跑 install --check,不 fetch/pull
#
# Exit codes:
#   0  — 全部成功(或远端无新 commit 且 check OK)
#   1  — git fetch/pull 自身出错 (网络/权限)
#   2  — 非快进合并,本地有未推送 commit 与远端分歧 — 用户需手工处理
#   3  — install --check 失败 (broken symlink 等) — 不阻塞更新,仅提示

set -euo pipefail

# ── 解析自身路径与参数 ─────────────────────────────
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "$HERE/.." &>/dev/null && pwd)"
cd "$REPO_ROOT"

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help)
      sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "[pull-sync] unknown arg: $arg" >&2
      exit 1
      ;;
  esac
done

# ── 前置校验 ─────────────────────────────────
if [[ ! -x ./install.sh ]]; then
  echo "[pull-sync] ./install.sh not found or not executable — 请确认仓库完整" >&2
  exit 1
fi

# ── 仅 check 模式 ────────────────────────────────
if [[ $CHECK_ONLY -eq 1 ]]; then
  echo "[pull-sync] --check mode: skip fetch/pull"
  ./install.sh --check || exit 3
  exit 0
fi

# ── fetch ─────────────────────────────────────
BRANCH="${DOTCLAUDE_PORTABLE_BRANCH:-main}"
echo "[pull-sync] fetch origin/$BRANCH..."
if ! git fetch origin "$BRANCH" --quiet 2>&1; then
  echo "[pull-sync] fetch failed (network/permission?) — 手动排查" >&2
  exit 1
fi

# ── 检测本地 vs 远端 ───────────────────────────
LOCAL=$(git rev-parse HEAD) || { echo "[pull-sync] 无法解析 HEAD (仓库异常?)" >&2; exit 1; }
REMOTE=$(git rev-parse "origin/$BRANCH") || { echo "[pull-sync] 无法解析 origin/$BRANCH (远端不存在?)" >&2; exit 1; }

if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "[pull-sync] already up to date (HEAD = origin/$BRANCH)"
  echo "[pull-sync] running install --check anyway..."
  ./install.sh --check || {
    echo "[pull-sync] install --check failed (broken symlinks?); try './install.sh --force'" >&2
    exit 3
  }
  exit 0
fi

# ── 有更新,先看是否 ff ──────────────────────────
MERGE_BASE=$(git merge-base HEAD "origin/$BRANCH" 2>/dev/null || echo "")
if [[ -z "$MERGE_BASE" ]]; then
  echo "[pull-sync] no common ancestor with origin/$BRANCH — abort" >&2
  exit 2
fi

if [[ "$MERGE_BASE" == "$LOCAL" ]]; then
  # 本地是远端的祖先 → 纯 fast-forward,安全
  echo "[pull-sync] new commits available, fast-forwarding..."
elif [[ "$MERGE_BASE" == "$REMOTE" ]]; then
  # 远端是本地的祖先 → 本地领先,无需 pull
  echo "[pull-sync] local is ahead of origin/$BRANCH (no pull needed)"
  echo "[pull-sync] running install --check..."
  ./install.sh --check || {
    echo "[pull-sync] install --check failed (broken symlinks?); try './install.sh --force'" >&2
    exit 3
  }
  exit 0
else
  # 分歧 — 本地与远端各自有新 commit
  # 额外检查工作区是否干净,避免后续手工操作时混淆
  if ! git diff-index --quiet HEAD --; then
    echo "[pull-sync] 工作区有未提交的更改,请先 commit 或 stash 后再处理分歧" >&2
    exit 1
  fi

  echo "[pull-sync] diverged: local + remote both have new commits" >&2
  echo "" >&2
  echo "  Local  HEAD: $LOCAL" >&2
  echo "  Remote HEAD: $REMOTE" >&2
  echo "  Base:        $MERGE_BASE" >&2
  echo "" >&2
  echo "  自动化处理风险太高 — 取决于你想保留哪些 commit。" >&2
  echo "" >&2
  echo "  手工选项:" >&2
  echo "    git pull --rebase   # 把本地未推送 commit 移到远端之后(线性历史)" >&2
  echo "    git pull --no-rebase  # 创建 merge commit(保留分支结构)" >&2
  echo "    git fetch && git reset --hard origin/$BRANCH  # 丢弃本地未推送 commit(危险,可能丢工作)" >&2
  echo "" >&2
  exit 2
fi

# ── fast-forward pull ─────────────────────────
# 确保工作区干净
if ! git diff-index --quiet HEAD --; then
  echo "[pull-sync] 工作区有未提交的更改,无法安全执行 fast-forward pull" >&2
  exit 1
fi

echo "[pull-sync] pulling..."
if ! git pull --ff-only; then
  echo "[pull-sync] pull failed unexpectedly" >&2
  exit 1
fi

# ── install --check ────────────────────────────
echo "[pull-sync] running install --check..."
./install.sh --check || {
  echo "" >&2
  echo "[pull-sync] install --check failed — symlink/missing issue unrelated to pull." >&2
  echo "[pull-sync] try: ./install.sh --force  (重置 symlink)" >&2
  exit 3
}

# ── 刷新 pre-commit hook 模板(可选,防模板升级断层) ────────
# pre-commit hook 模板内嵌在 install.mjs,模板升级时已装 hook 不会自动更新
# pull 后顺手刷新一次,确保下次 commit 用最新逻辑
if [[ -f tools/install.mjs ]] && command -v node >/dev/null 2>&1; then
  echo "[pull-sync] refreshing pre-commit hook template..."
  node tools/install.mjs install-pre-sync-docs-hook >/dev/null 2>&1 || true
fi

echo "[pull-sync] done."
