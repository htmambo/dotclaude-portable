---
status: 🔄 进行中
created: 2026-06-18
owner: hoping
scope: dotclaude-portable V1.0
---

# dotclaude-portable V1.0 任务计划

## 目标

V1.0 把仓库从"本机可用"升级到"跨机器可移植、CI 可验证、Windows 可用"：

1. **CI 端到端测试** —— 在空白 Ubuntu 容器跑 install / check / doctor / uninstall 全流程
2. **rollback 实测** —— 在 `--uninstall` 之外提供干净的 `--rollback N`，并补强快照保留策略
3. **跨平台支持** —— Windows `--copy` 模式实测（PowerShell 语法）
4. **UPGRADE.md** —— 维护跨版本迁移说明
5. **VERSION 升 1.0.0**

## 子任务

- [x] 1. 建本计划文档
- [ ] 2. 写 `.github/workflows/ci.yml`：Ubuntu 容器跑 install.sh --dry-run → doctor → check → uninstall
- [ ] 3. 写 `tests/ci-smoke.sh`：本地复用 CI 逻辑，供本地快速验证
- [ ] 4. 升级 `install.sh`：
   - [ ] 4.1 检测 `RUNNER_OS == "Windows"` 时切到 PowerShell 语法（`New-Item -ItemType SymbolicLink`）
   - [ ] 4.2 `--copy` 在 Windows 上 fallback 到 `cp`（git-bash 自带）
- [ ] 5. 写 `docs/Usage/UPGRADE.md`：V0.x → V1.0 迁移注意事项
- [ ] 6. 写 `docs/Usage/INSTALL.md`：详细安装/升级/卸载说明
- [ ] 7. 验证：在本机跑 `tests/ci-smoke.sh` 等价流程全绿
- [ ] 8. VERSION 升 1.0.0
- [ ] 9. 提交（V1.0 commit）
- [ ] 10. 写首次发版 tag

## CI 设计

`.github/workflows/ci.yml` 触发条件：`push` 到 main / `pull_request` 到 main / 手动 `workflow_dispatch`。

```yaml
name: ci
on: [push, pull_request, workflow_dispatch]
jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: dry-run
        run: ./install.sh --dry-run
      - name: doctor
        run: ./install.sh doctor
      - name: install to temp HOME
        env:
          HOME: ${{ runner.temp }}/fake-home
        run: |
          mkdir -p "$HOME"
          ./install.sh --force
      - name: check
        run: ./install.sh --check
      - name: rollback to slot 1
        run: ./install.sh --rollback 1
      - name: uninstall
        run: ./install.sh --uninstall
      - name: scan-secrets on repo
        run: python3 tools/scan-secrets.py .
```

## 跨平台策略

V1.0 不做"代码层完全跨平台"（那需要把 install.sh 用 Python 完整重写，工程量过大且 V0.1/V0.2 投资浪费）。V1.0 折中：

- **Linux/macOS**：`install.sh`（POSIX bash + coreutils）
- **Windows**：用 **Git Bash** 跑同一份 `install.sh`，自动 fallback 到 `--copy` 模式（git-bash 的 `ln -s` 在 Windows 上需要 Developer Mode）

检测逻辑：
```bash
case "$(uname -s 2>/dev/null || echo Windows)" in
  MINGW*|MSYS*|CYGWIN*) MODE="copy" ;;
  *) ;;
esac
```

## UPGRADE.md 起草

V0.1 → V1.0 主要变化：
1. 新增 `global/json/*.base.json`（3 个）
2. 新增 `hooks/`（9 个 .mjs/.sh）
3. 新增 `tools/scan-secrets.py`
4. install.sh 新增 `install-pre-push` 子命令
5. `.gitignore` 全面升级（黑/白名单）
6. 本机首次升级时建议：先 `./install.sh --uninstall`（保留 backup），再 `./install.sh --force`

## 验收标准

- [ ] CI workflow 语法合法（`act` 本地能跑通最好，CI 端必跑通）
- [ ] `tests/ci-smoke.sh` 本机跑 6 步全绿
- [ ] Windows 检测分支（用 `RUNNER_OS` 或 `uname -s`）逻辑无语法错
- [ ] UPGRADE.md 与 INVENTORY.md 决策一致
- [ ] VERSION = 1.0.0
- [ ] 仓库体积 ≤ 300 KB

## 不在本阶段

- hook 行为改写（路径变量化）→ 留 V1.x 视情况
- hook 单元测试（每个 hook 单独跑）→ 留 V1.x
- macOS 实测 → 留 V1.x
- 自动 release 到 GitHub Releases → 留 V1.x
