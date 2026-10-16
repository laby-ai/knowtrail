# Learning materials and progress

Set `STUDIO_DOCUMENT_STORE_DIR` to a private, persistent directory outside release checkouts. The current production configuration uses `/opt/knowtrail/shared/studio-documents`; local development may use `.data/studio-documents`. Do not expose this directory through static hosting or replace existing production environment credentials from the example template.

`/api/ai/knowledge-cards` resolves the account through the existing verified SMS session before deriving the owner and notebook. GET restores the current document. POST saves generated cards and evidence before returning success. PUT saves reading position and quiz answers with `expectedRevision`. All responses are private/no-store. The browser imports only its already account-scoped legacy learning session when that same verified account/notebook has no server document; guest data is not imported.

Each owner is hashed into its own directory. A learning document retains content versions and publishes `current.json` atomically. Repeating the same content is idempotent; stale revisions return 409, storage failures return 503, and corrupt current documents are not silently replaced. Back up the whole directory, including version files. Rollbacks must keep it intact.

The write queue assumes the current single PM2 worker. Add a cross-process lock or transactional store before increasing the number of writing workers. This contract does not claim to persist the other Studio tools; those are accepted separately.

Run `pnpm exec tsx scripts/test-learning-materials-recovery.ts` for the isolated, zero-paid-call POST/storage/reopen/ownership/conflict checks. Full acceptance also needs the actual browser generation, save, refresh and reopen path. Fixture account B does not replace a second real SMS account.
