# Report recovery

The report tool opts into `/api/ai/deep-research` persistence with `persistArtifact`, `runId`, `expectedRevision` and `notebookId`. Existing chat-mode callers do not overwrite the report document. The route resolves the existing verified SMS owner and notebook, checks the revision before model work, and saves before the final SSE acknowledgement. Interrupted text is incomplete; storage failures return an unsaved snapshot for save-only retry.

`GET/PUT /api/studio/artifacts?kind=research-report` share the same verified ownership and private/no-store policy. PUT compares content revisions, preserves prior versions, returns409 on conflicts and503 on storage errors. Files live below `STUDIO_DOCUMENT_STORE_DIR` under owner hash/notebook/tool. Current deployment uses one worker; multiple writers across processes require an external lock before scaling.

The client hook keeps pending content and its expected revision in an identity/notebook scoped browser session. It serializes writes, aborts stale lifecycle requests, does not silently replace conflicts, and never turns a failed authenticated read into a guest fallback. Failed model output can be saved without calling the model again. Guest content stays local. A server-acknowledged complete report takes precedence over an interrupted local snapshot of the same run.

Validation: `pnpm exec tsx scripts/test-research-report-recovery.ts`, learning recovery regression, deep-research contracts, typecheck, final build, compiled HTTP and actual browser recovery tests. Real second-SMS-account and physical cross-device acceptance remain separate.
