---
status: 🔄 进行中
created: 2026-06-18
owner: hoping
scope: dotclaude-portable V0.2
---

# dotclaude-portable V0.2 任务计划

## 目标

V0.2 解决两个问题：

1. **JSON 合并**：对真正机器无关的 JSON（`execution_config.json`、`.mcp.json`、`.omc-version.json`）拆出 `*.base.json`，install 时用脚本合并到本机文件，本机个性化字段保留
2. **secret 防御纵深**：把"含 token 的 JSON 永远不入库"的策略写进 `.gitignore` + `doctor` 扫描 + 强制 policy

## V0.2 重新决策（与 V0.1 方案差异）

原 V0.1 方案把 `settings.json` / `providers.json` / `default.json` 标为"待合并"，但实测发现**这些文件普遍含 `sk-...` 真实 API token**（settings.json、settings.self、default.json、providers.json 均含），即使拆 `*.base.json` 也极易把 token 漏过去。V0.2 调整如下：

| 文件 | V0.1 决策 | V0.2 决策 | 原因 |
|---|---|---|---|
| `settings.json` | ⏳ 待合并 | ❌ 永不入库 | 含 `ANTHROPIC_AUTH_TOKEN=sk-...` |
| `settings.local.json` | ❌ 不入 | ❌ 不入 | 机器局部，本机临时权限 |
| `settings.self` | ❌ 不入 | ❌ 不入 | 同 `settings.json`，含 token |
| `default.json` | ⏳ 待合并 | ❌ 永不入库 | 含 token + 本机 nvm 路径 |
| `providers.json` | ⏳ 待合并 | ❌ 永不入库 | 含 `sk-ant-oat01-...` |
| `execution_config.json` | ⏳ 待合并 | ✅ 入 `execution_config.base.json` | 纯结构无 secret |
| `.mcp.json` | ⏳ 待合并 | ✅ 脱敏入 `mcp.base.json`（`$HOME` 占位） | 路径脱敏即可 |
| `.omc-config.json` | ⏳ 待合并 | ❌ 永不入库 | 含 telegram bot token + 本机 nvm 路径 |
| `.omc-version.json` | ⏳ 待合并 | ✅ 入 `.omc-version.base.json` | 纯版本号，无 secret |
| `kimi.json` / `minimax.json` / `selfminimax.json` / `baidu.json` / `anyrouter.json` | ❌ | ❌ | 不变 |
| `hooks/*` | ⏳ V0.2 | ⏳ V0.2 | 重写为 `$CLAUDE_HOME` 相对路径 |

## 子任务

- [x] 1. 建本计划文档
- [x] 2. 实测扫描所有 JSON，识别含 secret 的文件 → 调整决策
- [ ] 3. 建 `global/json/` 目录，复制脱敏后的 `execution_config.base.json` / `mcp.base.json` / `.omc-version.base.json`
- [ ] 4. 写 `install.sh` 的 `merge_json` 子函数（Python 实现，跨平台，不依赖 jq）
- [ ] 5. 写 `install.sh` 的 hook 部署（路径标准化：硬编码 `/home/hoping/.claude/hooks/...` → `$CLAUDE_HOME/hooks/...`，由 install 注入真实路径或保留占位）
- [ ] 6. 升级 `doctor`：用 Python 实现 secret 扫描（`sk-` / `AKIA` / `ghp_` / `xoxb-` / 长 hex / telegram bot token 模式）
- [ ] 7. 升级 `.gitignore`：模式化屏蔽含 token 的 JSON 模式（`**/*-token*.json`、`**/settings*.json`、`**/provider*.json` 等）
- [ ] 8. 写 `tools/scan-secrets.py`（独立可执行，方便手动跑）
- [ ] 9. 更新 `install.sh` 的 `--dry-run` 输出 JSON 合并动作
- [ ] 10. 更新 README 的"当前同步范围"段落
- [ ] 11. 更新 `INVENTORY.md` 决策表
- [ ] 12. smoke：dry-run → check → doctor 三连测
- [ ] 13. 提交（V0.2 commit）

## JSON 合并策略（Python 实现）

```python
# merge.py — 深合并：base ⊕ local
# 同 key 处理：
#   - object → 递归合并
#   - array  → base 优先（local 中追加的 allow-list 项保留为 local 唯一来源）
#   - scalar → local 优先（本机个性化）
```

`install.sh` 调用：
```bash
python3 "$REPO_ROOT/tools/merge_json.py" \
  --base "$REPO_ROOT/global/json/execution_config.base.json" \
  --local "$HOME/.claude/execution_config.json" \
  --out "$HOME/.claude/execution_config.json.tmp" && \
  mv "$HOME/.claude/execution_config.json.tmp" "$HOME/.claude/execution_config.json"
```

## hook 路径标准化策略

V0.1 期间决定 hook 暂不同步。V0.2 落 hook：
- 复制 9 个 hook 到 `hooks/` 目录
- 改写 hook 内部所有 `/home/hoping/.claude/...` 为 `$CLAUDE_HOME/...`
- 改写 hook 内部所有 `/home/hoping/.config/nvm/versions/node/...` 为 `node`（让 shell 解析 PATH）
- install 注入 `export CLAUDE_HOME="$HOME/.claude"`（V0.1 已实现）

## 验收标准

- [ ] `global/json/` 内 3 个 base 文件**不含**任何 `sk-` / 长 hex / bot token 模式
- [ ] `install.sh --dry-run` 输出 JSON 合并目标
- [ ] `install.sh doctor` 跑 Python 扫描器，clean
- [ ] `tools/scan-secrets.py` 独立可执行
- [ ] hook 脚本中**不**含 `/home/hoping` 硬编码
- [ ] INVENTORY.md 决策表与本计划一致
- [ ] smoke 三连测全绿

## 不在本阶段

- CI（V1.0）
- Windows `--copy` 模式实测（V1.0）
- UPGRADE.md 详细迁移说明（V0.2 末补一版）
