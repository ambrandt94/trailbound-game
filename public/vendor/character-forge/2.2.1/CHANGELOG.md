# Character Forge runtime changelog

## 2.2.1 (api 2, generator 1: same recipes, hashes and goldens as 2.2.0)
Full-body locomotion (Alex 2026-11-25: "make sure we use the one that uses the animation fully"):
- New `policy.locomotion: 'full'` (default). `body.clips.Idle / Walk / Run` are mocap with relaxed arms, clavicles, neck and spine in motion: `KI_Idle / KI_Walk / KI_Run` when the private KI pack is registered and `animationSet` includes `ki`, otherwise CC0 Quaternius `Idle / Walk / Run` (public bundle, loaded automatically). Before, `Idle` keyed only Chest/Head and held the arms frozen in the A-pose bind (44 deg below horizontal), which read as a stiff T/A-pose in games.
- Every skeleton bone a locomotion clip leaves unkeyed (Pelvis in KI and Quaternius) gets a rest key, so crossfades never mix toward the bind pose.
- The CF-authored clips stay available as `CF_Idle` / `CF_Walk`. `policy.locomotion: 'cf'` restores 2.2.0 exactly. Flyer `Hover` / `FlyMove` unchanged; kit clips with `override` still win.
- KI stays private: nothing licensed is added to the dist.

## 2.2.0 (api 2, generator 1: same recipes, hashes, goldens and random generation as 2.1.x)
Registration API (kits), for Blitzball (three r180 → the >=0.187 <0.190 pin) and later games:
- **Kits:** `CF.loadKit(url | manifest)`, `CF.validateKit`, `CF.unloadKit`, `CF.registry()`, `CF.registerSlot`, `CF.registerGarment`, `CF.registerRace` (alias of a builtin human-like race), `CF.registerClip`. Manifest format `cf-kit/1` (superset of the Blitzball `wardrobe.json`), validated; ids namespaced `<namespace>/<id>`; errors `CF_KIT_INVALID`, `CF_KIT_CONFLICT`, `CF_KIT_FETCH`.
- **Mesh garments** skinned to cf-humanoid-29 bound by bone name, **autofit** to every race, body type and body slider (retarget + surface snap + gap guard + body-surface skin weights + covered-body hiding), lazy chunk `kitmesh-*.mjs` (no cost when no kit is used). `body.info.kit` = fit report.
- **Overrides:** kits may replace builtin garments (`override: true`, same slot and variant ids).
- **Hides as data** (`body:<region>`, `slot:<slot>`, `<garment>`, `<garment>:<segment>`, `horns`, `wings`, `hiddenBy`).
- **Tint dye** kind `tint` with optional mask (team colours); painted change.
- **Kit clips** (CF clip JSON, relative root motion); KI / licensed content refused in kits.
- **Recipes** stay v2; optional `kits: [{ namespace, version }]` (only when used); `CF_KIT_MISSING` when building without the kit; `CF_KIT_VERSION` warning.
- Schema: namespaced race / slot / garment ids and the `kits` property.
- `dist/current.json` is not moved by the 2.2.0 build (games opt in per project).

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
