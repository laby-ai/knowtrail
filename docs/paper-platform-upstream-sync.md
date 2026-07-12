# Paper Platform KnowTrail Upstream Update Runbook

This is the repeatable update path for the paper platform research-agent embed. Never run git pull in the dirty canonical checkout.

## 1. Fetch and record the boundary

Run:

    git fetch origin --prune
    git rev-parse HEAD
    git rev-parse origin/main
    $status = @(git status --short -uall)
    $statusHash = [Convert]::ToHexString(
      [Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes($status -join "\n")
      )
    ).ToLower()

Record old commit, new upstream commit, dirty entry count, and status hash before work begins.

## 2. Create a detached integration worktree

Run:

    $syncPath = Join-Path (Resolve-Path ..) 'knowtrail-paper-sync-YYYYMMDD'
    git worktree add --detach $syncPath origin/main
    git -C $syncPath status --short --branch

The integration worktree must start clean. The canonical checkout remains unchanged.

## 3. Calculate upstream and adapter overlap

Run:

    git diff --name-only HEAD..origin/main
    pnpm check:paper-platform-adapter

Review each adapter file against upstream. Reapply small adapter hunks to the upstream file; never overwrite a whole upstream file with an old copy.

## 4. Run adapter RED and GREEN

Before restoring an adapter boundary, add or extend its assertion in:

- scripts/paper-platform-adapter-manifest.mjs
- scripts/test-paper-platform-adapter.ts

Run pnpm test:paper-platform-adapter and retain the expected RED. Apply one adapter slice, then run GREEN plus its closest upstream tests.

## 5. Required adapter boundaries

- paper-web postMessage bridge and embed context;
- fail-closed workspaceKey owner mapping;
- browser storage scoped by paper workspace;
- upload, ingestion, chat, and podcast ownership;
- shared resolveAccountNotebookScope research routes;
- hideVirtualClassroom=1 and embed=research-agent visibility;
- paper-web iframe URL and /center/agent/session contract.

## 6. Full engineering gates

Run:

    pnpm test:paper-platform-adapter
    pnpm validate
    pnpm build
    pnpm package:linux
    pnpm smoke:linux-package-products
    git diff --check

Do not run real paid AI smokes as a health gate. Record intentionally skipped live-provider tests as unverified.

## 7. Live preflight

Before upload, inspect:

- KnowTrail service unit and port 5000;
- /api/health;
- resolved current and previous;
- persistent .data and upload mounts;
- environment-file path and required variable names;
- disk space and current release manifest.

Stop on a stale path or release layout that differs from this inventory.

## 8. Package and upload

Create a timestamped release and compute the local hash:

    $releaseName = "lingbi-studio-paper-sync-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Get-FileHash -Algorithm SHA256 .\dist\*.tar.gz

Upload into /opt/knowtrail/releases/$releaseName. Never edit source or the active release in place. Verify the remote archive SHA-256 before extraction.

## 9. Switch current and previous atomically

1. Resolve the old current directory.
2. Atomically point previous to that existing directory.
3. Verify both targets exist.
4. Atomically point current to the new release.
5. Restart only the KnowTrail service.

## 10. Post-release verification

Verify:

- service active and exactly one listener on port 5000;
- /api/health returns HTTP 200 and ok=true;
- standalone KnowTrail renders;
- paper-web #/research-agent renders at desktop and 390px;
- missing paper workspace returns HTTP 401;
- embedded Studio hides virtual classroom but retains all research tools;
- console has no relevant error or warning.

## 11. Rollback

If a required check fails, atomically repoint current to resolved previous, restart KnowTrail, and repeat health plus paper-web smoke. Do not patch the active release.

## 12. Closeout evidence

Record:

- old and new upstream commit;
- original and integration dirty hashes;
- adapter files and overlap decisions;
- RED and GREEN commands;
- full validation, build, and package results;
- package SHA-256;
- browser evidence;
- resolved current and previous;
- deployment or rollback result;
- remaining risks and next single task.
