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
  install_one "$1"
  exit $?
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
  exit 1
fi
