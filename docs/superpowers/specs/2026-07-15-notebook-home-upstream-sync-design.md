# Notebook Home Upstream Sync Design

## Goal

Integrate upstream `35c6a2b` without replacing the paper-platform adapter. The notebook home must remove decorative controls, use compact four-column featured cards, keep a real search recovery path, and open four distinct featured datasets.

## Boundaries

- Preserve the paper-host iframe bridge, `workspaceKey`/account isolation, `hideVirtualClassroom`, Discover Sources, and existing server APIs.
- Treat the upstream source-contract test as a ratchet, but use browser interactions and visible dataset differences as the acceptance evidence.
- Do not change the temporary high-cost login policy in this slice; it remains a separate server-contract change.

## Acceptance

1. No `全部/我的文献本/精选文献本`, view-mode, fake overflow, or sort controls are visible.
2. Search can produce an empty state and clear back to results.
3. Four featured cards fit one desktop row and each opens a distinct title/source set.
4. New notebook and existing notebook navigation still work within the scoped guest workspace.
5. Adapter, full validation, production build, Linux package, formal-domain browser, console, and overflow checks pass.

## Rollback

Deploy as a timestamped release behind standby validation. Keep the resolved previous release and switch the `current` symlink back if any acceptance check fails.
