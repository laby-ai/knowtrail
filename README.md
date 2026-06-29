# KnowTrail

KnowTrail 是一个 NotebookLM-style 的开源资料工作台，面向资料上传、引用问答、综述报告、知识卡片、资料地图、演示文稿和语音摘要等工作流。中文产品名为“灵笔”，C 端默认使用账号绑定的模型服务和额度结算。

## 发布版本能力

- 普通用户只登录账号和使用工作本，不在浏览器内填写模型 API Key。
- 聊天、综述、知识卡片、上传后的文本分析、图片/PDF OCR 和资料向量检索使用部署方配置的 `OPENAI_COMPAT_*` / `ARK_*` 模型服务，额度按账号侧 memberId 结算。
- 本地生产级向量库使用 `@zvec/zvec`，通过 WAL 持久化资料 chunks 与 embeddings；生产部署必须把 `ZVEC_STORE_PATH` 放在持久磁盘上。
- 上传后的 source/chunk 元数据通过 `SOURCE_STORE_PATH` 持久化，`/api/ingestion/sources` 可查询 ingestion 状态、chunk 数和向量索引状态。
- source store 已有 adapter 边界；默认 adapter 是单机 `local-json`，多实例公网部署可设置 `SOURCE_STORE_ADAPTER=postgres` 和 `DATABASE_URL` 共享 source metadata。Postgres adapter 会保留 `lingbi_source_store` 的 `jsonb` 兼容快照，同时镜像到 `lingbi_sources`、`lingbi_source_chunks`、`lingbi_ingestion_stages` 三张规范化表；读取时优先从规范化表重建 source store，grounded retrieval 的 ready chunk 查询可直接读取 `lingbi_source_chunks` 并按问题文本/topK 裁剪候选，且 schema 会为 chunk 文本建立 Postgres GIN 全文索引契约；可用 `POSTGRES_READY_CHUNK_SEARCH=fts` 灰度启用 `ts_rank` 候选排序。
- PDF 图表提取通过 MinerU 作为后台增强任务接入同一 ingestion 状态链路，可用 `MINERU_JOB_TIMEOUT_MS`、`MINERU_JOB_MAX_RETRIES`、`MINERU_JOB_RETRY_DELAY_MS` 控制超时和重试。
- 公网生产环境默认不采纳请求侧模型凭证；如需兼容旧 BYOK 测试流，必须显式设置 `ALLOW_USER_RUNTIME_AI_CONFIG=true`。
- 适合公网提供普通用户注册登录后的个人工作本服务。

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

按部署平台补齐 `.env.local` 中的账号系统和 OpenAI-compatible / Ark 配置；不要把真实模型密钥写入仓库或发布包。

### 3. 启动开发服务器

```bash
pnpm dev
```

