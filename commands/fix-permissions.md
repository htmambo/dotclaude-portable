---
description: 一键给当前项目补 defaultMode + 高危 deny 兜底 + fullauto 文件 allow 规则
argument-hint: "[acceptEdits|bypassPermissions]"  -- 可选，默认 bypassPermissions
---

任务：直接修改**当前工作目录**下项目的 `.claude/settings.local.json`，
合并三组配置以配合 `fullauto` skill 真正零询问运行：

1. 顶层 `defaultMode`
2. 高危 `deny` 兜底规则
3. `fullauto` 所需的文件读写 `allow` 规则

**关键执行要求**：
- ❌ **不要输出 diff 预览**——直接 Read → 计算 → Edit/Write
- ❌ **不要等用户确认**——本命令的所有变更都是纯增量的安全操作
- ❌ **不要询问"是否继续"**——直接做完
- ✅ **必须给 fork bomb 规则中的 `(` `)` 加 `\` 转义**——Claude 的
  permission rule 解析器会把无转义的 `(` `)` 当作 glob/正则元字符，
  `Bash(:(){ :|:& };:)` 这种写法会触发非法模式错误，导致 Claude
  启动失败。正确写法：`Bash(:\(\){ :|:& };:)`。
- ❌ **不要把规则"包装"成 shell 安全的字符串**——`json.dumps` 会处理所有必要的转义
- ✅ 用最小化 Edit 追加；如果失败才用 Write 覆盖
- ✅ 备份到 `<path>.bak`（如不存在）
- ✅ **写入前先做规范化**（见步骤 3.5）——保证转义形式一致

---

## 执行步骤

### 步骤 1：定位并读取
- 路径：`<cwd>/.claude/settings.local.json`
- 用 `Read` 读取整个文件
- 若文件不存在，直接以 `{}` 初始化（用 `Write` 创建）

### 步骤 2：解析
提取这三个字段（不存在则视为初始值）：

```typescript
defaultMode:        string | undefined
permissions.allow:  string[]
permissions.deny:   string[]
```

如果 JSON 损坏（parse error），**报告并中止**。

### 步骤 3：计算目标值

**A. `defaultMode`**

- 用户提供 `$1` 时用参数值（白名单：`acceptEdits` / `bypassPermissions` / `default` / `plan`）
- 否则用 `"bypassPermissions"`
- 与已有值相同则跳过；不同则**直接覆盖**（这是顶层字段，不算破坏性）

**B. `permissions.deny`（10 条）**

去重合并到现有 deny 末尾：

```
Bash(rm -rf *)
Bash(rm -fr *)
Bash(:\(\){ :|:& };:)
Bash(curl * | bash*)
Bash(curl * | sh*)
Bash(wget * | sh*)
Bash(wget * | bash*)
Bash(chmod -R 777 /)
Bash(dd if=* of=/dev/*)
Bash(mkfs.*)
```

**C. `permissions.allow`（12 条 fullauto 相关）**

去重合并到现有 allow 末尾：

```
Read(.omc/**)
Read(.omc/**/**)
Edit(.omc/**)
Edit(.omc/**/**)
Write(.omc/**)
Write(.omc/**/**)
Bash(rm .omc/**)
Bash(rm -rf .omc/**)
Bash(mkdir -p .omc/**)
Bash(ls .omc/**)
Bash(touch .omc/**)
Bash(mv .omc/**)
```

**D. 保留**
- 用户的 `permissions.allow` 已有规则**完全不动**——只追加
- `permissions` 之外的字段**完全不动**

### 步骤 3.5：规范化（关键修复步骤！）

在合并之前，**先规范化现有 deny/allow 规则**——确保 `Bash(:(){ :|:& };:)`
统一为转义形式 `Bash(:\(\){ :|:& };:)`。Claude permission rule 解析器会把
`(` `)` 当作 glob/正则元字符，缺少 `\` 会触发非法模式错误。

**核心原则**：
- `Bash(...:...)` 模式中**只有 `(` `)` 之前的 `\` 是必需的**——其他字符
  （`:` `;` `&` `|`）在 Claude permission 规则里是字面字符。
- 已有规则可能无转义（旧版本遗留），需统一为带转义形式。

**规范化函数**：

```python
def normalize(rule: str) -> str:
    """保证 fork bomb 规则统一带 \\( \\) 转义"""
    # 只针对 fork bomb 模式加转义，避免影响其他规则
    if rule == "Bash(:(){ :|:& };:)":
        return "Bash(:\\(\\){ :|:& };:)"
    if rule == "Bash(:\\(\\){ :|:& };:)":
        return "Bash(:\\(\\){ :|:& };:)"  # 幂等
    return rule  # 其他规则原样保留
```

**对现有 deny 和 allow 应用 normalize**（用 dict 保持顺序同时去重）：

```python
data["permissions"]["deny"]  = list(dict.fromkeys(
    normalize(d) for d in data["permissions"].get("deny",  [])))
data["permissions"]["allow"] = list(dict.fromkeys(
    normalize(a) for a in data["permissions"].get("allow", [])))
```

注意：用 dict 保持插入顺序（Python 3.7+）同时去重。
这样既能把旧的 `Bash(:(){ :|:& };:)` 升级为 `Bash(:\(\){ :|:& };:)`，
又对已经带转义的版本保持幂等。

### 步骤 4：直接执行 Edit/Write

**优先用 Edit 增量修改**（影响最小）：

1. **追加 deny**：定位到 `]\n  }`（permissions 对象结束前的 deny 数组关闭），在 `]` 前插入新条目
2. **追加 allow**：定位到当前 allow 数组的 `]` 关闭符，在 `]` 前插入新条目
3. **确保 defaultMode**：如果缺失，在最外层 `}` 前插入 `"defaultMode": "bypassPermissions"`
4. 如果 Edit 匹配失败（如格式特殊），改用 `Write` 整体覆盖

**Write 风格要求**：
- 缩进 2 空格
- 数组每行一条，字符串带双引号
- 末尾保留一个换行
- 不动 `permissions` 之外的字段

**Python 写法参考**（如 Edit/Write 不可靠）：

```python
import json
from pathlib import Path

def normalize(rule: str) -> str:
    """保证 fork bomb 规则统一带 \\( \\) 转义（幂等）"""
    if rule in ("Bash(:(){ :|:& };:)", "Bash(:\\(\\){ :|:& };:)"):
        return "Bash(:\\(\\){ :|:& };:)"
    return rule  # 其他规则原样保留

path = Path("<cwd>/.claude/settings.local.json")
data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

# 备份（仅一次）
bak = path.with_suffix(".json.bak")
if not bak.exists() and path.exists():
    bak.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")

data.setdefault("permissions", {})
data["permissions"].setdefault("allow", [])
data["permissions"].setdefault("deny", [])

# === 步骤 3.5: 规范化（升级旧的 fork bomb 规则为带转义形式）+ 去重 ===
# 用 dict 保持插入顺序同时去重;normalize 把无转义升级为带转义
data["permissions"]["deny"]  = list(dict.fromkeys(
    normalize(d) for d in data["permissions"]["deny"]))
data["permissions"]["allow"] = list(dict.fromkeys(
    normalize(a) for a in data["permissions"]["allow"]))

DENY = ["Bash(rm -rf *)", "Bash(rm -fr *)", "Bash(:\\(\\){ :|:& };:)",
        "Bash(curl * | bash*)", "Bash(curl * | sh*)",
        "Bash(wget * | sh*)", "Bash(wget * | bash*)",
        "Bash(chmod -R 777 /)", "Bash(dd if=* of=/dev/*)", "Bash(mkfs.*)"]

ALLOW = ["Read(.omc/**)", "Read(.omc/**/**)",
         "Edit(.omc/**)", "Edit(.omc/**/**)",
         "Write(.omc/**)", "Write(.omc/**/**)",
         "Bash(rm .omc/**)", "Bash(rm -rf .omc/**)",
         "Bash(mkdir -p .omc/**)", "Bash(ls .omc/**)",
         "Bash(touch .omc/**)", "Bash(mv .omc/**)"]

