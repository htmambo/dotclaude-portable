#!/usr/bin/env bash
# install.sh — 薄壳入口，把仓库内配置同步到 ~/.claude/
# 核心逻辑迁到 tools/install.mjs（Node.js >= 18）
# 用法见 tools/install.mjs 的 --help
set -euo pipefail

# 平台检测：MINGW* / MSYS* / CYGWIN* → --copy 模式（Windows 兜底）
MODE="symlink"
case "$(uname -s 2>/dev/null || echo Windows)" in
  MINGW*|MSYS*|CYGWIN*) MODE="copy" ;;
esac

# bash 3.2+ 校验（macOS 系统 bash 3.2.57 也兼容；2.x 旧 bash 缺 [[ ]] 拒收）
if [[ "${BASH_VERSINFO[0]:-0}" -lt 3 ]]; then
  echo "[err] requires bash >= 3.2 (current: ${BASH_VERSION:-unknown})" >&2
  exit 1
fi

# 找 node（macOS npx 自带 / Linux 用系统 node；缺失则报错指引）
if ! command -v node >/dev/null 2>&1; then
  echo "[err] node >= 18 required; install via nvm / brew / apt" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "[err] node >= 18 required (current: $(node --version))" >&2
  exit 1
fi

# 解析自身路径（避免 source 时的相对路径陷阱）
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
INSTALL_MJS="$SCRIPT_DIR/tools/install.mjs"

[[ -f "$INSTALL_MJS" ]] || { echo "[err] missing: $INSTALL_MJS" >&2; exit 1; }

# delegate 到 Node.js
exec node "$INSTALL_MJS" \
  --mode "$MODE" \
  --repo "$SCRIPT_DIR" \
  --home "${HOME:-}" \
  "$@"