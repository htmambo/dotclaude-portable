#!/usr/bin/env bash
# install.sh — 一键把仓库内配置同步到 ~/.claude/
# 默认 symlink 模式（git pull 即生效）。
# 用法:
#   ./install.sh                 # 安装
#   ./install.sh --dry-run       # 只打印动作
#   ./install.sh --force         # 强制覆盖
#   ./install.sh --copy          # 拷贝模式（Windows 兜底）
#   ./install.sh --uninstall
#   ./install.sh doctor          # secret 扫描
#   ./install.sh --check         # symlink 健康巡检
#   ./install.sh --rollback N    # 回滚到第 N 个备份
#   ./install.sh install-pre-push  # 在 .git/hooks/pre-push 安装 secret 拦截
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
TARGET_HOME="${HOME}/.claude"
BACKUP_ROOT="${HOME}/.claude.backups"
MAX_BACKUPS=3
MODE="symlink"
DRY_RUN=0
FORCE=0
ACTION="install"
ROLLBACK_N=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=1; shift ;;
    --force)         FORCE=1; shift ;;
    --copy)          MODE="copy"; shift ;;
    --uninstall)     ACTION="uninstall"; shift ;;
    doctor)          ACTION="doctor"; shift ;;
    --check)         ACTION="check"; shift ;;
    --rollback)      ACTION="rollback"; ROLLBACK_N="${2:-1}"; shift 2 ;;
    install-pre-push) ACTION="install-pre-push"; shift ;;
    install-statusline) ACTION="install-statusline"; shift ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) printf '[err] unknown arg: %s\n' "$1" >&2; exit 2 ;;
  esac
done

log()  { printf '[%s] %s\n' "${ACTION}" "$*"; }
warn() { printf '[%s][warn] %s\n' "${ACTION}" "$*" >&2; }
err()  { printf '[%s][err] %s\n' "${ACTION}" "$*" >&2; }

if [[ "${BASH_VERSINFO[0]:-0}" -lt 4 ]]; then
  err "requires bash >= 4.0 (current: ${BASH_VERSION:-unknown})"
  exit 1
fi

# Map: src(rel REPO_ROOT) -> dst(rel TARGET_HOME) | kind(symlink|render|hook|version)
# kind=symlink : 普通 symlink
# kind=render  : $HOME 占位符渲染后 cp（仅当本机无该文件时）
# kind=hook    : hook 脚本 + chmod +x
declare -a MAP=(
  "global/CLAUDE.md|CLAUDE.md|symlink"
  "global/COMMIT_TEMPLATE.md|COMMIT_TEMPLATE.md|symlink"
  "global/json/execution_config.base.json|execution_config.json|render"
  "global/json/mcp.base.json|.mcp.json|render"
  "global/json/.omc-version.base.json|.omc-version.json|render"
  "commands/fix-permissions.md|commands/fix-permissions.md|symlink"
  "commands/fullauto-prune.md|commands/fullauto-prune.md|symlink"
  "skills/fullauto/SKILL.md|skills/fullauto/SKILL.md|symlink"
)
# hooks/ 目录下的所有 .mjs / .sh 文件都是 deploy/check 的对象
# 目录为空时列表也为空（不报"missing"）
HOOK_FILES=()
if [[ -d "${REPO_ROOT}/hooks" ]]; then
  while IFS= read -r f; do HOOK_FILES+=("$f"); done < <(find "${REPO_ROOT}/hooks" -mindepth 1 -maxdepth 1 \( -name '*.mjs' -o -name '*.sh' \) | sort)
fi

do_install() {
  [[ -d "$TARGET_HOME" ]] || { log "creating $TARGET_HOME"; [[ $DRY_RUN -eq 1 ]] || mkdir -p "$TARGET_HOME"; }

  if [[ ! -f "${TARGET_HOME}/.dotclaude-portable.version" ]]; then
    backup_existing
  else
    log "already managed; skipping full backup"
  fi

  for entry in "${MAP[@]}"; do
    IFS='|' read -r src_rel dst_rel kind <<<"$entry"
    install_one "$src_rel" "$dst_rel" "$kind"
  done

  deploy_hooks
  write_version_file
  inject_shell_profile
  do_install_pre_push
  log "done. managed: $TARGET_HOME"
}

