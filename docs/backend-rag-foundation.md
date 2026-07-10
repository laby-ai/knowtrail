# 后端 RAG 基础层实现记录

日期：2026-06-16

## 本轮范围

第一轮先实现 NotebookLM-like 后端的最小可用基础层：

`selected papers -> source chunks -> keyword retrieval -> grounded prompt -> citations`

这样做的目的是先把前后端合同固定下来，让中间对话区可以拿到真实来源片段，而不是继续由前端用文献摘要伪造引用。

## 已完成

- 新增 `src/lib/rag.ts`
  - `buildSourceChunks()`：把文献对象规范化为稳定 `sourceId/chunkId` 的 chunks。
  - `retrieveRelevantChunks()`：基于问题做轻量关键词检索和排序。
  - `buildGroundedContext()`：生成给模型的 grounded prompt context，并返回 citations。
- `/api/ai/chat`
  - 不再直接把每篇资料 `rawContent.slice(0, 12000)` 拼进 prompt。
  - 先检索相关 chunks，再把 `sourceId`、`chunkId`、片段编号和摘录传给模型。
  - SSE 开始时返回 `citations` 事件，随后继续流式返回 `content`。
  - 新增 `src/lib/grounded-retrieval.ts`，chat retrieval 优先级为：持久化 zvec -> 持久化 source chunks 关键词检索 -> 请求内 papers 兜底。
  - SSE 的 `citations` 事件现在附带 `retrieval.mode`、`persistedSourceCount`、`vectorIndexedSourceCount`、`degraded` 和 `reason`，便于前端和自动化区分引用来源，并把降级原因直接展示给用户。
  - 支持 `debugRetrievalOnly: true`，直接返回 citations/retrieval/promptContextLength，不调用 LLM，供发布 smoke 和自动化断言使用。
- `EditorPanel`
  - 向 chat route 传入 `paper.id/fileName/fileType`。
  - 优先展示后端返回的 citations。
  - 引用卡片展示资料标题和页码字段。
- `LibraryPanel`
  - 上传成功后保存 `ingestionStatus`、`ingestionChunkCount` 和 `vectorIndex`。
  - 定期读取 `/api/ingestion/sources`，把后端 source/chunk/vector 状态合并回前端资料库。
  - 每篇资料展示轻量状态标签：`片段 n`、`索引 n`、`索引中`、`索引失败`。
- 类型与测试
  - 扩展 `Citation` 类型，支持 `sourceId/chunkId/sourceTitle/score/chunkIndex/page`。
  - 新增 `pnpm test:rag`。
  - `pnpm validate` 已纳入 `test:rag`。
  - `pnpm smoke:openai-compatible` 已增加 chat grounded context 检查。
- 向量生产能力
  - 新增 `src/lib/vector-store.ts`，使用 `@zvec/zvec` 作为本地生产级向量库。
  - zvec collection 按 embedding 维度分目录持久化，默认路径 `.data/zvec`，生产应设置 `ZVEC_STORE_PATH`。
  - 支持 chunk embeddings 的 `upsert` 与向量查询，并返回可展示的 citation metadata。
  - 新增 `pnpm test:vector-store`，会真实创建 zvec collection、写入向量并检索回来。
  - 模型设置、runtime config、`/api/ai/test-config` 已支持 `embeddingModel` 和 `/embeddings` 探测。
