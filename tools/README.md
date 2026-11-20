# `tools`

Cross-platform Node scripts. No bash.

- `asset-guard.mjs` — fails if a committed tree contains `.unitypackage`, `.fbx`, `.blend`, `.psd`, a file over 10 MB, or a Kevin Iglesias animation name (`KI_`, `Kevin`, `ki_manifest.json`). `npm run assets:guard` runs it, and `npm run check` includes that.
- `capture-g0.mjs` — Playwright shots of the G0 shell. Not part of `check` (it needs a browser). Run it against a dev server: `node tools/capture-g0.mjs`.
- `sync-character-bundle.mjs` — copy a Character Forge dist into `public/vendor/character-forge/<version>/`. A 1.x dist writes `current.json`. A 2.x dist writes `current-v2.json` and leaves the v1 pin alone. `npm run sync:cf -- <CF_DIST>`.
- `capture-creator.mjs` — Playwright shots of the character creator. Not part of `check`. Run it against a dev server: `node tools/capture-creator.mjs`.
- `ui-sheet.mjs` / `ui-import.mjs` — paint-over UI template. See `assets-src/ui-template/README.md`. `npm run ui:import` slices the sheet into `src/ui/theme`. `npm run ui:sheet` redraws the starter sheet and wipes paint.
- `music-sync.mjs` — copy a Trailbound music bundle (from the Asset Matrix) into `public/assets/audio/music/` and write `manifest.json`. `node tools/music-sync.mjs <BUNDLE_DIR>`. See that folder's README.
- `capture-music.mjs` — headless walk through the soundtrack contexts, logging the selected track and crossfade gains. Not part of `check` (it needs a browser).
