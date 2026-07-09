# KnowTrail API conventions

This document records the current API contract for KnowTrail's Next.js App Router routes. It is intentionally source-backed and conservative: it describes what the service does today, then states the convergence targets that should guide future work.

The Gitee reference projects use a more uniform front/back contract, including a shared request layer, explicit auth handling, predictable error states, and a `{ code, msg, data }` response shape. KnowTrail is not fully there yet. New API work should move in that direction without breaking existing clients.

## Route families

| Area | Routes | Current contract |
| --- | --- | --- |
| Runtime health | `/api/health` | Public health probe for deployment and monitoring. Must stay lightweight and cache-safe. |
| Account and session | `/api/account/*` | Account status, session, authentication, and password reset endpoints. These routes use no-store semantics and may require Bearer account tokens. |
| Source ingestion | `/api/upload`, `/api/ingestion/sources`, `/api/mineru/extract` | Uploads, source records, extraction jobs, and document chunking state. Responses should expose source/job identifiers and clear ingestion status. |
| Research AI | `/api/ai/chat`, `/api/ai/analyze*`, `/api/ai/knowledge-*`, `/api/ai/report` | Research Q&A, summaries, analysis, evidence views, and generated reports. Streaming routes use Server-Sent Events. |
| Studio generation | `/api/ai/podcast`, `/api/ai/ppt*`, `/api/ai/studio-tool`, `/api/ai/tts` | Long-running or provider-backed generation. Some endpoints return accepted jobs and require polling. |
| Discovery | `/api/discover/*` | Server-side source discovery and search. Provider keys stay server-side and must never be returned to the browser. |
| Virtual classroom | `/api/virtual-classroom/*` | External classroom workflow helpers, status polling, confirmation, and outline generation. |
| File helpers | `/api/file` | File access/redirect helper. Must not leak arbitrary local paths or unsigned private object storage URLs. |

## Authentication and account context

- Protected routes should read account identity from `Authorization: Bearer <token>` when account auth is enabled.
- `ACCOUNT_CENTER_REQUIRE_AUTH=true` means account-protected APIs must return an HTTP `401` when no valid account session is present.
- Tokens and provider credentials must not be accepted in query strings, logged, committed, or returned to the client.
- User-owned data routes should use no-store response semantics so account state, notebook data, and generated artifacts are not cached across users.
- Billing-aware routes must keep reservation, settlement, and release behavior explicit. A billing or entitlement failure must not be disguised as a successful generation.

## Response shapes

KnowTrail currently has mixed JSON response shapes:

- Some routes return `{ success: true, ... }`.
- Some routes return `{ ok: true, ... }`.
- Some routes return domain objects, job objects, or status objects directly.
- Many errors return `{ error: "..." }` with an HTTP status code.
- Streaming routes return Server-Sent Events rather than a single JSON body.

For new non-streaming JSON endpoints, prefer this target shape:

```json
{
  "code": 0,
  "msg": "ok",
  "data": {}
}
```

For existing endpoints, keep backwards compatibility unless a migration is explicitly planned. If an existing route must keep `success`, `ok`, or direct domain objects, document that in the route-specific code or tests.

## Status codes

Use HTTP status codes consistently:

| Status | Meaning |
| --- | --- |
| `200` | Request succeeded synchronously. |
| `202` | Long-running job was accepted; the client should poll a status endpoint. |
| `400` | Invalid input, missing required field, or malformed payload. |
| `401` | Missing or invalid account session. |
| `403` | Authenticated but not permitted, or upstream permission denied. |
| `404` | Source, job, route target, or artifact was not found. |
| `413` | Upload or request body is too large. |
| `415` | Unsupported file type or content type. |
| `422` | The request was syntactically valid but extraction or structured parsing failed. |
| `429` | Provider or service rate limit. |
| `500` | Internal error. |
| `502` | Upstream provider failed or returned an invalid response. |
| `503` | Required provider, storage, database, or account service is not configured. |
| `504` | Upstream provider or long-running operation timed out. |

Error bodies should include a short user-safe message. They may include a stable machine-readable code, but must not include raw provider payloads, stack traces, tokens, keys, or signed private URLs.

## Streaming routes

Routes such as research chat, reports, and PPT generation can stream with Server-Sent Events:

- Use `Content-Type: text/event-stream`.
- Emit JSON payloads as `data: ...` lines.
- Use a clear terminal event or `[DONE]` marker when the stream completes.
- Streamed error events should be user-safe and should not leak provider credentials or internal stack traces.
- If a stream is tied to a notebook, source, or account context, enforce that context before the first event is sent.

## Long-running jobs

Generation and extraction routes may return `202 Accepted` with a job or task identifier. The polling contract should be explicit:

- `POST` starts the job and returns `jobId`, `taskId`, or the provider job object plus the polling route.
- `GET` or a dedicated status route returns `queued`, `running`, `succeeded`, `completed`, `failed`, or an equivalent stable status.
- Job status responses should include enough metadata for the UI to show a useful loading, failed, or completed state.
- Failed jobs should preserve a user-safe error message and avoid pretending that fallback output is real.
- Job ownership must be scoped by notebook, member, account, or another checked boundary.

## Source and evidence semantics

KnowTrail's research positioning depends on source-backed answers. For source and evidence APIs:

- Upload and extraction responses should expose source identifiers, extraction status, and chunk/vector readiness where available.
- Answer and summary APIs should surface retrieval evidence, source snippets, citation audit information, or citation leads when the feature is actually implemented for that route.
- UI copy and API responses must not claim DOI, arXiv, PubMed, cross-library search, citation network analysis, statistical scripts, or LaTeX/Word export as live features unless the route implements them.
- Planned capabilities can be documented as roadmap items, not as current API behavior.

## Runtime AI configuration

Production traffic should use server-side or account-bound provider configuration:

- Server environment variables such as OpenAI-compatible, Ark, or account-provided model config should be resolved on the server.
- Browser-supplied runtime AI config is a legacy/development path and should only be accepted behind an explicit allow flag.
- Production model base URLs should reject insecure, localhost, or private-network targets unless an explicit operator override is set.
- Provider keys must be redacted in logs, validation output, exceptions, and responses.

## Security checklist for API changes

Before adding or changing an API route:

- Confirm whether the route is public, account-protected, notebook-scoped, or service-internal.
- Decide whether the response is regular JSON, SSE, a redirect, or a file response.
- Use no-store semantics for account state, user data, generated artifacts, and billing state.
- Do not add request fields that carry provider keys from the browser unless the route is explicitly documented as a local/development-only path.
- Do not add fallback success payloads that hide provider, billing, extraction, or storage failure.
- Keep logs useful but redact credentials, signed URLs, and raw provider secrets.

## Developer checklist

For each API contract change:

1. Update this document when route families, auth boundaries, response shapes, streaming semantics, or job polling behavior change.
2. Add or update focused tests/smokes for the changed route.
3. Run `pnpm run ts-check`.
4. Run `pnpm run lint:build`.
5. Run `git diff --check`.
6. Scan the diff for secrets before committing.