- ingestion source store
  - 新增 `src/lib/ingestion-store.ts`，把解析后的 source、chunks、stage 状态和 vector index 状态持久化到 `SOURCE_STORE_PATH`。
  - `ingestion-store` 已抽出 `SourceStoreAdapter` 边界；当前支持 `LocalJsonSourceStoreAdapter` 与 `PostgresSourceStoreAdapter`，上层 ingestion/chat/studio route 不直接依赖 JSON 文件读写。
  - `SOURCE_STORE_ADAPTER=postgres` 且提供 `DATABASE_URL` 时，Postgres adapter 会自动创建 `lingbi_source_store` 兼容快照表，并同步维护 `lingbi_sources`、`lingbi_source_chunks`、`lingbi_ingestion_stages` 三张规范化表；未配置数据库时 `/api/health` 会显示 `configured=false`，不会假装可用。
  - Postgres 写入会在同一事务中更新兼容 payload 并镜像规范化表；读取时优先从 `lingbi_sources/chunks/stages` 重建 source store，规范化表为空时才回退旧 `jsonb` 快照。
  - 新增 `pnpm smoke:postgres-source-store`，只读取专用 `POSTGRES_SMOKE_DATABASE_URL`，不隐式使用生产 `DATABASE_URL`；脚本在事务内创建临时 schema、执行 normalized schema DDL、插入 source/chunk/stage 样例、验证 normalized read-model reconstruction 并 rollback。
  - 新增 `listReadySourceChunks()` 查询契约，grounded retrieval 会优先请求 ready chunks；Postgres adapter 在该路径下直接查询 `lingbi_sources` 和 `lingbi_source_chunks`，并支持 `query/topK` SQL 候选裁剪，不需要先重建整份 source store。若 query 裁剪 0 命中，会回退到同 source scope 的 ready chunks，避免 Studio prompt 与原文措辞不一致时误降级到请求内资料。
  - Postgres chunk schema 已增加 `lingbi_source_chunks_fts_idx` GIN 表达式索引，对 `source_title/paper_short_name/text` 建立 `to_tsvector('simple', ...)`；`pnpm test:ingestion` 覆盖 DDL 契约，`pnpm smoke:postgres-source-store` 在有专用测试库时会确认索引实际创建。默认查询仍保守使用参数化 `ILIKE` 裁剪，设置 `POSTGRES_READY_CHUNK_SEARCH=fts` 后会用 `plainto_tsquery('simple', ...)` 和 `ts_rank` 对候选排序；`/api/health` 会暴露 `capabilities.sourceStore.readyChunkSearch.mode`。
  - `/api/upload` 在文件解析和 AI 分析后会调用 ingestion store，返回 `ingestionStatus`、`ingestionChunkCount` 和 `vectorIndex`。
  - 新增 `/api/ingestion/sources`，可查询上传资料的后端 ingestion 状态，便于前端资料库和自动化 smoke test 对齐。
  - `/api/health` 增加 `sourceStore` 状态，并暴露 `readyChunkSearch.mode`，用于确认 Postgres ready chunk 查询当前是默认 `ilike` 还是灰度 `fts`。
  - 新增 `pnpm test:ingestion`，覆盖 source store、stage transition、chunk 持久化、可选 embedding 写入 zvec、citation metadata 查询、无 embedding 配置时的 keyword-only fallback。
  - MinerU PDF 图表提取已纳入同一 source store：`stages` 增加 `mineru`，并新增 `mineru.status/figureCount/error/updatedAt`，`/api/upload` 的后台 MinerU 任务会回写 pending/running/succeeded/failed/error 状态。
  - `/api/ingestion/sources` 列表会返回 `stages` 与 `mineru`，前端资料库轮询同一个 ingestion 状态接口展示“图表提取中 / 图表 n / 图表失败”，不再只依赖上传响应里的独立 `mineruStatus`。
  - 新增 `src/lib/mineru-job.ts`，统一管理 MinerU 后台任务的 `MINERU_JOB_TIMEOUT_MS`、`MINERU_JOB_MAX_RETRIES`、`MINERU_JOB_RETRY_DELAY_MS`，并把 timeout/auth/rate_limit/upstream/network/unknown 做成可测试错误分类。
  - `/api/upload` 的 MinerU 后台触发已加 AbortController 超时、可重试错误重试、最终失败分类回写；未配置 `MINERU_API_TOKEN` 时会标记 `mineru.status=not_configured`，不再显示为长期 pending。
  - `/api/health` 增加 `capabilities.mineruJob`，暴露 MinerU 是否配置以及 job timeout/retry/delay 参数；`pnpm test:mineru-job` 已纳入 `pnpm validate`。
- grounded retrieval 测试
  - 新增 `pnpm test:grounded-retrieval`，覆盖 chat 优先使用持久化 zvec、无 embedding 配置时回退持久 chunks、请求内 papers 兜底、selected source scope 过滤，并断言 `degraded/reason` 能解释当前检索是否降级。
