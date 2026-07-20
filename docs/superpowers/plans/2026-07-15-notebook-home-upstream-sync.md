# Notebook Home Upstream Sync Plan

1. Record clean branch, `HEAD`, `origin/main`, ahead/behind, and the formal-domain RED state.
2. Add the upstream home usability contract and prove it fails on the current UI.
3. Merge `origin/main` normally; resolve only adapter overlap and retain all paper-host boundaries.
4. Run the targeted contract plus adapter/discovery/guest-isolation tests, then `validate`, type/lint, production build, Linux package, and diff/secret/debug scans.
5. Start the package on standby, verify health and the home interactions, then atomically release or roll back.
6. Re-run the same interactions through `ucas.sitianai.com`, update audit outputs, and stop this slice.
