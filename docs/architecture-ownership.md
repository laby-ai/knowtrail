# Architecture Ownership

This map defines the maintenance boundaries for the current single-service KnowTrail deployment. It is a dependency guide, not a mandate to split every large file.

## Dependency direction

```text
UI panels
  -> API route shells
    -> product contracts
    -> account request scope
    -> grounded retrieval
    -> grounded task lifecycle
      -> account billing reservation
    -> AI provider facade
  -> persistent stores
```

Lower layers must not import product routes or React components. Product contracts may parse and audit model output, but must not own HTTP, account sessions, billing reservations, or storage credentials.

## Owners

| Boundary | Owner files | Responsibilities | Must not own |
| --- | --- | --- | --- |
| Account request scope | `src/lib/account-request-scope.ts`, `src/lib/account-entitlement-client.ts` | Trusted session, tenant/member scope, account errors | Client-supplied identity overrides |
| Billing and admission | `src/lib/account-ai-billing.ts`, `src/lib/long-task-admission.ts` | Idempotency, concurrency admission, reserve/settle/release | Product prompts or SSE formatting |
| Evidence retrieval | `src/lib/grounded-retrieval.ts`, source/vector stores | Selected-source filtering, chunks, citations, degraded metadata | Product output schemas |
| Task transport lifecycle | `src/lib/grounded-task-lifecycle.ts` | SSE encoding/headers, timeout, request cancellation, stream closure, reservation finalization | Prompts, citation policy, product-specific parsing |
| Operational observation | `src/lib/operational-observability.ts`, `src/lib/service-metrics.ts` | Safe request/task/provider events and low-cardinality metrics | Raw prompts, source content, member identifiers |
| Product contracts | `src/lib/*-contract.ts` | Prompt boundary, strict parsing, evidence and safety audit, artifact formatting | HTTP/session/provider credentials |
| API route shells | `src/app/api/**/route.ts` | Input validation, owner wiring, product orchestration, stable response errors | Reimplemented SSE, auth, billing, or persistence primitives |
| Persistent source data | `src/lib/ingestion-store.ts`, storage/vector adapters | Member-scoped source metadata, chunks, files, indexes | UI state or provider calls |
| Studio and Library UI | `src/components/studio`, `src/components/library` | User input, progress/empty/error/cancel/retry, evidence navigation | Secrets or trusted identity derivation |
| Classroom integration | virtual-classroom routes/panels and `docs/openmaic-reference-boundary.md` | Sidecar status, proxy and owner-scoped history | OpenMAIC branding or unverified readiness claims |

## Grounded product routes

The following routes share transport and billing-finalization behavior through `grounded-task-lifecycle`, while retaining independent product rules:

- `deep-research`: report sections, citation coverage, conservative repair;
- `hypothesis-generation`: falsifiable hypotheses and competing explanations;
- `experiment-design`: protocol, bias controls and preregistration artifact;
- `academic-writing`: paragraph roles and Claim-Evidence mapping;
- `peer-review`: exact manuscript locations and read-only safety audit.

Do not merge these contracts into a generic prompt builder. A new grounded product should reuse request scope, retrieval, lifecycle and observability, then add its own strict contract.

## Change gates

1. Run the product-specific contract test and `pnpm test:grounded-task-lifecycle`.
2. Run `pnpm check:architecture`; route and lifecycle line budgets prevent responsibility growth.
3. Run `pnpm ts-check`, `pnpm lint:build`, and the full `pnpm validate` before release.
4. Build/package locally. Production must promote an immutable release only after strict candidate health and preserve the previous symlink for rollback.
5. Keep runtime secrets and shared source/vector/job data outside release directories.

## Known next refactors

These are review triggers, not permission for mechanical splitting:

- `LibraryPanel.tsx`: separate source list, evidence detail and import workflows only when characterization coverage exists.
- `ingestion-store.ts`: keep adapter/read-model boundaries explicit before splitting persistence code.
- `ai-service.ts`: split provider families when a provider change would otherwise touch unrelated model paths.
- PPT route and panels: continue using the existing architecture budgets; do not mix PPT work into grounded research changes.
