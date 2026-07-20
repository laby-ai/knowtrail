# Research Skills integration boundary

Reviewed read-only reference: `TashanGKD/tashan-research-skills` at `52d17789688227e4f8990456f92df7cde1feb73c` (2026-07-21). No reference code was copied and the reference repository was not modified.

## Practical course producer

The new `practical-course-producer` skill defines a real four-gate workflow: plan, record, render, and release. Its useful contract is the artifact and evidence boundary: a course plan, real screen recordings, narration/subtitles, an FFmpeg-rendered video, and a final human audit must all exist before release.

KnowTrail may reuse that boundary for a future explainer-video or practical-course pipeline. It must not become a product entry until KnowTrail has real recording ingestion, member-isolated durable files, resumable rendering, preview/download, and human review. Audio, slides, or static images alone are not a completed video. The reference skill's Volcengine/Edge TTS defaults are not adopted because KnowTrail's supported member model path is Bailian BYOK.

## Find science skills

The updated `find-science-skills` uses a deterministic static catalog and a domain-by-stage-by-function funnel. It is suitable as an internal discovery or routing aid. It is not an end-user research result and must not appear as a first-level product card or return an installed/verified capability without a real local integration.

## Adopted quality rules

- A product journey must prove the rendered result after the click, not only an enabled button or HTTP 200.
- Generated files must be opened or structurally inspected; simulated URLs and fixed samples do not count.
- Partial, cancelled, degraded, and human-review-required states remain visible and cannot be promoted as completed output.
- Reference integrations stay read-only and license-tracked; product code enters through the normal branch, test, PR, CI, and release path.

## Current decision

Keep the existing four-category product taxonomy unchanged. Adopt the updated quality gates in the executable product matrix now; defer any new practical-course or skill-discovery product entry until its full runtime and storage chain exists.
