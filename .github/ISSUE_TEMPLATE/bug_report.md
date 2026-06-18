---
name: Bug report
about: 报告 dotclaude-portable 的 bug
title: "[Bug] "
labels: bug
assignees: ''
---

## 描述

清晰简洁地描述 bug。

## 复现步骤

1. `git clone https://github.com/htmambo/dotclaude-portable`
2. `cd dotclaude-portable`
3. `./install.sh --dry-run`
4. 看到错误 / 异常行为

## 预期行为

应该发生什么。

## 实际行为

实际发生什么（贴 `install.sh --dry-run` / `doctor` / `scan-secrets` 输出）。

## 环境

- OS: [e.g. Ubuntu 24.04 / macOS 15 / Windows 11 Git Bash]
- Bash: [e.g. 5.3.9]
- Python: [e.g. 3.14]
- `dotclaude-portable` 版本: [e.g. v1.0.0 / commit 19cb018]
- Claude Code CLI 版本: [e.g. latest]

## 日志 / 截图

```bash
$ ./tests/ci/smoke.sh 2>&1
(paste full output)
```

## 备注

任何额外上下文。
