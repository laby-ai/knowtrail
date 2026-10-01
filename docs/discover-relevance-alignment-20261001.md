# 发现信源筛选智能体对齐记录

压缩包中的“过滤筛选智能体”是发现信源的相关性筛选阶段：按查询词从标题、摘要和正文候选中计算匹配度，给出相关 / 部分相关 / 不相关 / 待核验标签，过滤低相关结果，并展示通过数量与过滤数量。

本次补齐：

- 新增 `src/lib/discover-relevance-stage.ts`，包含中文二元词、英文词、停用词、阈值、排序、状态和统计。
- `/api/discover/search` 返回 `relevanceStage` 和带 `relevance` 的候选；空查询、无主题词、全不相关都有明确状态。
- 发现信源弹窗显示筛选统计、来源类别和相关性徽章；切换网页 / 学术范围会清空上一轮结果，避免混淆。
- 搜索请求支持 AbortController；关闭或切换范围不会让旧请求覆盖新结果。
- 搜索结果保留当前文献本 ID，未改变账号和数据隔离。

验证：`test-discover-relevance-stage.ts`、`test-discover-search-provider.ts`、`test-discovered-source-upload.ts`、`test-discover-relevance-route.ts`、候选页面模拟搜索与筛选统计均通过。