backup_existing() {
  [[ $DRY_RUN -eq 1 ]] && { log "[dry-run] would create backup under $BACKUP_ROOT"; return; }
  mkdir -p "$BACKUP_ROOT"
  local snap="${BACKUP_ROOT}/$(date -u +%Y%m%d_%H%M%S)"
  local touched=0
  for entry in "${MAP[@]}"; do
    IFS='|' read -r _ dst_rel _ <<<"$entry"
    local dst="${TARGET_HOME}/${dst_rel}"
    [[ -e "$dst" || -L "$dst" ]] && { touched=1; break; }
  done
  if [[ $touched -eq 1 ]]; then
    mkdir -p "$snap"
    for entry in "${MAP[@]}"; do
      IFS='|' read -r _ dst_rel _ <<<"$entry"
      local dst="${TARGET_HOME}/${dst_rel}"
      if [[ -e "$dst" || -L "$dst" ]]; then
        local parent; parent="$(dirname "$dst")"
        mkdir -p "$snap${parent#$TARGET_HOME}"
        mv "$dst" "$snap${dst#$TARGET_HOME}"
      fi
    done
    for h in "${HOOK_FILES[@]}"; do
      local hp="${TARGET_HOME}/hooks/$h"
      if [[ -e "$hp" || -L "$hp" ]]; then
        mkdir -p "$snap/hooks"
        mv "$hp" "$snap/hooks/$h"
      fi
    done
    log "backed up existing files to $snap"
  fi
  prune_backups
}

prune_backups() {
  # 用 find 避免空目录时 ls glob 失败触发 pipefail+set -e
  local -a snaps
  mapfile -t snaps < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -r)
  local count=${#snaps[@]}
  if [[ $count -gt $MAX_BACKUPS ]]; then
    for d in "${snaps[@]:$MAX_BACKUPS}"; do
      log "pruning old backup: $d"
      [[ $DRY_RUN -eq 1 ]] || rm -rf "$d"
    done
  fi
}

install_one() {
  local src_rel="$1" dst_rel="$2" kind="$3"
  local src="${REPO_ROOT}/${src_rel}"
  local dst="${TARGET_HOME}/${dst_rel}"
  [[ -e "$src" ]] || { err "missing source: $src"; exit 1; }
  mkdir -p "$(dirname "$dst")"

  case "$kind" in
    symlink|hook) install_link_or_copy "$src" "$dst" ;;
    render)
      if [[ -e "$dst" || -L "$dst" ]]; then
        log "skip render (exists): ${dst#$HOME/}"
      else
        log "render+install: ${dst#$HOME/}"
        if [[ $DRY_RUN -eq 0 ]]; then
          # 安全渲染：仅替换 ${HOME} 与 ${USER}，避免任意 envsubst 风险
          HOME_VAL="$HOME" USER_VAL="${USER:-$(id -un)}" \
            python3 -c "
import os, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
for k, v in (('HOME', os.environ['HOME_VAL']),
             ('USER', os.environ['USER_VAL'])):
    src = src.replace('\${' + k + '}', v)
pathlib.Path(sys.argv[2]).write_text(src, encoding='utf-8')
" "$src" "$dst"
        fi
      fi
      ;;
    *) err "unknown kind: $kind"; exit 1 ;;
  esac
}

install_link_or_copy() {
  local src="$1" dst="$2"
  if [[ -L "$dst" ]]; then
    local cur; cur="$(readlink "$dst")"
    if [[ "$cur" == "$src" ]]; then log "skip (linked): ${dst#$HOME/}"; return; fi
    warn "existing symlink -> $cur"
    [[ $FORCE -eq 0 ]] && { err "use --force to replace"; exit 1; }
    [[ $DRY_RUN -eq 1 ]] || rm -f "$dst"
  elif [[ -e "$dst" ]]; then
    if [[ $FORCE -eq 0 ]]; then
      warn "exists: ${dst#$HOME/} (use --force to overwrite)"
    fi
    [[ $DRY_RUN -eq 1 ]] || mv "$dst" "${dst}.bak.$(date -u +%Y%m%d_%H%M%S)"
  fi
  if [[ $MODE == "symlink" ]]; then
    log "link: ${dst#$HOME/} -> ${src#$REPO_ROOT/}"
    [[ $DRY_RUN -eq 1 ]] || ln -s "$src" "$dst"
  else
    log "copy: ${dst#$HOME/}"
    [[ $DRY_RUN -eq 1 ]] || cp "$src" "$dst"
  fi
  [[ $DRY_RUN -eq 1 ]] || chmod -R u+rwX,go+rX "$TARGET_HOME" 2>/dev/null || true
}

deploy_hooks() {
  local src_dir="${REPO_ROOT}/hooks"
  [[ -d "$src_dir" ]] || { log "no hooks/ dir in repo; skipping"; return; }
  for h in "${HOOK_FILES[@]}"; do
    local s="${src_dir}/$h"
    [[ -e "$s" ]] || continue
    local d="${TARGET_HOME}/hooks/$h"
    install_link_or_copy "$s" "$d"
    [[ $DRY_RUN -eq 1 ]] || chmod +x "$d" 2>/dev/null || true
  done
}