启动后，在浏览器打开 [http://localhost:5000](http://localhost:5000)。

`pnpm dev`、`pnpm build` 和 `pnpm start` 使用跨平台 Node wrapper；Windows/PowerShell 与 Linux 部署环境都不需要依赖 WSL bash。旧的 `scripts/*.sh` 仅保留作兼容参考。

### 构建生产版本

```bash
pnpm build
```

### 本地工程校验

```bash
pnpm validate
pnpm smoke:dev-health
pnpm build
pnpm smoke:runtime-health
pnpm package:linux
pnpm smoke:openai-compatible
pnpm smoke:model-config-ui
pnpm smoke:configured-workbench-flow
pnpm smoke:workbench-studio-ui
pnpm smoke:studio-quality-warning-ui
pnpm smoke:podcast-polling-ui
pnpm smoke:ppt-file-output
pnpm smoke:studio-evidence-ui
pnpm smoke:real-env-preflight
pnpm smoke:real-openai-compatible
pnpm smoke:real-app-ai
pnpm smoke:real-chat-ui
pnpm smoke:real-ppt-ui
pnpm smoke:real-volcengine-podcast
pnpm smoke:real-studio-products
pnpm smoke:postgres-source-store
```

`pnpm validate` 会同时执行类型检查、静态 lint 和用户自带 API Base / API Key 配置边界测试；`pnpm smoke:dev-health` 会自动选择临时端口启动开发服务并探测 `/api/health`；`pnpm smoke:runtime-health` 需要先完成 `pnpm build`，会自动选择临时端口启动生产服务并探测 `/api/health`；`pnpm package:linux` 会把生产构建、启动脚本、env 模板、systemd/nginx 示例打成 `.deploy/lingbi-studio-linux-*.tar.gz`；`pnpm smoke:openai-compatible` 需要本地服务已启动，用本机 mock 网关验证 HTTP API 链路和错误脱敏；`pnpm smoke:model-config-ui` 会真实打开模型设置，填写 API Base/API Key/文本/视觉/向量模型，验证测试按钮禁用态、三类模型连接清单、配置持久化、清空恢复和上游认证失败脱敏；`pnpm smoke:configured-workbench-flow` 会真实打开工作台，预置用户模型配置，验证上传、中央对话和右侧知识卡片请求都携带同一份 API Base/API Key/文本/视觉/向量模型，并确认检索降级原因在对话与知识卡片中可见；`pnpm smoke:workbench-studio-ui` 会真实点击右侧 Studio 的 PPT、学术报告、知识卡片和播客入口，验证无资料态、有资料态、Studio prompt 进入中央对话、右侧生成请求携带同一份用户模型配置和选中资料、长任务等待/取消/恢复文案和请求触发；`pnpm smoke:workbench-features` 会启动临时服务并验证上传、ingestion 查询、chat/report/knowledge/podcast/PPT/PPT-v2 debug retrieval 都返回 citations、`retrieval.degraded` 和用户可读 `retrieval.reason`；`pnpm smoke:studio-quality-warning-ui` 会模拟学术 PPT 生成成功但 LLM 质量审查/演讲稿环节降级，验证前端在成功态保留质量警告且仍提供下载；`pnpm smoke:podcast-polling-ui` 会模拟播客异步任务从提交到完成/失败的轮询路径，验证右侧播客不会静默卡住，并能展示音频完成态、grounded evidence、降级原因或失败重试入口；`pnpm smoke:ppt-file-output` 会真实点击普通 PPT 生成与导出，断言右侧 PPT 产物展示证据状态和引用来源，并用 JSZip 解包校验下载 PPTX，同时校验学术 PPT-v2 后端构建出的 PPTX 包含 slide XML 和预期文本；`pnpm smoke:studio-evidence-ui` 会真实点击中心综述报告和右侧知识卡片，验证 citation audit、retrieval mode、引用来源和页码都对用户可见；`pnpm smoke:real-env-preflight` 只检查真实服务环境变量是否齐全并脱敏显示 key 状态；`pnpm smoke:real-openai-compatible` 直接读取环境变量中的真实兼容服务配置，低 token 上限验证文本模型，并在配置了向量模型时生成 embedding、写入 zvec、查询回 citation metadata；`pnpm smoke:real-app-ai` 会启动临时生产服务，验证 `/api/ai/test-config` 文本/视觉/向量模型，然后真实上传资料、完成 ingestion/embedding/zvec 写入，并断言中央对话 SSE 使用 `persisted-vector`、返回 citations 和 citation audit；`pnpm smoke:real-chat-ui` 会打开真实浏览器工作台，注入用户模型配置，上传真实资料，发送中央对话，并检查 UI 显示“向量索引检索”、引用数量、citation audit 和引用来源；`pnpm smoke:real-ppt-ui` 会打开真实浏览器工作台，上传并选择资料，点击右侧「学术报告」PPT 入口，验证长任务阶段提示、取消入口、真实模型质量摘要、下载 PPTX，并解包审计 slide 数、占位符和薄页；`pnpm smoke:real-volcengine-podcast` 会调用火山/豆包播客 WebSocket v3 协议，验证 `volc.service_type.10050` 播客大模型真实生成音频 URL 或本地音频文件；`pnpm smoke:real-studio-products` 会上传真实 smoke 资料，逐项生成知识卡片、报告、播客 grounded context、VolcEngine 播客音频和 PPT-v2，并在每个阶段开始和结束时输出 `real-studio-progress` JSON 行，最终输出每项 PASS/FAIL/SKIP、耗时、引用数量、检索模式和失败原因，同时把 summary JSON、真实 PPTX 和截图写入 `.deploy/evidence` 便于人工复核。`pnpm smoke:postgres-source-store` 默认在未设置 `POSTGRES_SMOKE_DATABASE_URL` 时安全跳过；设置专用测试库后，会在事务内临时 schema 中验证 Postgres source/chunk/stage 表与 chunk 全文索引契约并回滚。

### 启动生产服务器

```bash
pnpm start
```

### Linux 一键部署包

先在构建机生成生产包：

```bash
pnpm build
pnpm package:linux
```

生成物位于 `.deploy/lingbi-studio-linux-*.tar.gz`。上传到 Linux 服务器后：

```bash
tar -xzf lingbi-studio-linux-*.tar.gz
cd lingbi-studio
./deploy.sh
```

`./deploy.sh` 会在 Ubuntu/Debian 上补齐 Node.js 20+ 与 pnpm，执行安装、`./preflight.sh`、后台启动并调用 `./healthcheck.sh`。需要手动控制运行方式时，也可以拆成：

```bash
./install.sh
./preflight.sh
nano .env.production
./start.sh
./healthcheck.sh
```

包内包含：

- 生产构建产物：`.next`、`dist/server.js`、`public`。
- 运行脚本：`bootstrap-ubuntu.sh`、`deploy.sh`、`preflight.sh`、`install.sh`、`start.sh`、`healthcheck.sh`。
- 配置模板：`.env.production.example`。
- 运维示例：`deploy/linux/lingbi-studio.service`、`deploy/linux/nginx.conf.example`。
- 说明文档：`README-LINUX.md`。

## 公网部署检查

1. 设置 `NEXT_PUBLIC_DOMAIN` 为公网域名，例如 `lingbi.example.com`。
2. 设置 `MAX_UPLOAD_BYTES` 和 `MAX_UPLOAD_FILES`，避免公网试用被大文件或批量上传拖垮。默认单文件 25MB，单次 5 个文件。
3. 如果部署平台不能通过 `localhost:$PORT` 调用自身接口，设置 `INTERNAL_APP_ORIGIN` 为应用可访问的内部或公网 origin，例如 `https://lingbi.example.com`。上传后的 OCR、PDF 分析和资料摘要会用它调用本应用 API。
4. 默认 `FILE_STORAGE_ADAPTER=local`，上传文件写入本机 `public/uploads`；单机部署必须把工作目录放在持久磁盘上。多实例或无状态部署设置 `FILE_STORAGE_ADAPTER=s3`，并配置 `S3_ENDPOINT_URL`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`，或对应 `OBJECT_STORAGE_*` 变量。
5. 设置 `ZVEC_STORE_PATH` 到持久磁盘路径，例如 `/data/lingbi/zvec`。默认 `.data/zvec` 适合单机开发，不适合无状态平台。
6. 单机部署可设置 `SOURCE_STORE_ADAPTER=local-json`、`SOURCE_STORE_PATH` 和 `STUDIO_JOB_STORE_PATH` 到同一块持久磁盘，例如 `/data/lingbi/sources/sources.json` 与 `/data/lingbi/studio-jobs/jobs.json`，否则上传后的 chunk 元数据和 Studio 长任务状态会随实例重建丢失。
7. 多实例部署可设置 `SOURCE_STORE_ADAPTER=postgres` 和 `DATABASE_URL`。当前 Postgres adapter 会自动创建 `lingbi_source_store` 兼容快照表，并同步维护 `lingbi_sources`、`lingbi_source_chunks`、`lingbi_ingestion_stages` 规范化表；后续线上排障应优先查规范化表，旧 payload 仅作为迁移和回滚保险。默认 ready chunk 查询使用 `POSTGRES_READY_CHUNK_SEARCH=ilike`；英文、模型名、文件名等 token-heavy 场景可灰度设置为 `fts`，使用 `ts_rank` 对候选排序。
8. 如果启用 MinerU，设置 `MINERU_API_TOKEN`，并按部署平台请求时长设置 `MINERU_JOB_TIMEOUT_MS`、`MINERU_JOB_MAX_RETRIES` 和 `MINERU_JOB_RETRY_DELAY_MS`。默认 180 秒超时、1 次重试、3 秒重试间隔。
9. 如果需要真实播客音频，默认配置豆包 AgentPlan TTS：`AGENTPLAN_TTS_ENDPOINT=https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`、`AGENTPLAN_TTS_RESOURCE_ID=seed-tts-2.0`、私有 `AGENTPLAN_TTS_API_KEY`、`AGENTPLAN_TTS_SPEAKER`。实验性的火山/豆包播客 WebSocket v3 仅在显式设置 `PODCAST_AUDIO_PROVIDER=volcengine-podcast` 时使用。
10. 如果播客上游返回异步任务而不是立即返回音频地址，设置 `PODCAST_STATUS_URL_TEMPLATE`，用 `{taskId}` 作为任务 ID 占位符。未配置时前端仍会提示任务已提交并轮询到超时提示，但无法自动拿到最终音频。
11. 确认公网 HTTPS 已开启。账号登录态、资料上传和模型调用都应走受保护的公网入口。
12. 配置账号绑定的模型服务，例如 OpenAI-compatible 或第三方兼容网关；普通用户不在浏览器内填写 API Key。
   - 火山方舟 Ark OpenAI-compatible 示例：`OPENAI_COMPAT_API_BASE=https://ark.cn-beijing.volces.com/api/v3`，文本模型填写控制台 `/models` 可访问的版本化模型 ID，例如 `doubao-seed-1-6-251015`。
   - `OPENAI_COMPAT_VISION_MODEL` 用于图片/PDF OCR 多模态理解，应填写明确支持 `image_url` 的视觉模型 ID。
   - `OPENAI_COMPAT_EMBEDDING_MODEL` 用于资料 chunks 的 embedding 和 zvec 检索；未配置时系统会明确降级到持久片段/关键词检索。
13. 如果部署方要验证真实服务而不是 mock，设置 `OPENAI_COMPAT_API_BASE`、`OPENAI_COMPAT_API_KEY`、`OPENAI_COMPAT_MODEL` 和可选 `OPENAI_COMPAT_EMBEDDING_MODEL` 后运行 `pnpm smoke:real-openai-compatible`。Ark 也可使用 `ARK_API_BASE`、`ARK_API_KEY`、`ARK_MODEL`、`ARK_EMBEDDING_MODEL` 别名。脚本不会输出 Key；未配置 Base/Key 时会安全跳过。
14. 访问 `/api/health` 确认服务可达，并检查上传限制、内部自调用 origin、对象存储、MinerU job、source store、`sourceStore.readyChunkSearch.mode`、zvec vector store、服务端兜底模型等能力是否已配置。
15. 使用一份小 PDF/TXT 资料完成上传、`/api/ingestion/sources` 状态查询、问答、生成综述和播客音频五项冒烟测试。

### Postgres source store 表契约

`SOURCE_STORE_ADAPTER=postgres` 时，应用会在启动后的首次 source store 读写中自动建表：

- `lingbi_source_store`：整份 source store 的 `jsonb` 快照，用于兼容旧读路径和回滚。
- `lingbi_sources`：source 基本信息、ingestion 总状态、向量索引状态、MinerU 摘要状态。
- `lingbi_source_chunks`：每个 source 的 chunk 文本、页码、token 估算和 chunk payload；自动创建 `lingbi_source_chunks_fts_idx`，对 `source_title/paper_short_name/text` 建立 `to_tsvector('simple', ...)` 的 GIN 表达式索引。
- `lingbi_ingestion_stages`：`store/extract/mineru/normalize/chunk/embed/index` 的阶段状态、时间和错误。

当前写入会在同一事务中更新兼容快照并镜像规范化表；读取时优先从规范化表重建 source/chunk/stage 结构，只有规范化表没有数据时才回退旧 `jsonb` 快照。问答检索使用 ready chunk 查询契约，Postgres 模式会直接查 `lingbi_sources` 和 `lingbi_source_chunks`，并用参数化 `ILIKE` 条件按问题文本和候选上限裁剪，降低整包重建和全量 chunk 扫描成本。设置 `POSTGRES_READY_CHUNK_SEARCH=fts` 后，ready chunk 查询会使用同一 GIN 全文索引、`plainto_tsquery('simple', ...)` 和 `ts_rank` 对候选排序；当前模式会在 `/api/health` 的 `capabilities.sourceStore.readyChunkSearch.mode` 中暴露。中文语义相关性仍主要依赖 zvec embedding 或后续 rerank，不把 `simple` 分词当作中文语义检索。

发布前如果启用 Postgres，建议准备一个一次性测试库或独立 schema 权限账号运行：

```bash
POSTGRES_SMOKE_DATABASE_URL=postgres://user:pass@host:5432/lingbi_smoke pnpm smoke:postgres-source-store
```

该脚本不会隐式读取 `DATABASE_URL`，防止把生产库当作 smoke 目标。脚本会开启事务、创建临时 schema、执行建表 SQL、确认 `lingbi_source_chunks_fts_idx` 已创建、插入一条 source/chunk/stage 样例、执行一次全文查询、从规范化表重建 source store、检查行数，然后 rollback。

### 模型网关策略

- C 端默认不采纳请求体里的模型凭证，模型服务由部署环境或 approved gateway 托管。
- 如果需要兼容旧 BYOK 测试流，显式设置 `ALLOW_USER_RUNTIME_AI_CONFIG=true`，并继续保留 HTTP/private base guardrails。
- 上游模型服务返回错误时，服务端会脱敏 `Bearer ...`、`apiKey` 和 `authorization` 字段，避免把密钥回显到前端或日志里。

### OpenAI-compatible 后端烟测

启动本地服务后，可以用内置 mock 网关验证账号绑定模型服务链路是否可用：

```bash
# 如果用 pnpm next start / 生产模式跑本地 smoke，需要允许本机 HTTP mock：
ALLOW_INSECURE_API_BASE=true ALLOW_PRIVATE_API_BASE=true pnpm next start -p 5000
APP_ORIGIN=http://localhost:5000 pnpm smoke:openai-compatible
```

该脚本会临时启动一个本机 OpenAI-compatible mock 服务，并依次检查：

- `/api/health` 能否返回不含密钥的发布健康状态，并包含 source store、ready chunk search mode、zvec、MinerU、对象存储和上传限制。
- `/api/upload` 能否拒绝超过 `MAX_UPLOAD_BYTES` 的文件，避免超限文件进入 OCR/LLM 分析链路。
- `pnpm test:ingestion` 能否把解析后的 source 写入本地 source store、生成 chunks、可选写入 zvec 并查回 citation metadata。
- `/api/ai/test-config` 能否使用服务端模型配置完成连接测试。
- `/api/ai/test-config` 在填写视觉理解模型时，会同时发送一张 16x16 测试图片验证 `image_url` 多模态链路。
- `/api/ai/test-config` 在填写向量模型时，会调用 `/embeddings` 并验证返回向量维度。
- `/api/ai/test-config` 能否拒绝不支持的模型网关地址，并在上游认证失败时不回显密钥。
- `/api/ai/chat` 能否通过同一配置完成流式 SSE 回答，向模型传入低 `max_tokens` smoke guard，把检索后的 `sourceId/chunkId` grounded context 传给模型，并在 SSE 中返回 `citations`、含 `degraded/reason` 的 `retrieval` 和最终 `citationAudit=pass`。
- `pnpm smoke:configured-workbench-flow` 能否从浏览器用户路径确认本地保存的模型配置随 `/api/upload`、`/api/ai/chat` 和 `/api/ai/knowledge-cards` 进入后端，避免设置弹窗和实际工作台割裂。
- `pnpm smoke:workbench-studio-ui` 能否从浏览器用户路径确认右侧 PPT、学术报告、知识卡片和播客的无资料禁用、有资料启用、Studio prompt 进入中央对话、请求体携带同一份用户模型配置与选中资料、长任务等待、取消与恢复体验。
- `pnpm smoke:studio-quality-warning-ui` 能否从浏览器用户路径确认 `/api/ai/ppt-v2` 返回 `X-LLM-Observability` 降级阶段后，成功态仍提示“部分环节降级处理”并保留下载入口。
- `pnpm smoke:podcast-polling-ui` 能否从浏览器用户路径确认 `/api/ai/podcast` 异步任务提交、状态轮询、音频完成态、grounded evidence、降级原因、上游失败提示和重试入口。
- `pnpm smoke:ppt-file-output` 能否从浏览器用户路径确认普通 PPT 右侧产物展示证据状态和引用来源、下载为可解包 PPTX，并确认学术 PPT-v2 后端构建器输出可打开的 PPTX 结构。
- `pnpm smoke:studio-evidence-ui` 能否从浏览器用户路径确认中心综述报告展示引用编号审计、检索模式和可展开来源，右侧知识卡片展示同一套 grounded evidence 状态。

成功时会输出 `ok: true` 和已检查的 API 列表；失败时直接返回具体断点，适合发布前或部署后做后端可用性验证。

### 真实模型服务烟测

当环境里已经放入真实测试 Token 时，可以运行最小成本真实链路 smoke：

```powershell
$env:OPENAI_COMPAT_API_BASE='https://ark.cn-beijing.volces.com/api/v3'
$env:OPENAI_COMPAT_MODEL='doubao-seed-1-6-251015'
$env:OPENAI_COMPAT_EMBEDDING_MODEL=''
# OPENAI_COMPAT_API_KEY 应从部署平台 secret 或当前 shell 环境注入，不写入仓库文件。
pnpm smoke:real-openai-compatible
pnpm smoke:real-app-ai
pnpm smoke:real-studio-products
```

实际 Key 应通过环境变量或部署平台密钥注入，不要写进命令历史、README 或仓库文件。也可以复制 `.env.real.local.example` 为 `.env.real.local`，只在本机或服务器私有目录填写真实值；`.env.real.local` 已被 `.gitignore` 忽略，真实 smoke 会优先读取它。上传前可先运行 `pnpm smoke:real-env-preflight`，它只输出 Base/模型/TTS speaker 是否配置和 key 的 `[REDACTED]` 状态，不打印 key 本身。脚本会检查：

- OpenAI-compatible / Ark versioned base path 能否解析到 chat completions。
- 文本模型能否在低 token 上限下返回非空内容。
- 如果配置了向量模型，`/embeddings` 能否返回有效维度。
- 使用真实 embedding 写入 `@zvec/zvec`，再查回同一个 `chunkId`，证明后续 grounded chat 可以复用真实向量索引。
- 生产服务中的 `/api/ai/test-config` 能否覆盖文本、视觉和向量模型。
- 生产服务中的 `/api/ai/chat` 能否在真实上传、ingestion、embedding 和 zvec 写入后返回 `persisted-vector` grounded SSE、citations、retrieval metadata 和 citation audit。
- 右侧 Studio 的知识卡片、报告、播客 grounded context、AgentPlan/Doubao TTS 播客音频和 PPT-v2 是否能在真实模型下逐项产出结果；播客音频或 PPT-v2 失败、超时会作为 `FAIL` 报告，不会被当作通过。

未配置 `OPENAI_COMPAT_API_BASE`/`OPENAI_COMPAT_API_KEY` 或 `ARK_API_BASE`/`ARK_API_KEY` 时，脚本返回 `skipped: true`，用于 CI 或自动化中安全区分“未接真实服务”和“真实服务失败”。

完整 `pnpm smoke:real-studio-products` 会串行跑上传、知识卡片、报告、播客音频和 PPT-v2，真实模型下可能需要 7-10 分钟；自动化轮次若需要更快定位，可先运行 `REAL_STUDIO_INCLUDE_PPT=false pnpm smoke:real-studio-products` 验证非 PPT Studio 产品，再运行 `pnpm generate:real-ppt-v2 && pnpm audit:pptx-quality` 单独验证 PPTX 文件、slide 数量和 `fallbacks=0`。

公网环境不要开启会打印用户资料正文的调试日志。当前聊天接口只返回 SSE 给前端，不会把 `rawContent`、`paperContext` 或用户填写的 API Key 写入服务端日志。

## 项目结构

```
src/
├── app/                      # Next.js App Router 目录
│   ├── layout.tsx           # 根布局组件
│   ├── page.tsx             # 首页
│   ├── globals.css          # 全局样式（包含 shadcn 主题变量）
│   └── [route]/             # 其他路由页面
├── components/              # React 组件目录
│   └── ui/                  # shadcn/ui 基础组件（优先使用）
│       ├── button.tsx
│       ├── card.tsx
│       └── ...
├── lib/                     # 工具函数库
│   └── utils.ts            # cn() 等工具函数
└── hooks/                   # 自定义 React Hooks（可选）

server/
├── index.ts                 # 自定义服务器入口
├── tsconfig.json           # Server TypeScript 配置
└── dist/                    # 编译输出目录（自动生成）
```

## 核心开发规范

### 1. 组件开发

**优先使用 shadcn/ui 基础组件**

本项目已预装完整的 shadcn/ui 组件库，位于 `src/components/ui/` 目录。开发时应优先使用这些组件作为基础：

```tsx
// ✅ 推荐：使用 shadcn 基础组件
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function MyComponent() {
  return (
    <Card>
      <CardHeader>标题</CardHeader>
      <CardContent>
        <Input placeholder="输入内容" />
        <Button>提交</Button>
      </CardContent>
    </Card>
  );
}
```

**可用的 shadcn 组件清单**

- 表单：`button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `slider`
- 布局：`card`, `separator`, `tabs`, `accordion`, `collapsible`, `scroll-area`
- 反馈：`alert`, `alert-dialog`, `dialog`, `toast`, `sonner`, `progress`
- 导航：`dropdown-menu`, `menubar`, `navigation-menu`, `context-menu`
- 数据展示：`table`, `avatar`, `badge`, `hover-card`, `tooltip`, `popover`
- 其他：`calendar`, `command`, `carousel`, `resizable`, `sidebar`

详见 `src/components/ui/` 目录下的具体组件实现。

### 2. 路由开发

Next.js 使用文件系统路由，在 `src/app/` 目录下创建文件夹即可添加路由：

```bash
# 创建新路由 /about
src/app/about/page.tsx

# 创建动态路由 /posts/[id]
src/app/posts/[id]/page.tsx

# 创建路由组（不影响 URL）
src/app/(marketing)/about/page.tsx

# 创建 API 路由
src/app/api/users/route.ts
```

**页面组件示例**

```tsx
// src/app/about/page.tsx
import { Button } from '@/components/ui/button';

export const metadata = {
  title: '关于我们',
  description: '关于页面描述',
};

export default function AboutPage() {
  return (
    <div>
      <h1>关于我们</h1>
      <Button>了解更多</Button>
    </div>
  );
}
```

**动态路由示例**

```tsx
// src/app/posts/[id]/page.tsx
export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <div>文章 ID: {id}</div>;
}
```

**API 路由示例**

```tsx
// src/app/api/users/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ users: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ success: true });
}
```

### 3. 依赖管理

**必须使用 pnpm 管理依赖**

```bash
# ✅ 安装依赖
pnpm install