- citation 对齐审计
  - 新增 `src/lib/citation-audit.ts`，对模型输出中的 `[1]`、`[2]` 编号做服务端校验，区分 `pass`、`missing-markers`、`invalid-markers` 和无 citation 场景。
  - `/api/ai/chat` 与 `/api/ai/report` 在 SSE 结束前发送 `citationAudit` 事件，前端可据此提示“回答未完成来源对齐”或“不存在的引用编号”。
  - `/api/ai/chat` 与 `/api/ai/report` 的 `debugRetrievalOnly` 支持传入 `debugAnswerText`，可在不调用外部模型的 smoke test 中验证 citation audit。
  - `EditorPanel` 已消费 `citationAudit` SSE 事件，并在 assistant 消息下方展示引用编号状态：通过、未标号或非法编号。
  - 新增 `pnpm test:citation-audit` 并纳入 `pnpm validate`，覆盖正确编号、缺失编号、非法编号和无 citation 四类情况。
- 发布入口与验证稳定性
  - 首页“进入工作台”和“先配置模型”按钮会写入 `#workbench` / `#workbench-settings`，直接访问对应 hash 也会进入工作台，避免浏览器自动化和公网分享链接依赖纯前端瞬时状态。
  - 首页主 CTA 增加稳定 `data-testid`，真实浏览器验证可以精确点击 `hero-enter-workbench`，不再被多个同名按钮干扰。
- 真实模型服务 smoke
  - 新增 `pnpm smoke:real-openai-compatible`，从 `OPENAI_COMPAT_API_BASE`/`OPENAI_COMPAT_API_KEY` 或 `ARK_API_BASE`/`ARK_AGENTPLAN_API_KEY` 读取真实 OpenAI-compatible 配置；没有真实 Base/Key 时返回 `skipped: true`，不会误报成功接入。
  - 脚本用低 `max_tokens` 文本请求验证 chat completions；配置 `OPENAI_COMPAT_EMBEDDING_MODEL` 或 `ARK_EMBEDDING_MODEL` 时，会调用真实 `/embeddings`、把返回向量写入 `@zvec/zvec`，并查询回同一 `chunkId` 验证 citation metadata。
  - `llmInvoke` 的 OpenAI-compatible payload 已支持可选 `max_tokens`，真实 smoke 和后续低成本端到端测试可以约束费用风险。
  - 该 smoke 不输出 API Key，错误会通过 `redactRuntimeAISecrets()` 脱敏；涉及真实服务的轮次仍必须运行敏感扫描。
- grounded chat smoke 加强
  - `/api/ai/chat` 请求体支持可选 `maxTokens`，路由会限制在 `1..4096` 后传给 OpenAI-compatible `max_tokens`，用于真实/Mock 端到端 smoke 控制费用。
  - `pnpm smoke:openai-compatible` 已断言 chat SSE 返回 `citations`、`retrieval.mode`、最终 `citationAudit.status=pass`，并确认传给上游的请求体包含低 `max_tokens`；这使中心对话主轴的引用闭环成为发布检查，而不是只验证模型能返回文字。