write_version_file() {
  local marker="${TARGET_HOME}/.dotclaude-portable.version"
  local ver="0.2.0"
  [[ -f "${REPO_ROOT}/VERSION" ]] && ver="$(cat "${REPO_ROOT}/VERSION")"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "[dry-run] would write $marker ($ver)"
  else
    printf 'repo=%s\nversion=%s\ninstalled_at=%s\n' \
      "$REPO_ROOT" "$ver" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$marker"
  fi
}

inject_shell_profile() {
  local marker="# dotclaude-portable"
  local export_line="export CLAUDE_HOME=\"\$HOME/.claude\""
  for f in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [[ -f "$f" ]] || continue
    if grep -qF "$marker" "$f"; then log "shell profile tagged: $f"; continue; fi
    log "appending to $f"
    [[ $DRY_RUN -eq 1 ]] || { printf '\n%s\n%s\n' "$marker" "$export_line" >> "$f"; }
  done
}

do_uninstall() {
  log "uninstall — restoring from latest backup"
  [[ -d "$BACKUP_ROOT" ]] || warn "no backup root: $BACKUP_ROOT"
  if [[ -d "$BACKUP_ROOT" ]]; then
    local latest; latest=$(ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | head -n1 || true)
    [[ -n "$latest" ]] && { log "restoring from $latest"; [[ $DRY_RUN -eq 1 ]] || cp -a "$latest"/. "$TARGET_HOME"/; }
  fi
  for entry in "${MAP[@]}"; do
    IFS='|' read -r _ dst_rel _ <<<"$entry"
    local dst="${TARGET_HOME}/${dst_rel}"
    [[ -L "$dst" ]] && { log "unlink: ${dst#$HOME/}"; [[ $DRY_RUN -eq 1 ]] || rm -f "$dst"; }
  done
  for h in "${HOOK_FILES[@]}"; do
    local hp="${TARGET_HOME}/hooks/$h"
    [[ -L "$hp" ]] && { log "unlink: hooks/$h"; [[ $DRY_RUN -eq 1 ]] || rm -f "$hp"; }
  done
  [[ -f "${TARGET_HOME}/.dotclaude-portable.version" ]] && {
    log "removing version marker"
    [[ $DRY_RUN -eq 1 ]] || rm -f "${TARGET_HOME}/.dotclaude-portable.version"
  }
  strip_shell_profile
  log "done"
}

strip_shell_profile() {
  local marker="# dotclaude-portable"
  for f in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [[ -f "$f" ]] || continue
    grep -qF "$marker" "$f" || continue
    log "stripping dotclaude-portable block from $f"
    [[ $DRY_RUN -eq 1 ]] || awk -v m="$marker" '
      $0==m { skip=1; next }
      skip==1 && /^[[:space:]]*$/ { skip=0; next }
      skip==1 { next }
      { print }
    ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
}

do_rollback() {
  [[ -d "$BACKUP_ROOT" ]] || { err "no backups at $BACKUP_ROOT"; exit 1; }
  local snap; snap=$(ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | sed -n "${ROLLBACK_N}p" || true)
  [[ -n "$snap" ]] || { err "no backup at slot #$ROLLBACK_N"; exit 1; }
  log "rolling back to $snap"
  [[ $DRY_RUN -eq 1 ]] || cp -a "$snap"/. "$TARGET_HOME"/
  log "done"
}

do_check() {
  local bad=0
  for entry in "${MAP[@]}"; do
    IFS='|' read -r _ dst_rel _ <<<"$entry"
    local dst="${TARGET_HOME}/${dst_rel}"
    if [[ ! -e "$dst" ]]; then warn "missing: ${dst#$HOME/}"; bad=1
    elif [[ -L "$dst" ]]; then
      local t; t="$(readlink "$dst")"
      if [[ ! -e "$t" ]]; then warn "broken: ${dst#$HOME/} -> $t"; bad=1
      else log "ok: ${dst#$HOME/}"; fi
    else log "ok (real): ${dst#$HOME/}"; fi
  done
  for h in "${HOOK_FILES[@]}"; do
    local hp="${TARGET_HOME}/hooks/$h"
    if [[ ! -e "$hp" ]]; then warn "missing hook: $h"; bad=1
    elif [[ -L "$hp" ]] && [[ ! -e "$(readlink "$hp")" ]]; then warn "broken hook: $h"; bad=1
    else log "ok hook: $h"; fi
  done
  [[ $bad -eq 0 ]] || exit 1
}

