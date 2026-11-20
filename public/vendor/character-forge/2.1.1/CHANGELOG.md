# Character Forge runtime changelog

## 2.1.1 (api 2, generator 1: same recipes, goldens and pixels as 2.1.0)
Fixes from the Trailbound game integration (trailbound-game PR #45, `?cf=2`):
- **edit / checkEdit keys:** `skin` / `skinTone` are aliases of `tone`, `hairStyle` of `hair` (noted in warnings). Unknown keys are now errors (`checkEdit` ok:false with `errors[{path,msg}]` listing the known keys; `edit` throws `CF_EDIT_REJECTED`) instead of being ignored. Alias/field conflicts and edits of `format`/`v`/`generatorVersion`/`name` are errors.
- **setLighting:** validated. `mode` is `'current' | 'tb' | 'flat'`; `'pixel'` stays a documented alias of `'tb'` and the result reports it (`aliases: ['mode: pixel -> tb']`). `sunColor` (no light colour in the v2 shader), unknown keys, unknown modes and malformed values throw `CF_LIGHTING`.
- **init({ animationSet }):** new option (= `setPolicy({animationSet})`). Registering a private pack (`privateAnimBaseUrl` / `registerAnimSet`) does **not** switch the policy; `init` returns `animSets` and a `notes[]` warning when a pack is registered but off.
- **init({ platform }):** `{ createCanvas, createImageBitmap | decodeImage, fetch, document }` replaces every DOM global the build used (`document`, `Image.decode`, `createImageBitmap`, `self`/`blob:` URLs in GLB texture loading). Headless Node builds work with no DOM globals (tested with @napi-rs/canvas; same tris / hashes / vertex checksums as Chrome). Unknown platform keys throw; missing pieces throw `CF_PLATFORM`.
- Node: the sliced build's MessageChannel keeps the process alive only while a step is pending (2.1.0 could exit mid-build in a script with nothing else pending).

## 2.1.0
Sliced / cooperative build (`budgetMs` default 6), stable `Body.mixer`, crowd memory roughly halved, private KI animation packs (`registerAnimSet`, `privateAnimBaseUrl`, `cf+ki` / `cf+cc0+ki`), Meshy bodies cleared.

## 2.0.0
Character Forge v2 runtime (api 2).
