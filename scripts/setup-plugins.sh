#!/usr/bin/env bash
# setup-plugins.sh — 跨机器一次装齐 dotclaude-portable 维护的 plugin 列表
# 维护来源：本机实测 installed_plugins.json（2026-06-18）
# 用法:
#   ./scripts/setup-plugins.sh           # 全装
#   ./scripts/setup-plugins.sh --list    # 列出将装的 plugin（不动）
#   ./scripts/setup-plugins.sh <name>@<marketplace>  # 装单个
set -euo pipefail

# --- 维护的 plugin 清单（plugin@marketplace 格式）---
PLUGINS=(
  "oh-my-claudecode@omc"
  "frontend-design@claude-plugins-official"
  "rust-analyzer-lsp@claude-plugins-official"
  "php-lsp@claude-plugins-official"
  "typescript-lsp@claude-plugins-official"
  "context7@claude-plugins-official"
  "code-review@claude-plugins-official"
)

# --- marketplace 源（首次自动注册；已注册则 skip）---
MARKETPLACES=(
  "claude-code-plugins|https://github.com/anthropics/claude-code"
  "omc|https://github.com/Yeachan-Heo/oh-my-claudecode.git"
  "superpowers-marketplace|https://github.com/obra/superpowers-marketplace"
)

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow(){ printf '\033[33m%s\033[0m\n' "$*"; }

# --- 前置检查 ---
if ! command -v claude >/dev/null 2>&1; then
  red "ERR: 'claude' command not found; install Claude Code CLI first"
  exit 1
fi

# --- 入口分发 ---
if [[ "${1:-}" == "--list" ]]; then
  echo "=== marketplaces ==="
  printf '  %s\n' "${MARKETPLACES[@]}"
  echo "=== plugins ==="
  printf '  %s\n' "${PLUGINS[@]}"
  exit 0
fi

ensure_marketplace() {
  local name="$1" url="$2"
  # 严格匹配第一列：避免子串误判（如 'claude-code-plugins' 是
  # 'superpowers-marketplace' URL 的子串会假阳性）
  if claude plugin marketplace list 2>/dev/null | awk 'NF{print $1}' | grep -qxF "$name"; then
    yellow "[skip] marketplace already registered: $name"
  else
    echo "[add] marketplace: $name"
    claude plugin marketplace add "$url" || yellow "  warn: add $name failed (continuing)"
  fi
}

install_one() {
  local pkg="$1"
  echo "[install] $pkg"
  if claude plugin install "$pkg"; then
    green "  ok"
  else
    yellow "  warn: install failed (continuing with next)"
    return 1
  fi
}

# 装完 plugin 后自动重建 ~/.claude/CLAUDE.md symlink(OMC 改写过则重建)。
# 静默处理: install.mjs / install.sh 不存在或失败时给 yellow 警告,不影响主流程。
restore_claude_md_symlink() {
  local md="$HOME/.claude/CLAUDE.md"
  # symlink 健在 → 无需动作
  if [[ -L "$md" ]] && [[ -e "$md" ]]; then return 0; fi
  # 文件完全不存在 → 留给 install.sh 首次安装流程处理
  if [[ ! -e "$md" ]] && [[ ! -L "$md" ]]; then return 0; fi

  echo
  echo "=== restore CLAUDE.md symlink (OMC may have replaced it) ==="
  # 用 BASH_SOURCE 而非 $0: 函数被 source 时 $0 是 caller, BASH_SOURCE 才是真实文件路径
  local self="${BASH_SOURCE[0]:-$0}"
  local repo_root
  repo_root="$(cd "$(dirname "$self")/.." && pwd)" || { yellow "  warn: cannot determine repo root from $self"; return 0; }
  # 优先用 Node 版 install.mjs(无 shell 注入风险),失败回退 install.sh
  if [[ -f "$repo_root/tools/install.mjs" ]]; then
    if (cd "$repo_root" && node tools/install.mjs --force >/dev/null 2>&1); then
      green "  symlink restored via tools/install.mjs --force"
      return 0
    fi
    yellow "  warn: install.mjs --force failed, falling back to install.sh"
  fi
  if [[ -x "$repo_root/install.sh" ]]; then
    if (cd "$repo_root" && ./install.sh --force >/dev/null 2>&1); then
      green "  symlink restored via install.sh --force"
      return 0
    fi
    yellow "  warn: install.sh --force failed; please run ./install.sh --force manually"
  else
    yellow "  warn: neither install.mjs nor install.sh found; please restore manually"
  fi
}

if [[ $# -gt 0 ]]; then
  # 装单个：先解析 @ 后的 marketplace 名并注册
  mkt_name="${1##*@}"
  mkt_url=""
  for entry in "${MARKETPLACES[@]}"; do
    IFS='|' read -r name url <<<"$entry"
    if [[ "$name" == "$mkt_name" ]]; then
      mkt_url="$url"; break
    fi
  done
  if [[ -n "$mkt_url" ]]; then
    ensure_marketplace "$mkt_name" "$mkt_url"
  else
    yellow "warn: marketplace '$mkt_name' not in local list; attempting install anyway (may fail)"
  fi
  # 用 || true 接住 install_one 的非零返回:set -e 下,直接调用函数里的
  # `return 1` 会终止整个脚本,导致 rc=$? 永远不到。包成 `... || true`
  # 把失败转成 0,再读 $?。restore 失败不掩盖 install 退出码。
  install_one "$1" || true
  rc=$?
  restore_claude_md_symlink
  exit $rc
fi

# 装全部
echo "=== register marketplaces ==="
for entry in "${MARKETPLACES[@]}"; do
  IFS='|' read -r name url <<<"$entry"
  ensure_marketplace "$name" "$url"
done

echo
echo "=== install plugins ==="
fail_count=0
for p in "${PLUGINS[@]}"; do
  install_one "$p" || fail_count=$((fail_count + 1))
done

echo
if [[ $fail_count -eq 0 ]]; then
  green "ALL PLUGINS INSTALLED"
else
  yellow "DONE with $fail_count failure(s)"
  # 不 exit: 仍尝试 restore, 留给用户决定下一步
fi

# OMC (oh-my-claudecode) 的 omc-setup / omc-doctor / 部分 slash command 会
# 把 ~/.claude/CLAUDE.md 改成普通文件,破坏 dotclaude-portable 的 symlink 托管。
# 每次 plugin install/update 后自动重建 — 这是 INVENTORY.md "未来可加" 那一条的具体落地。
restore_claude_md_symlink

# 退出码: 有失败 → 1, 全成功 → 0。${fail_count:-0} 兜底 set -u 边界
[[ ${fail_count:-0} -eq 0 ]] && exit 0 || exit 1
