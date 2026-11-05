# `public/vendor/character-forge`

Vendored Character Forge builds live here, one directory per version, plus `current.json` as the only pin.

Nothing in this folder is hand-edited. The sync script (`tools/sync-character-bundle.mjs`, added with the Forge port) is the only writer. G0 ships no bundle. The area view uses a placeholder pawn until Forge publishes an ESM build tested on Three.js r187.

Request for that build: an `cf-runtime.mjs` whose `CF.init({ THREE })` receives the game's ESM `three` module, with `bundle.json.three` set to `>=0.187 <0.190`. If `init`, `generate`, `packsFor`, `build`, and `recipeHash` stay the same, this can be 1.1.0 at API 1. The generator also needs to honour a fixed `race`. Golden renders need a re-baseline for r187 colour space and physical lights.
