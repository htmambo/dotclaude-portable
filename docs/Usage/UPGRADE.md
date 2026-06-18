# UPGRADE — 跨版本迁移说明

## V0.x → V1.0

### 新增能力

- `global/json/*.base.json` —— 3 个 base JSON 入仓
- `hooks/.gitkeep` —— 占位文件；当前 1 个 hook 已落地（`review-watchdog.mjs`，详见 CHANGELOG 1.0.4）
- `tools/scan-secrets.py` —— Python 写的 secret 扫描器
- `tests/fixtures/` —— 正/负样本（假 token + 干净样本）
- `.github/workflows/ci.yml` —— GitHub Actions CI
- `tests/ci/smoke.sh` —— 本地 smoke 脚本

### install.sh 变化

- 新增 `install-pre-push` 子命令
- 新增 `--check` / `--rollback N` / `doctor` 子命令
- 新增 render kind（仅 `${HOME}` / `${USER}` 占位替换）
- 修复 `prune_backups` 在空 BACKUP_ROOT 时静默退出的 bug

### `.gitignore` 升级

- `global/json/*` 全屏蔽 + `!*.base.json` 白名单放行
- 模式化屏蔽 `**/settings*.json` / `**/provider*.json` / `**/.omc-config*.json`

### 升级步骤

```bash
# 1. 拉最新
cd ~/htdocs/dotclaude-portable  # 或你 clone 的位置
git pull

# 2. 本地复现 CI（必须全绿）
./tests/ci/smoke.sh

# 3. 强制重装
./install.sh --force

# 4. 验证
./install.sh --check
./install.sh doctor
```

### 升级失败回滚

```bash
# 1. 卸载（用最近 backup 恢复）
./install.sh --uninstall

# 2. 退回 V0.2
git checkout v0.2.0
./install.sh --force
```

## V0.2 → V0.1

V0.1 → V0.2 的差异：

- 移除：原 V0.1 计划中的 JSON 合并（`*.base.json` + jq）—— 改为 V0.2 的"含 token 的 JSON 永不入库"红线
- 修复：`prune_backups` 静默退出 bug
- 新增：secret 防御纵深（`.gitignore` 黑/白名单 + scan-secrets.py + pre-push hook）

## V0.1 → 初始化

无 — V0.1 是仓库初始版本。
