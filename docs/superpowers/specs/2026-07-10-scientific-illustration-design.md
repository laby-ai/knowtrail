# Scientific Illustration Product Design

## Goal

Add a real Results Expression / Scientific Illustration product whose honest
scope is scientific schematics. It must generate an image through the
configured image provider, persist the resulting file, preview it, and download
it.

## Product Boundary

- Supported: conceptual frameworks, method diagrams, workflows, and mechanism
  schematics grounded in the user's selected sources.
- Not supported: statistical charts, measured axes, significance annotations,
  causal findings, or any claim that data analysis has been executed.
- No sample images, fixed URLs, fallback gradients, simulated success, or
  unlicensed reference images.

## Data Flow

1. The user selects sources, states the figure purpose, chooses a schematic
   type and aspect ratio, and optionally lists up to six required labels.
2. A same-origin route validates account/notebook scope and reserves one
   ai.image usage unit.
3. The route builds a guarded prompt from the request and selected-source
   excerpts, then calls the existing real image provider used by PPT.
4. The returned base64 payload is validated as PNG, JPEG, or WebP and stored
   under the persistent runtime data directory with owner metadata.
5. Authenticated file responses support inline preview and attachment download.
6. The UI fetches the file with account headers, creates a temporary object URL,
   and revokes it when replaced or unmounted.

## Failure Handling

- Empty purpose, no selected sources, invalid type/aspect ratio, too many
  labels, or invalid provider output returns a stable typed error.
- Provider timeout and user cancellation do not render or persist a result.
- Billing reservations settle only after a valid file is stored and release on
  failure.
- A file may only be read by the member that created it.

## Verification

- Contract tests cover prompt boundaries, image validation, owner checks, and
  taxonomy/navigation behavior.
- Browser smoke covers a real application request against a fake image provider,
  preview, download, cancellation, malformed provider output, and mobile layout.
- A one-image real-provider smoke is required before release.
