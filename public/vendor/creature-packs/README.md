# Creature packs

Character Forge runtime `public/vendor/character-forge/` is the character-recipe bundle (pin `current.json`, currently 1.2.0). That runtime has no creature loader.

Approved creature packs live here, one immutable directory per version:

```
public/vendor/creature-packs/<id>/<version>/manifest.json
public/vendor/creature-packs/<id>/<version>/packs/<file>.glb
```

The game pin is `src/core/content/pack-ox.pin.json` (`id`, `version`, `sha256`). A later pack is a new version directory plus that pin. Do not edit a published version in place.

`pack_ox` 0.1.2 was approved by Alex on 9 Nov 2026 as the tier-1 wagon draft animal. The manifest names Character Forge bundle 1.2.1; the game's character bundle is still 1.2.0, and the ox does not call that runtime. The GLB is metres, +Y up, +Z forward, origin on the ground between the hooves. `sha256` `e3ac943c9e8dbf942e30c8fcabefc7d3405625a58d984d0ceba68209a2b67558`.