# ✅ 添加新依赖
pnpm add package-name

# ✅ 添加开发依赖
pnpm add -D package-name

# ❌ 禁止使用 npm 或 yarn
# npm install  # 错误！
# yarn add     # 错误！
```

项目已配置 `preinstall` 脚本，使用其他包管理器会报错。

### 4. 样式开发

**使用 Tailwind CSS v4**

本项目使用 Tailwind CSS v4 进行样式开发，并已配置 shadcn 主题变量。

```tsx
// 使用 Tailwind 类名
<div className="flex items-center gap-4 p-4 rounded-lg bg-background">
  <Button className="bg-primary text-primary-foreground">
    主要按钮
  </Button>
</div>

// 使用 cn() 工具函数合并类名
import { cn } from '@/lib/utils';

<div className={cn(
  "base-class",
  condition && "conditional-class",
  className
)}>
  内容
</div>
```

**主题变量**

主题变量定义在 `src/app/globals.css` 中，支持亮色/暗色模式：

- `--background`, `--foreground`
- `--primary`, `--primary-foreground`
- `--secondary`, `--secondary-foreground`
- `--muted`, `--muted-foreground`
- `--accent`, `--accent-foreground`
- `--destructive`, `--destructive-foreground`
- `--border`, `--input`, `--ring`

### 5. 表单开发

推荐使用 `react-hook-form` + `zod` 进行表单开发：

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const formSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符'),
  email: z.string().email('请输入有效的邮箱'),
});

export default function MyForm() {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', email: '' },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    console.log(data);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Input {...form.register('username')} />
      <Input {...form.register('email')} />
      <Button type="submit">提交</Button>
    </form>
  );
}
```