ex_deny  = set(data["permissions"]["deny"])
ex_allow = set(data["permissions"]["allow"])
data["permissions"]["deny"]  += [d for d in DENY  if d not in ex_deny]
data["permissions"]["allow"] += [a for a in ALLOW if a not in ex_allow]

target_mode = "$1" if "$1" in ["acceptEdits","bypassPermissions","default","plan"] else "bypassPermissions"
data["defaultMode"] = target_mode

path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
```

**Write/Edit 时的精确字符串**（不要做"安全包装"）：

| 列表 | 字符串（精确） |
|------|---------------|
| DENY[2] | `Bash(:\(\){ :|:& };:)` ← parens **必须**带 `\` |
| ALLOW  | `.omc/**` 等简单路径，无需转义 |

写入 JSON 时，`json.dumps` 会自动处理字符串所需的引号和换行。
**必须**在 fork bomb 的 `(` `)` 前加 `\`——Claude permission rule 解析器
会将其当作 glob/正则元字符，缺转义会破坏启动。

### 步骤 5：输出摘要（不再询问）

执行完成后，**只**输出以下信息（**不要询问下一步**）：

```
=== /fix-permissions 完成 ===
defaultMode:   <旧值> → <新值>
deny:          已有 N 条 / 新增 M 条 / 总计 K 条
allow:         已有 P 条 / 新增 Q 条 / 总计 R 条
备份:          <path>.bak (已存在则跳过)

⚠️  重要：必须重启 Claude Code 让 defaultMode 生效
回滚: git checkout -- .claude/settings.local.json
```

---

## 铁律
- ❌ **不输出 diff 预览**——已移到步骤 5 的执行后摘要
- ❌ **不等用户确认**——所有变更都是纯增量的安全操作
- ❌ **不删 `permissions.allow` 用户已有规则**——只追加
- ❌ **不写高危命令到 `allow`**——只加 `.omc/**` 相关
- ❌ **不动 `permissions` 之外的字段**
- ✅ **始终幂等**——重复执行不会产生重复条目
- ✅ **只备份一次**——已有 `.bak` 则跳过

---

## 失败兜底
- JSON 解析失败 → 报告错误位置，**不写文件**，提示用户手动修复
- 写入权限不足 → 报告并提示 `chmod` 或 `sudo`
- `defaultMode` 值为非白名单值 → 拒绝写入，列出合法选项