do_doctor() {
  if ! command -v python3 >/dev/null 2>&1; then
    err "python3 required for doctor"; exit 1
  fi
  log "running scan-secrets.py on repo"
  if ! python3 "${REPO_ROOT}/tools/scan-secrets.py" "$REPO_ROOT"; then
    err "doctor: secret pattern(s) detected"; exit 1
  fi
  log "doctor: clean"
}

do_install_pre_push() {
  local hook="${REPO_ROOT}/.git/hooks/pre-push"
  local script="#!/usr/bin/env bash\nset -e\nREPO_ROOT=\"\$(cd -- \"\$(dirname -- \"\${BASH_SOURCE[0]}\")/../..\" &>/dev/null && pwd)\"\npython3 \"\${REPO_ROOT}/tools/scan-secrets.py\" \"\${REPO_ROOT}\" || { echo '[pre-push] secret detected; abort' >&2; exit 1; }\n"
  log "installing pre-push hook -> $hook"
  if [[ $DRY_RUN -eq 1 ]]; then
    return
  fi
  mkdir -p "${REPO_ROOT}/.git/hooks"
  printf '%b' "$script" > "$hook"
  chmod +x "$hook"
}

do_install_statusline() {
  # 把 global/json/statusline.base.json 的 statusLine 字段
  # 合并到本机 settings.json。**只**深度合并 statusLine，其他字段原样保留
  # —— 防止 base 文件被误填其他字段时连带覆盖。
  local base="${REPO_ROOT}/global/json/statusline.base.json"
  local target="${TARGET_HOME}/settings.json"
  [[ -e "$base" ]] || { err "missing base: $base"; exit 1; }
  log "merging statusLine into $target"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "[dry-run] would merge: $(cat "$base")"
    return
  fi
  mkdir -p "$TARGET_HOME" || { err "mkdir failed: $TARGET_HOME"; exit 1; }
  # 备份（只对真文件备份；symlink 跳过——symlink 覆盖由外层处理）
  if [[ -f "$target" && ! -L "$target" ]]; then
    local ts
    ts="$(python3 -c 'import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S"))')"
    cp -a "$target" "${target}.bak.${ts}" || { err "backup failed"; exit 1; }
  fi
  # 仅深度合并 statusLine 字段
  # 原子写：先写 .tmp，再 rename()，防止中断导致 settings.json 损坏
  python3 - "$base" "$target" <<'PYEOF'
import json, os, sys
with open(sys.argv[1]) as f: base = json.load(f)
try:
    with open(sys.argv[2]) as f: tgt = json.load(f)
except FileNotFoundError:
    tgt = {}
except json.JSONDecodeError as e:
    print(f"FATAL: invalid JSON in {sys.argv[2]}: {e}", file=sys.stderr)
    sys.exit(1)
if "statusLine" in base:
    tgt["statusLine"] = {**tgt.get("statusLine", {}), **base["statusLine"]}
tmp = sys.argv[2] + ".tmp"
with open(tmp, "w") as f:
    json.dump(tgt, f, indent=2, ensure_ascii=False)
os.replace(tmp, sys.argv[2])
PYEOF
  # 预热 npx 缓存：把 base 里的 npx 命令跑一次 version，让 npx 提前下载到本地
  # —— 避免 statusLine 首次刷新时卡在下载
  local npx_cmd
  npx_cmd="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('statusLine',{}).get('command',''))" "$base" 2>/dev/null || true)"
  if [[ -n "$npx_cmd" && "$npx_cmd" == npx* ]]; then
    log "prewarming npx: $npx_cmd"
    # 安全提取：Python 解析空格分隔的 token，取第一个含 '@' 且不以 '-' 开头的
    # —— 避免 echo | awk 注入（base JSON 被污染时不会执行任意命令）
    local pkg_arg
    pkg_arg="$(python3 -c "
import sys
for p in sys.argv[1].split():
    if '@' in p and not p.startswith('-'):
        print(p); break
" "$npx_cmd" 2>/dev/null)"
    [[ -n "$pkg_arg" ]] && timeout 30 npx -y "$pkg_arg" --version >/dev/null 2>&1 \
      && log "npx prewarm ok" \
      || warn "npx prewarm failed (network? will retry on first statusLine refresh)"
  fi
  log "statusLine merged"
}

case "$ACTION" in
  install)         do_install ;;
  uninstall)       do_uninstall ;;
  doctor)          do_doctor ;;
  check)           do_check ;;
  rollback)        do_rollback ;;
  install-pre-push) do_install_pre_push ;;
  install-statusline) do_install_statusline ;;
esac
