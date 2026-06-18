# Contributing

感谢考虑为 **dotclaude-portable** 做贡献。

## 提 Issue / PR

- **Bug 报告**：在 [Issues](https://github.com/htmambo/dotclaude-portable/issues) 选 `bug report` 模板
- **功能请求**：选 `feature request` 模板
- **安全漏洞**：**不要**在公开 issue 提，私下联系 maintainer
- **PR**：选 `pull_request_template.md` 模板

## 开发流程

```bash
git clone https://github.com/htmambo/dotclaude-portable
cd dotclaude-portable

# 1. 跑 smoke（必须全绿）
./tests/ci/smoke.sh

# 2. 改代码...

# 3. 跑 scan-secrets 防止漏入 secret
python3 tools/scan-secrets.py .

# 4. 改 install.sh 的话 bash -n 语法检查
bash -n install.sh

# 5. 跑 smoke 验证未破坏
./tests/ci/smoke.sh
```

## 提 PR 前的检查

- [ ] `bash -n install.sh` 无语法错
- [ ] `bash -n scripts/setup-plugins.sh` 无语法错
- [ ] `tests/ci/smoke.sh` 8 步全 PASS
- [ ] `python3 tools/scan-secrets.py .` clean
- [ ] `install.sh doctor` clean
- [ ] 如果改了 `install.sh` 的 MAP 或 sub-command，更新 `docs/Analysis/INVENTORY.md`
- [ ] 如果加了新 plugin，更新 `scripts/setup-plugins.sh` 的 `PLUGINS` 数组
- [ ] 提交信息按 `~/.claude/COMMIT_TEMPLATE.md` 模板
- [ ] commit 触发的 pre-push 拦截器会跑 scan-secrets，**必须** clean

## 代码风格

- Shell：bash 4.0+，`set -euo pipefail` 头一行，函数 `do_*` 命名，常量 `UPPER_SNAKE`
- Python：3.6+，`#!/usr/bin/env python3` 头，`from __future__ import annotations`
- 注释：**非必要不形成**（与项目根 `CLAUDE.md` 一致）
- 文档：精简高效、毫无冗余

## 不接受的 PR

- 含真实 API token / 私钥 / 凭证
- 修改 `.gitignore` 放开"永不入库"清单
- 合并 `settings.json` 字段时破坏"仅深度合并 statusLine"原则
- 删除 `tests/fixtures/` 里的正/负样本

## 版本

仓库用 [SemVer](https://semver.org/)。Breaking change → 主版本号 + 1，并在 `CHANGELOG.md` 标 `### BREAKING`。
