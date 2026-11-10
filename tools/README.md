# `tools`

Cross-platform Node scripts. No bash.

- `asset-guard.mjs` — fails if a committed tree contains `.unitypackage`, `.fbx`, `.blend`, `.psd`, or a file over 10 MB. `npm run assets:guard` runs it, and `npm run check` includes that.
- `capture-g0.mjs` — Playwright shots of the G0 shell. Not part of `check` (it needs a browser). Run it against a dev server: `node tools/capture-g0.mjs`.
- `sync-character-bundle.mjs` — copy a Character Forge dist into `public/vendor/character-forge/<version>/` and write `current.json`. `npm run sync:cf -- <CF_DIST>`.
- `capture-creator.mjs` — Playwright shots of the character creator. Not part of `check`. Run it against a dev server: `node tools/capture-creator.mjs`.
- `ui-sheet.mjs` / `ui-import.mjs` — paint-over UI template. See `assets-src/ui-template/README.md`. `npm run ui:import` slices the sheet into `src/ui/theme`. `npm run ui:sheet` redraws the starter sheet and wipes paint.
