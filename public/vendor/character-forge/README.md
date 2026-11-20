# `public/vendor/character-forge`

Vendored Character Forge builds live here, one directory per version. `current.json` is the active v1 pin (`version`, `generatorVersion`). `current-v2.json` is the v2 pin and does not replace it.

Nothing in the version directories is hand-edited. `tools/sync-character-bundle.mjs` is the only writer (`npm run sync:cf -- <CF_DIST>`). A 1.x dist updates `current.json`. A 2.x dist writes `current-v2.json` and leaves the active pin alone. 1.2.0 stays on disk. 1.2.1 is the ESM build for Three r187 and the runtime the game loads by default. 2.1.0 is Character Forge api 2 (`?cf=2`). The game profile is `content/characters/trailbound.json`. `src/render/characters/backends/v1.ts` and `backends/v2.ts` are the runtime callers. `src/render/characters/forge.ts` is the game-facing seam.
