# React Bits visual adaptations for Lingbi

Upstream: https://github.com/DavidHDev/react-bits
Reference commit: `2139cb3098d4fedc6264f13e50dcb4694224ba7c`. Copyright (c) 2026 David Haz.

Sources consulted:
- `src/ts-default/Animations/AnimatedContent/AnimatedContent.tsx`
- `src/ts-default/Animations/FadeContent/FadeContent.tsx`
- `src/ts-default/Components/SpotlightCard/SpotlightCard.tsx`

Lingbi adapts the short, once-per-entry reveal and pointer-local spotlight concepts to its existing research interface. The implementation uses the browser Web Animations API, IntersectionObserver and the existing delegated pointer handler. No GSAP, WebGL or new package is installed. Effects remain part of the Lingbi application, not a separately distributed component product.

Adaptations: visible server-rendered text; 440ms / at most 12px entry; motion cancellation on preference changes or hidden tabs; hover/focus-only light; static coarse-pointer and reduced-motion modes; brief opaque-dialog transitions. Preserve this notice and the upstream license with the application source.