- Studio grounded context
  - `/api/ai/knowledge-cards` 已复用 `buildGroundedRetrievalContext`，优先用持久化 source/zvec 证据生成知识卡片，并返回 citations/retrieval metadata；`retrieval` 统一包含 `degraded/reason`。
  - `/api/ai/knowledge-cards` 已复用 `citationAudit` 审计：服务端检查卡片 `content/extra` 是否使用 `[1]`、`[2]` 等证据编号，`debugRetrievalOnly` 支持 `debugAnswerText` 做无外部模型审计 smoke。
  - `/api/ai/report` 已复用 `buildGroundedRetrievalContext`，SSE 开始时返回 citations/retrieval metadata，报告正文 prompt 使用检索证据而不是各自重新拼全文。
  - `/api/ai/podcast` 已复用 `buildGroundedRetrievalContext`，修正前端传 `content`、后端只读 `text` 导致的 400 问题；播客生成 prompt 会附加同一套检索证据，并支持 `debugRetrievalOnly` 做不调用外部音频服务的路由验证。没有资料、只传文本时会返回明确的 `request-text` 降级原因。
  - `/api/ai/ppt` 已复用 `buildGroundedRetrievalContext`，普通图像式 PPT 的 outline/description 阶段优先使用持久化检索证据；没有持久化结果时才回退请求内 content/rawContent。该路由支持 `debugRetrievalOnly`，避免验证时触发 LLM/生图，并返回统一 retrieval metadata。
  - `/api/ai/ppt-v2` 已复用 `buildGroundedRetrievalContext`，ArcDeck 学术报告管线的 discourse parse / slide plan 输入优先使用持久化 evidence outline；PPTX 封面和文件元信息仍使用原始论文，避免把标题替换成内部检索摘要。该路由支持 `debugRetrievalOnly`，避免验证时触发 LLM/PPTX 构建，并返回统一 retrieval metadata。
  - `EditorPanel` 和当前产物面板向对应接口传入 `id/fileName/fileType/shortName/rawContent`，使后端可以按选中资料 scope 查询持久化 source。
  - `AudioPanel` 已向播客接口传入选中文献的 `id/fileName/fileType/shortName/rawContent` 和 `aiConfig`，使播客可按同一 source scope 检索。
  - `PresentationPanel` 已向普通 PPT 接口传入选中文献的 `id/fileName/fileType/shortName/rawContent` 和 `aiConfig`，并修正生成回调依赖，避免页数/风格更新后仍使用旧闭包。
  - `PresentationPanel2` 已向学术报告 PPT 接口传入 `aiConfig`，继续使用完整论文 id/fileName/fileType/fileUrl/MinerU 图表字段。
  - `pnpm test:studio-grounded-routes` 覆盖知识卡片、报告、播客、普通 PPT 和 PPT-v2 路由的 `debugRetrievalOnly` 检索路径。
- 前端用户配置链路 smoke
  - `AISettingsDialog` 在测试连接时展示文本问答、视觉理解、向量检索和播客音频四类检查清单，避免用户只看到一句成功/失败而不知道哪类能力可用。
  - `pnpm smoke:model-config-ui` 已覆盖从 `#workbench-settings` 打开模型设置、填写 API Base/API Key/文本模型/视觉模型/向量模型/播客音色、四类检查清单、localStorage 持久化、清空配置后的部署默认提示，以及上游认证失败时的 Key 脱敏。
  - `pnpm smoke:configured-workbench-flow` 真实启动浏览器工作台，预置一组仅用于检测泄漏的旧版浏览器配置，验证应用会清除该配置，且 `/api/upload` multipart 与中央 `/api/ai/chat` SSE 请求均不携带 provider 凭据。
  - 该 smoke 同时断言上传资料自动选中、中央对话渲染引用 UI 和检索状态，避免只验证设置状态而没有覆盖实际工作台链路。
- Studio evidence 可见性
  - `pnpm smoke:workbench-studio-ui` 真实上传资料后验证演示文稿、结构化 PPT 和资料脉络的无资料禁用态、有资料可用态，以及 PPT 长任务的等待、取消和恢复文案；请求必须带选中资料，同时不得带浏览器 provider 凭据。
  - 产品中心导航只负责切换真实工作区，生成动作必须由各工作区内的明确按钮触发。
  - `EditorPanel` 的中央对话 retrieval badge 已展示 `retrieval.reason`，当向量索引缺失、未命中或回退到请求内资料时，用户能直接看到“为什么不是向量检索”。
  - 新增 `pnpm smoke:studio-evidence-ui`，真实浏览器上传资料后分别点击中心“生成综述报告”和右侧“知识卡片”，断言报告展示 `citationAudit`、`retrieval` 和可展开来源，知识卡片展示 grounded evidence 状态和引用页码。
- 学术 PPT 长任务质量提示 smoke
  - `PresentationPanel2` 会把 `/api/ai/ppt-v2` 返回的 `X-LLM-Observability` 中 `failedStages/fallbackStages` 保留到成功态质量警告，而不是在生成完成后清空进度文案。
  - 新增 `pnpm smoke:studio-quality-warning-ui`，真实浏览器上传资料、点击右侧学术报告，模拟 PPT-v2 返回降级观测头，断言成功态展示“部分环节降级处理”、列出 fallback stage，并且下载按钮仍可用。
