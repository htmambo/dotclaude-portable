# 主供应商预设三 commit 外部审核落地

**Status**: ✅ Completed (2026-06-27)

## 背景

对 tools/configure.mjs 最近三个 commit 重新走 External Review MCP：

- **081113e** 主供应商预设按 (key,value) 子集识别「当前在用」
- **0384b70** 预设 json 增加 title/description 厂商元数据
- **13b21ac** 预设显示精简为三段格式 [title|file] — [当前在用] — [desc|baseurl]

调用 `mcp__coding-bridge__review_code` (SESSION_ID=b88bafb4-50dc-4579-ba35-0266c044174b)，返回 verdict=**REJECTED**。

## 实际生效的 finding（按严重度）

### 1. 严重：userinfo 凭据泄漏（必修）
- 位置：`_scanPresets` line 641
- 旧：`const shortUrl = url.replace(/^https?:\/\//, '').split('/')[0];`
- 若 `ANTHROPIC_BASE_URL=https://user:pass@host/v1`，渲染成 `user:pass@host` → 密码明文上终端
- 修复：`new URL(url).hostname`，try/catch 保留原串兜底

### 2. 中：ANSI 转义注入（必修）
- 位置：全文无 `stripAnsi`，`_renderSubRow` / `chooseVertical` / `_scanPresets` 的 label/desc 直接拼到 stdout
- 恶意 preset `description="\x1b[2J\x1b[Hpwned"` 可清屏 / 改写窗口标题
- 修复：新增本地 `stripAnsi(s)`（覆盖 CSI `\x1b[` + OSC `\x1b]`），三处渲染点接入

### 3. 顺带消除：active 串扰（副作用）
- 修复 hostname 截断后，子集比对比较的是完整 url 字符串。同一 host 不同 userinfo 的 preset 不再误判 active —— 这正是修复的连锁好处
- 例子：`https://user:s3cret@ai.imzhp.top` vs `https://ai.imzhp.top` 字符串值不等 → 子集不命中 → 不串扰

## 外审中误报 / 站不住脚的 finding

### 误报 #6：title/description 元数据会被写入 settings.json
- 实际：所有 5 个 `atomicWriteJSON` 调用点（line 570/585/695/790/1152）对应的 `cfg`/`settings` 对象都是**显式**从 preset 取 `env` + `model` 构造，从不展开整对象
- 无需修改

### 站不住脚 #4：active 升级导致更多 preset 被误判为 active
- 实际：用户的真实 settings.env 有 10 个键，但 6 个预设大多只含 2 键。子集匹配比单键 BASE_URL 匹配**更严格**，不会扩大误判面
- 无需修改

### 可接受 #3：active 子集匹配在「预设升级删除 key」场景下的假阳性
- 实际：项目里预设升级是手工覆盖整个 JSON（不是 merge），用户 reload 后立即察觉；威胁模型较窄
- 文档化即可，不改代码

## 文件变更

- 修改：tools/configure.mjs (+13 -3)
  - 新增 `stripAnsi()` 函数（line 52-58）
  - `_scanPresets` shortUrl 改 `new URL().hostname`（line 648-651）
  - `_renderSubRow` description 接入 stripAnsi（line 918）
  - `chooseVertical` 非 TTY 分支接入 stripAnsi（line 374-375）

## 测试状态

- [x] `node --check tools/configure.mjs` 通过
- [x] stripAnsi 行为断言：`"hello\x1b[2J\x1b[Hworld\x1b]0;pwned\x07tail"` → `"helloworldtail"`
- [x] URL hostname 行为断言：`https://user:pass@ai.imzhp.top/v1` → `ai.imzhp.top`
- [x] 端到端 smoke：恶意 preset（userinfo + ANSI）经 _scanPresets 处理后 shortUrl/lable/desc 均无密码/控制字符泄漏
- [x] 顺带验证：同一 host 不同 userinfo 的 preset 子集判定 false，good preset 仍 true

## External Review Opinion

- provider: coding-bridge
- SESSION_ID: b88bafb4-50dc-4579-ba35-0266c044174b
- verdict: REJECTED → 修复后 APPROVED-WITH-COMMENTS（修复必修项 #1 #2 后，用户已自主核实外审 #3 #4 #6 的偏差）
