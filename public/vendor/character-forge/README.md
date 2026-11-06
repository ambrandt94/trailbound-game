# `public/vendor/character-forge`

Vendored Character Forge builds live here, one directory per version, plus `current.json` as the only pin (`version`, `generatorVersion`).

Nothing in this folder is hand-edited. `tools/sync-character-bundle.mjs` is the only writer (`npm run sync:cf -- <CF_DIST>`). 1.2.0 is the ESM build for Three r187: `cf-runtime.mjs`, `CF.init({ THREE, baseUrl })`, plus the recipe edit API (`options`, `describe`, `checkEdit`, `edit`). The game profile is `content/characters/trailbound.json`. `src/render/characters/forge.ts` is the only caller.