### 6. 数据获取

**服务端组件（推荐）**

```tsx
// src/app/posts/page.tsx
async function getPosts() {
  const res = await fetch('https://api.example.com/posts', {
    cache: 'no-store', // 或 'force-cache'
  });
  return res.json();
}

export default async function PostsPage() {
  const posts = await getPosts();

  return (
    <div>
      {posts.map(post => (
        <div key={post.id}>{post.title}</div>
      ))}
    </div>
  );
}
```

**客户端组件**

```tsx
'use client';

import { useEffect, useState } from 'react';

export default function ClientComponent() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(setData);
  }, []);

  return <div>{JSON.stringify(data)}</div>;
}
```

## 常见开发场景

### 添加新页面

1. 在 `src/app/` 下创建文件夹和 `page.tsx`
2. 使用 shadcn 组件构建 UI
3. 根据需要添加 `layout.tsx` 和 `loading.tsx`

### 创建业务组件

1. 在 `src/components/` 下创建组件文件（非 UI 组件）
2. 优先组合使用 `src/components/ui/` 中的基础组件
3. 使用 TypeScript 定义 Props 类型

### 添加全局状态

推荐使用 React Context 或 Zustand：

```tsx
// src/lib/store.ts
import { create } from 'zustand';

interface Store {
  count: number;
  increment: () => void;
}

export const useStore = create<Store>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));
```

### 集成数据库

推荐使用 Prisma 或 Drizzle ORM，在 `src/lib/db.ts` 中配置。

## 技术栈

- **框架**: Next.js 16.1.1 (App Router)
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **样式**: Tailwind CSS v4
- **表单**: React Hook Form + Zod
- **图标**: Lucide React
- **字体**: Geist Sans & Geist Mono
- **包管理器**: pnpm 9+
- **TypeScript**: 5.x

## 参考文档

- [Next.js 官方文档](https://nextjs.org/docs)
- [shadcn/ui 组件文档](https://ui.shadcn.com)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [React Hook Form](https://react-hook-form.com)

## 重要提示

1. **必须使用 pnpm** 作为包管理器
2. **优先使用 shadcn/ui 组件** 而不是从零开发基础组件
3. **遵循 Next.js App Router 规范**，正确区分服务端/客户端组件
4. **使用 TypeScript** 进行类型安全开发
5. **使用 `@/` 路径别名** 导入模块（已配置）
