# KnowTrail

KnowTrail（灵笔）是一个面向资料研究、问答追溯和内容生成的 AI 工作本。它把 PDF、网页、音频、笔记和课堂素材收进同一个可引用资料库，并在三栏工作台里完成资料对话、证据追溯、演示文稿、语音摘要、资料脉络和虚拟课堂生成。

![KnowTrail workspace](docs/screenshots/lingbi-workbench.png)

## Status

| Item | Value |
| --- | --- |
| Live demo | [airai.world/lingbi](http://airai.world/lingbi) |
| Runtime | `knowtrail.service` + `nginx` |
| Current health | Page, `/api/health`, workbench route and virtual-classroom status endpoint return 200 in the latest online probe. |
| Product boundary | Public C-end workspace. End users log in and use notebooks; model credentials stay on the deployment side by default. |

## What It Does

- **Source library**: upload files or paste material, then persist source, chunk, page and ingestion state.
- **Grounded Q&A**: answer against selected sources with citations, retrieval status and traceable evidence.
- **Creation center**: generate presentations, audio summaries, knowledge maps, classroom drafts and research artifacts.
- **Virtual classroom**: keep classroom drafts, runtime parameters and selected source material connected.
- **Operational contracts**: account, model, storage, vector retrieval and long-running job state are exposed through explicit environment variables and smoke checks.

## Architecture

```text
Browser workbench
  -> Next.js app routes and API routes
  -> source store + upload storage
  -> chunking, OCR, MinerU and zvec retrieval
  -> OpenAI-compatible / Ark model gateway
  -> studio jobs, classroom jobs and generated artifacts
```

The default single-node runtime uses local persistent paths for source metadata, uploads, studio jobs and zvec indexes. Multi-instance deployments should move source metadata to Postgres and files to object storage.

## Quick Start

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:5000](http://localhost:5000).

Production build:

```bash
pnpm build
pnpm start
```

The `pnpm dev`, `pnpm build` and `pnpm start` scripts use cross-platform Node wrappers, so Windows/PowerShell and Linux deployments use the same commands.

## Configuration

| Area | Variables |
| --- | --- |
| Public URL | `NEXT_PUBLIC_DOMAIN`, `INTERNAL_APP_ORIGIN` |
| Upload limits | `MAX_UPLOAD_BYTES`, `MAX_UPLOAD_FILES` |
| File storage | `FILE_STORAGE_ADAPTER`, `S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Source metadata | `SOURCE_STORE_ADAPTER`, `SOURCE_STORE_PATH`, `DATABASE_URL` |
| Vector retrieval | `ZVEC_STORE_PATH`, `POSTGRES_READY_CHUNK_SEARCH` |
| Model gateway | `OPENAI_COMPAT_API_BASE`, `OPENAI_COMPAT_API_KEY`, `OPENAI_COMPAT_MODEL`, `OPENAI_COMPAT_VISION_MODEL`, `OPENAI_COMPAT_EMBEDDING_MODEL` |
| Ark aliases | `ARK_API_BASE`, `ARK_API_KEY`, `ARK_MODEL`, `ARK_EMBEDDING_MODEL` |
| MinerU | `MINERU_API_TOKEN`, `MINERU_JOB_TIMEOUT_MS`, `MINERU_JOB_MAX_RETRIES`, `MINERU_JOB_RETRY_DELAY_MS` |
| Podcast/TTS | `AGENTPLAN_TTS_ENDPOINT`, `AGENTPLAN_TTS_RESOURCE_ID`, `AGENTPLAN_TTS_API_KEY`, `AGENTPLAN_TTS_SPEAKER`, `PODCAST_STATUS_URL_TEMPLATE` |

By default, public production does not accept browser-supplied model credentials. Set `ALLOW_USER_RUNTIME_AI_CONFIG=true` only for legacy BYOK testing flows.

## Verification

Use the smallest check that matches the change:

```bash
pnpm run ts-check
pnpm run lint:build
pnpm validate
```

Useful smoke probes:

| Command | Purpose |
| --- | --- |
| `pnpm smoke:dev-health` | start a temporary dev server and probe `/api/health` |
| `pnpm smoke:runtime-health` | probe a production build after `pnpm build` |
| `pnpm smoke:openai-compatible` | validate the model gateway with a local mock |
| `pnpm smoke:workbench-features` | exercise upload, ingestion, chat and studio routes |
| `pnpm smoke:virtual-classroom-workspace` | check the virtual classroom workspace flow |
| `pnpm smoke:real-env-preflight` | verify real-service environment variables without printing secrets |
| `pnpm smoke:real-openai-compatible` | run a low-cost real model gateway probe when secrets are present |
| `pnpm smoke:postgres-source-store` | verify the Postgres source-store schema on a dedicated test database |

Real-service smoke commands must read credentials from the shell, CI secrets or the deployment platform. Do not commit keys, tokens, signed URLs or generated media.

## Deployment

Create a Linux package:

```bash
pnpm build
pnpm package:linux
```

The package is written to `.deploy/lingbi-studio-linux-*.tar.gz` and includes:

- production build output;
- `deploy.sh`, `install.sh`, `preflight.sh`, `start.sh` and `healthcheck.sh`;
- `.env.production.example`;
- systemd and nginx examples under `deploy/linux/`;
- `README-LINUX.md` for host-level rollout notes.

Production checklist:

1. Configure HTTPS, public domain and internal app origin.
2. Put uploads, source metadata, studio jobs and zvec indexes on persistent storage.
3. Use Postgres plus object storage for multi-instance deployments.
4. Keep model credentials in deployment secrets, not the browser or repository.
5. Probe `/api/health`, upload a small file, check ingestion, ask a grounded question and generate one lightweight studio artifact.

## Project Layout

```text
src/app/          Next.js App Router pages and API routes
src/components/   product and shadcn/ui components
src/lib/          retrieval, storage, model and studio utilities
scripts/          build, smoke, test and packaging scripts
docs/             research notes, architecture notes and screenshots
deploy/           Linux service and nginx examples
```

## Development Notes

- Use `pnpm`; `npm` and `yarn` are intentionally blocked.
- Prefer existing `src/components/ui` primitives and local product patterns before adding new UI abstractions.
- Keep source ingestion, grounded retrieval and studio job behavior covered by targeted smoke tests when changing their boundaries.
- Use `docs/architecture-ownership.md` as the owner and dependency map before changing account, retrieval, grounded task, product contract, storage, or classroom boundaries.
- Keep production user flows C-end friendly: no API key prompts in the normal browser experience.

## Related Docs

- [Backend RAG foundation](docs/backend-rag-foundation.md)
- [OpenMAIC reference boundary](docs/openmaic-reference-boundary.md)
- [Reference license risk register](docs/reference-license-risk-register.md)
- [NotebookLM open-source benchmark](docs/notebooklm-open-source-benchmark.md)

## Security

Do not open public issues containing secrets, private model credentials, signed object-storage URLs or user documents. Report sensitive findings privately to the repository owner.
