# `tools`

Cross-platform Node scripts. No bash.

- `asset-guard.mjs` — fails if a committed tree contains `.unitypackage`, `.fbx`, `.blend`, `.psd`, or a file over 10 MB. `npm run assets:guard` runs it, and `npm run check` includes that.
- `capture-g0.mjs` — Playwright shots of the G0 shell. Not part of `check` (it needs a browser). Run it against a dev server: `node tools/capture-g0.mjs`.

Later: `sync-character-bundle`, character parity, and people metrics.
