# Engineering alignment

## Repository responsibility

KnowTrail owns the Lingbi research workspace, source ingestion, retrieval,
grounded research products, generated artifacts and virtual-classroom adapter.
It consumes account/billing contracts from `laby-ai/account-entitlement` and
must not implement an independent identity or wallet system.

## Four-domain map

| Domain | Repository |
| --- | --- |
| Website | `laby-ai/stoneai-official` |
| Account and billing | `laby-ai/account-entitlement` |
| Lingbi / KnowTrail | `laby-ai/knowtrail` |
| Huiying / SceneWeave | `laby-ai/sceneweave` |

## Gitee reference mapping

- `zhiqi-studio-web`: one typed request boundary, Bearer/cookie rules, timeout,
  streaming cancellation and download errors.
- `zhiqi-admin-vue3`: stable authentication and authorization presentation.
- `zhiqi-ai-python`: health, structured logs, metrics, heavy-task admission and
  worker isolation.
- `zhiqi-admin-backend`: API envelope convergence, RBAC boundaries and durable
  asynchronous task states.

The reference repositories remain read-only and no source is copied. Language
parity is not a goal; contract, failure-mode, observability and rollout parity
are the acceptance criteria.

## Required gates

Use `pnpm@9.0.0`. Run the targeted product contracts, `pnpm run ts-check`,
`pnpm run lint:build`, the architecture guard, the 12-product journey matrix
and the Linux package smoke appropriate to the change. Releases must use stable
external configuration, shared persistent stores, strict standby health and
atomic current/previous promotion from a merged Git commit.
