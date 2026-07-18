# Review Tool Result Samples

真实 transcript 提取的 coding-bridge `tool_result` 样本，作为 verdict 解析器的测试 fixture。

## 结构

每个文件：
```json
{
  "_tool_name": "mcp__coding-bridge__review_code|review_plan",
  "_source_transcript": "<session>.jsonl",
  "tool_result_content": [{"type":"text","text":"{\"result\":{\"success\":true,\"SESSION_ID\":\"...\",\"agent_messages\":\"...\"}}"}]
}
```

## verdict 提取契约（parser 据此实现）

1. 解析 `tool_result_content[0].text` 为 JSON -> `result.agent_messages`。
2. verdict 提取顺序：
   - (a) ``` ```json ``` fence 内 JSON 的 `verdict` 字段（kimi 形态）。
   - (b) 正则匹配 `APPROVED|REJECTED|NEEDS_CHANGES`（coding-bridge 形态，NEEDS_CHANGES 视为 NOT_APPROVED）。
3. 无法解析 -> `UNKNOWN` -> 视为 NOT_APPROVED（fail-closed）。

## 发现要点

- coding-bridge `agent_messages` 为 markdown，verdict 嵌在正文，**无结构化字段**。
- `review_code` verdict 词集含 `NEEDS_CHANGES`（非仅 APPROVED/REJECTED）。
- `review_plan` verdict 在 `## (N) Verdict` 段或审查结论标题。
