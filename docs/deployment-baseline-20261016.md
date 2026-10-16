# Verified production source baseline

The first commit records the source already deployed as `knowtrail-20261016-library-spacing-v4` before this reliability task. It preserves the existing SMS ownership checks, private PPT storage, request-local observations, isolated embedding space, extraction fixes and selected quiet UI. Those prior changes are not new deliveries in this PR.

The recovery fix is a separate following commit. Production candidates are copied from this verified release and checked against the complete source, config and final build hashes before atomic publication. No environment secrets, user records, uploads, vectors or private generated files are included in Git.

The source repository had diverged from production; this capture makes that divergence explicit instead of silently rebuilding an older tree without its access controls. Runtime evidence and before/after receipts are held in the task workspace under `outputs/knowtrail-reliability-20261016/`.
