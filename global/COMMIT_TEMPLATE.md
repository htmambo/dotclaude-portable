# Git 提交信息模板

## 请严格按照此模板填写

```
<type>(<scope>): <简短描述，中文，不超过50字>

详细说明（必填）：
- 主要改动点1
- 主要改动点2
- 主要改动点3

技术细节（可选）：
- 使用的技术或方法
- 解决的关键问题

文件变更：
- 新增：xxx.py
- 修改：yyy.py
- 删除：zzz.py

测试状态：
- [ ] 单元测试通过
- [ ] 功能测试通过
- [ ] 代码审查完成

相关 Issue：Closes #xxx

> OMC trailers:
> Constraint: <限制条件，例：仅修改 docs/Task/>
> Rejected: <备选方案> | <拒绝原因>
> Directive: <关键决策来源，例：审核报告 / 用户明确要求>
> Confidence: <高|中|低> | <依据>
> Scope-risk: <本次改动可能影响到的边界>
> Not-tested: <未覆盖的验证项>
```

## 类型说明
- feat: 新功能
- fix: Bug修复
- docs: 文档
- refactor: 重构
- perf: 性能优化
- test: 测试
- chore: 构建/工具

## 填写示例

```
feat(cookie): 实现 Cookie 完整管理系统

详细说明：
- 实现 Cookie 的 CRUD 操作
- 支持 JSON/Pickle/Netscape 三种格式导入导出
- 添加自动持久化和会话管理
- 提供 Cookie 过滤、验证、转换功能

技术细节：
- 使用 Playwright 的 BrowserContext API
- 异步文件操作提高性能
- 支持多种 Cookie 格式互转

文件变更：
- 新增：cookie_manager.py (核心类)
- 新增：tests/test_cookie.py (测试)
- 新增：examples/cookie_demo.py (示例)
- 修改：enhanced_browser.py (集成 Cookie 管理)
- 更新：README.md (文档)

测试状态：
- [x] 单元测试通过 (20个用例)
- [x] 功能测试通过
- [x] 代码审查完成

Closes #23

> OMC trailers:
> Constraint: 仅在 cookie 子系统内
> Rejected: 直接用 requests 调接口 | 缺乏会话管理
> Directive: 用户明确要求支持 Netscape 格式
> Confidence: 高 | 单元测试覆盖 95% 分支
> Scope-risk: enhanced_browser.py 公共 API 签名未变
> Not-tested: 并发场景下文件锁行为
```