- PPT 文件级输出 smoke
  - `buildAcademicPptx` 已导出给文件级 smoke 使用，避免只用伪二进制判断 PPT-v2 成功。
  - 新增 `pnpm smoke:ppt-file-output`：普通 PPT 走真实浏览器上传、右侧生成、显示“证据状态”与引用降级原因、点击“导出 PPTX”并保存下载文件；脚本用 JSZip 解包检查 `[Content_Types].xml`、`ppt/presentation.xml`、`ppt/slides/slide*.xml` 和预期标题文本。
  - 同一 smoke 会直接调用学术 PPT-v2 的 `pptxgenjs` 构建器，验证后端生成的 PPTX 至少包含 5 页 slide XML 和标题文本，补上“能下载”之外的文件可打开证据。
- 播客长任务轮询
  - `/api/ai/podcast` 已补齐 `GET ?taskId=` 状态查询契约，支持 `PODCAST_STATUS_URL_TEMPLATE` 对接异步音频上游；未配置状态模板时返回 `running/not_configured`，前端会继续展示等待态并在超时后提示稍后重试。
  - `StudioPanel` 的播客入口会保留“任务已提交/等待音频生成”后端消息和后端返回的 `citations/retrieval`，轮询 `completed/failed/running` 状态，成功后展示音频播放器与证据状态，失败后恢复生成按钮并显示可重试错误。
  - 新增 `pnpm test:podcast-status` 和 `pnpm smoke:podcast-polling-ui`，分别覆盖后端状态映射、缺少 `taskId`、未配置状态模板降级，以及浏览器真实点击播客入口后的完成/失败轮询路径；完成路径会断言右侧播客产物展示 grounded evidence 与降级原因。
- Doubao AgentPlan TTS 真实播客音频
  - `/api/ai/podcast` 现在优先使用 `Doubao AgentPlan TTS_TTS_ENDPOINT=https://Doubao AgentPlan TTS.bytedance.com/api/v3/plan/tts/unidirectional`、`Doubao AgentPlan TTS_TTS_RESOURCE_ID=seed-tts-2.0`、`Doubao AgentPlan TTS_TTS_SPEAKER` 和私有 `Doubao AgentPlan TTS_TTS_API_KEY`（可回退到 `ARK_AGENTPLAN_API_KEY`）合成音频；响应会返回 `provider=Doubao AgentPlan TTS-tts-v3` 和 `audioUrl`。
  - `RuntimeAIConfig` 新增 `ttsSpeaker`，右侧播客请求会优先使用用户在模型设置里填写的播客音色；未填写时再回退部署环境的 `Doubao AgentPlan TTS_TTS_SPEAKER/ARK_TTS_SPEAKER`。Doubao AgentPlan TTS API Key 优先使用部署环境私有 `Doubao AgentPlan TTS_TTS_API_KEY/ARK_AGENTPLAN_API_KEY`，没有部署私有 key 时可使用当次请求携带的用户 `apiKey`，错误与日志继续脱敏。
  - Doubao AgentPlan TTS 返回音频二进制或 base64 时会通过统一 `storeFile/resolveFileUrl` 进入本地 uploads 或生产对象存储；返回 `audio_url` 时直接透传 URL。错误消息会脱敏 key 和 Authorization。
  - 新增 `pnpm test:Doubao AgentPlan TTS-tts` 用本地 mock 校验 Resource-Id、speaker、音频参数和 `audio_url` 解析，并覆盖 Doubao AgentPlan TTS `401 Invalid X-Api-Key` 会被分类为不可重试的 `auth` 错误。
  - 新增 `pnpm smoke:real-Doubao AgentPlan TTS-tts`，每轮可直接调用真实 Doubao AgentPlan TTS，输出 `PASS/FAIL`、`errorType`、`upstreamStatus`、`requestId` 和音频 URL 类型，不输出 API Key。`pnpm smoke:real-studio-products` 在检测到 `Doubao AgentPlan TTS_TTS_*`/`ARK_AGENTPLAN_API_KEY` 私有配置后会执行“podcast real Doubao AgentPlan TTS audio generation”，没有配置时只报 SKIP，不把 grounded context 当成真实音频通过。
  - 真实基线注意：Ark/OpenAI-compatible 文本与 embedding key 通过不代表 Doubao AgentPlan TTS key 一定通过；如果 Doubao AgentPlan TTS 返回 `Invalid X-Api-Key`，前端会展示“Doubao AgentPlan TTS 鉴权失败”并提示更换有效的 Doubao AgentPlan TTS/agent plan key。

