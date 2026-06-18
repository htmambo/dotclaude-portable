#!/usr/bin/env bash
# tests/ci/smoke.sh — local equivalent of .github/workflows/ci.yml
# 跑完整 6 步：dry-run / doctor / install / check / rollback / uninstall
# 用临时 HOME 隔离本机 ~/.claude，绝不污染真实环境
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "${HERE}/../.." &>/dev/null && pwd)"
WORK="${REPO_ROOT}/tests/ci/_work"
FAKE_HOME="${WORK}/fake-home"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step()  { printf '\n=== %s ===\n' "$*"; }

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$FAKE_HOME"

step "0. env"
echo "REPO_ROOT=$REPO_ROOT"
echo "FAKE_HOME=$FAKE_HOME"
bash --version | head -1
python3 --version

step "1. dry-run"
HOME="$FAKE_HOME" "$REPO_ROOT/install.sh" --dry-run

step "2. doctor (scan-secrets on repo)"
HOME="$FAKE_HOME" "$REPO_ROOT/install.sh" doctor

step "3. install --force"
HOME="$FAKE_HOME" "$REPO_ROOT/install.sh" --force

step "4. check"
HOME="$FAKE_HOME" "$REPO_ROOT/install.sh" --check

step "5. rollback 1 (best-effort)"
HOME="$FAKE_HOME" "$REPO_ROOT/install.sh" --rollback 1 || true
HOME="$FAKE_HOME" "$REPO_ROOT/install.sh" --check || true

step "6. uninstall"
HOME="$FAKE_HOME" "$REPO_ROOT/install.sh" --uninstall

step "7. standalone scan-secrets"
python3 "$REPO_ROOT/tools/scan-secrets.py" "$REPO_ROOT"

step "8. shell profile stripping check (FAKE_HOME only)"
for f in "$FAKE_HOME/.bashrc" "$FAKE_HOME/.zshrc"; do
  if [[ -f "$f" ]] && grep -qF "dotclaude-portable" "$f"; then
    red "FAIL: $f still contains dotclaude-portable marker"
    exit 1
  fi
done
# 同时也检查真实 $HOME 不被误改（防止 install 把真实 shell profile 改了）
if [[ -f "$HOME/.bashrc" ]] && grep -qF "dotclaude-portable" "$HOME/.bashrc" 2>/dev/null; then
  # 真实 .bashrc 可能本来就有 dotclaude-portable marker（用户之前手动跑过），
  # 但 install 阶段我们用了 FAKE_HOME，所以这次 smoke 跑不应该往真实 $HOME 写
  if ! grep -qF "# Smoke test guard" "$HOME/.bashrc" 2>/dev/null; then
    red "WARN: real $HOME/.bashrc contains dotclaude-portable (from prior install? smoke must use FAKE_HOME)"
    # 不直接 fail，但提示
  fi
fi
green "shell profile clean"

green "ALL STEPS PASSED"
