#!/usr/bin/env bash
# install-kimi.sh — 薄壳入口，把仓库内配置同步到 ~/.kimi-code/（Kimi Code CLI）
# 核心逻辑在 tools/install-kimi.mjs（Node.js >= 18）
# 用法见 tools/install-kimi.mjs 的 --help
set -euo pipefail

# 平台检测：MINGW* / MSYS* / CYGWIN* → --copy 模式（Windows 兜底）
MODE="symlink"
case "$(uname -s 2>/dev/null || echo Windows)" in
  MINGW*|MSYS*|CYGWIN*) MODE="copy" ;;
esac

# bash 3.2+ 校验
if [[ "${BASH_VERSINFO[0]:-0}" -lt 3 ]]; then
  echo "[err] 需要 bash >= 3.2（当前: ${BASH_VERSION:-未知}）" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[err] 需要 node >= 18；请通过 nvm / brew / apt 安装" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "[err] 需要 node >= 18（当前: $(node --version)）" >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
INSTALL_MJS="$SCRIPT_DIR/tools/install-kimi.mjs"

[[ -f "$INSTALL_MJS" ]] || { echo "[err] 文件缺失: $INSTALL_MJS"; exit 1; }

exec node "$INSTALL_MJS" \
  --mode "$MODE" \
  --repo "$SCRIPT_DIR" \
  --home "${HOME:-}" \
  "$@"