## 当前边界

- zvec 向量库能力已经接入并测试通过，上传后的 ingestion pipeline 已开始把 source/chunks 和可选 embedding index 写入服务端持久化存储。
- `/api/ai/chat` 已优先查询 zvec / ready source chunks；当没有 query embedding 能力或 zvec 无结果时，会回退到持久 chunks 的关键词检索，再回退请求内 papers。Postgres 模式下 ready chunks 可直接来自 `lingbi_source_chunks`，并按问题文本和候选上限先做 SQL 级裁剪；schema 已有 chunk 级 GIN 全文索引，`POSTGRES_READY_CHUNK_SEARCH=fts` 可启用 `ts_rank` 候选排序。
- citation 编号由 prompt context 顺序决定，服务端已能审计模型是否引用了不存在编号或完全未标号；前端对 chat/report/knowledge cards 已展示 `citationAudit` 状态，Studio 其它生成类产物后续可继续复用。
- 2026-06-17 真实 Studio 产品链路已跑通：`pnpm smoke:real-studio-products` 在私有 `.env.real.local` 配置下完成上传 -> 持久化 chunks -> persisted-vector retrieval -> 知识卡片 -> 报告 SSE -> 播客 Doubao AgentPlan TTS 真实音频 -> PPT-v2 真实 PPTX。所有 Studio 产物均返回 citation/retrieval/citationAudit，PPT-v2 严格检查 `fallbacks=0` 才算通过。
- PPT-v2 已把 discourse parsing、slide structure、critic 和 commitment check 从慢 LLM fallback 阶段改为证据优先的确定性正式路径；LLM 只负责正文页内容生成。2026-06-17 的严格真实 PPT-v2 生成耗时约 270s，4 次真实模型调用全部成功，`observability.fallbacks=0`。新增 `pnpm audit:pptx-quality` 解包真实 PPTX，检查 slide XML、占位符和薄页；最新 6 页 PPTX 通过，最后一页从 18 字薄页提升到 80 字总结页。报告 SSE 改为先发送阶段进度，再用带短重试的完整生成结果按块返回，避免上游中途断流直接破坏用户体验。
- Linux 部署包新增 `pnpm smoke:linux-package-products` 交付审计：最新包必须包含真实 Ark/OpenAI-compatible、Doubao AgentPlan TTS、右侧 Studio、证据 UI、PPTX 质量门、runtime health 和 validate 入口；包内 `BUNDLE_MANIFEST.json` 必须列出这些产品路径命令。打包时排除 `.env.real.local`、`.data`、`.logs`、`public/uploads`、`public/mineru-figures`，避免服务器交付包夹带私有密钥或运行期用户资料。
- OpenAI-compatible 和 Doubao AgentPlan TTS 调用新增 transient retry：只重试 `fetch failed`、`terminated`、429/5xx 等瞬时错误，不重试鉴权、权限或参数错误；错误继续通过脱敏分类返回给前端。

## 下一步

1. 将真实 Studio smoke 产物保存为可回放证据包：保留 PPTX、播客音频 URL 类型、报告摘要和知识卡片摘要，方便每小时自动化对比质量，而不是只看 PASS/FAIL。
2. 在有真实 `POSTGRES_SMOKE_DATABASE_URL` 的环境中跑一次 Postgres smoke，并补一个含 `POSTGRES_READY_CHUNK_SEARCH=fts` 的端到端 ready chunk 查询 smoke；随后为中文资料评估 BM25/rerank，避免只依赖 Postgres `simple` 分词。
3. 将 MinerU 后台任务迁移到真正的 job queue/worker，避免在 Next.js route 进程里执行长轮询。
4. 将 citation audit 继续复用到 PPT/播客脚本等 Studio 长文本生成产物的最终结果展示。
