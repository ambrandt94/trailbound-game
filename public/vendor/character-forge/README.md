# `public/vendor/character-forge`

Vendored Character Forge builds live here, one directory per version, plus `current.json` as the only pin (`version`, `generatorVersion`).

Nothing in this folder is hand-edited. `tools/sync-character-bundle.mjs` is the only writer (`npm run sync:cf -- <CF_DIST>`). `current.json` selects the runtime directory. 1.2.0 stays on disk. 1.2.1 is the ESM build for Three r187: `cf-runtime.mjs`, `CF.init({ THREE, baseUrl })`, the recipe edit API, and edit-catalog `slotRegions` plus `garments[id].occupation`. Generator version stays 1 and catalog `v` stays 1. The game profile is `content/characters/trailbound.json`. `src/render/characters/forge.ts` is the only caller.
