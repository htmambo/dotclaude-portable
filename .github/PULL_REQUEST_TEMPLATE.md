## 改动

<!-- 简述这次 PR 改了什么 -->

## 关联 Issue

<!-- 关联的 issue 编号，例如 Closes #123 / Fixes #45 -->

## 改动类型

- [ ] Bug fix（不破坏兼容）
- [ ] New feature（不破坏兼容）
- [ ] Breaking change（破坏兼容）
- [ ] Documentation only
- [ ] Refactor / cleanup

## 验证

- [ ] `bash -n install.sh` 无语法错
- [ ] `bash -n scripts/setup-plugins.sh` 无语法错
- [ ] `./tests/ci/smoke.sh` 8 步 ALL STEPS PASSED
- [ ] `python3 tools/scan-secrets.py .` clean（exit 0）
- [ ] `./install.sh doctor` clean

## 涉及文件

- [ ] `install.sh`
- [ ] `scripts/setup-plugins.sh`
- [ ] `tools/scan-secrets.py`
- [ ] `global/json/*.base.json`
- [ ] `docs/Analysis/INVENTORY.md`
- [ ] `README.md`
- [ ] `CHANGELOG.md`
- [ ] 其他：________

## 安全自检

- [ ] 不含真实 token / 私钥 / 凭证
- [ ] 没有修改 `.gitignore` 放开"永不入库"清单
- [ ] `install-statusline` 的合并逻辑仍为"仅深度合并 statusLine"

## CHANGELOG

- [ ] 已更新 `CHANGELOG.md`（breaking change 必须）
