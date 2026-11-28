# Character Forge

Vendored Character Forge builds live here, one directory per version. `current-v2.json` is the runtime pin (`version`, `generatorVersion`). `current.json` is the save pin and names the same version. A 2.x sync writes both.

Nothing in the version directories is hand-edited. `tools/sync-character-bundle.mjs` is the only writer (`npm run sync:cf -- <CF_DIST>`). A 1.x dist is refused. 2.6.0 is Character Forge api 2 on the v2 skeleton and the runtime the game loads. Its default locomotion is full-body Quaternius Idle, Walk, and Run, retargeted to the v2 joints. Winged races stand in Hover unless a caller plays Idle. A private build sets `VITE_CF_PRIVATE_ANIM_URL` to the v2-rig Kevin Iglesias pack (Character Forge store `runtime_v2/private_ki/`). That pack is not in this tree. The game profile is `content/characters/trailbound.json`. `src/render/characters/backends/v2.ts` is the runtime caller. `src/render/characters/forge.ts` is the game-facing seam.
