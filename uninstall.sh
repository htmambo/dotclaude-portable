#!/usr/bin/env bash
# uninstall.sh — thin wrapper that delegates to install.sh --uninstall
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
exec "$HERE/install.sh" --uninstall "$@"
