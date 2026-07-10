# Explainer video readiness

## Product boundary

`讲解视频` means a reviewable research communication artifact, not a single generated clip. A complete product must preserve this chain:

1. selected sources and presentation content;
2. grounded narration script;
3. timed voice and subtitles;
4. generated or approved visuals;
5. audio/video composition;
6. member-isolated MP4 persistence, preview, and download;
7. factual, terminology, subtitle, audio, and file validation.

An audio file, PPT, static image sequence, upstream task id, or remote clip URL alone does not satisfy this contract.

## Current verified capabilities

- KnowTrail already has grounded source selection, PPT generation, real TTS/podcast jobs, account billing, and member-scoped artifact patterns.
- The stable production configuration contains an Ark Seedance 1.5 model configuration. Health reports only configuration booleans and model family; it never returns credentials or the exact model id.
- `src/lib/explainer-video-provider.ts` now provides a backend-only Ark task contract: submit, poll, success URL extraction, explicit provider failure, timeout, and cancellation.
- Provider tests use a local deterministic upstream. They do not spend quota and do not claim a live generated file.

The implementation follows the Tashan visual-deck routing boundary and the local `sci-employee-ppt-making` delivery contract: script, voice, subtitles, timeline, composed MP4, and quality check are separate required artifacts.

## Blocking evidence

- Production has no configured video composition runtime such as FFmpeg.
- KnowTrail has no explainer-video job type, member-scoped MP4 store, composition route, preview/download route, or end-to-end smoke.
- A paid live Seedance sample has not been run in this slice. It requires explicit cost authorization and must validate real MP4 bytes, not only a task status or URL.
- Seedance generates a clip; it does not by itself prove grounded narration, subtitle timing, or final composition quality.

Therefore the product taxonomy and Studio UI intentionally do not expose `讲解视频` yet.

## Minimum release sequence

1. Obtain explicit authorization for one short paid provider smoke and verify returned MP4 bytes, duration, codec, and audio presence.
2. Add a persisted, owner-scoped explainer job with script, narration, subtitle, clip, and composition stages.
3. Install and gate a deterministic composition runtime; fail before billing when it is unavailable.
4. Add preview/download routes with content-type, byte, member, and notebook checks.
5. Add cancellation, timeout, partial-failure cleanup, billing settle/release, and rollback tests.
6. Run desktop/mobile UI smoke and a real end-to-end artifact audit before adding the product entry.

No fixed URL, sample MP4, timer-based success, or placeholder card is allowed in place of these gates.
