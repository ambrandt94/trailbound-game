# Character Forge runtime changelog

## 2.6.0 (api 2, generator 1: same recipes, hashes, meshes, skeleton, clips and pixels as 2.5.1): v2 skeleton is the only rig; new default
Clean release (Alex 2026-11-27 t318u, board CF-10: "Let's work those new skeletons into trailbound game, blitzball, and throughout character forge. We don't need any remnant of the old skeleton").
- **`dist/current.json` now points at 2.6.0** (it stayed on 2.1.1 through 2.2.0-2.5.1). Games that follow current.json get the v2 skeleton; games that vendor a fixed version move when they re-sync (see the migration packs).
- Ships only v2-rig content: the 14 body models (17 races, masc/fem) with the Fable/Claude v2 cf-humanoid-29 joints and weights, v2-retargeted Quaternius / KayKit packs, the CF clips and the procedural `Hover` (`policy.flyerIdle: 'hover' | 'idle'`, default `'hover'`). Same 29 joint names, hierarchy and rest rotations as every 2.x release; joint rest **positions** differ from <= 2.4.2 (UpperArm ~54 mm up / ~28 mm in, Clavicle ~20 mm up/out, Head pivot ~25 mm up, Knee ~6 mm forward, Foot ~18 mm up, LowerArm ~3 mm).
- Private KI packs (never bundled): the store folders `private_ki/` and `private_ki_mega/` now hold the **v2-rig** retargets (were `private_ki_v2rig/`, `private_ki_mega_v2rig/`, removed). The old-rig KI packs are archived off the default paths (store `private_ki_oldrig_DEPRECATED/`, `private_ki_mega_oldrig_DEPRECATED/`) only until the games have migrated.
- Internal data that is not a rig and stays: model mesh extras `cf_rigv2.legacy` / `legacy_bodytypes` (reference joint positions the race / body-type / frame shape rules are written against, so every rest shape is unchanged) and the `_CF_J0` / `_CF_W0` vertex attributes (body-region masks for shapes and kit body hiding). Bones bind and animate only at the v2 joints.
- **Deprecated / superseded:** every earlier runtime (2.1.0, 2.1.1, 2.2.0, 2.2.1, 2.3.0, 2.3.1, 2.4.0, 2.4.1, 2.4.2 = old skeleton; 2.5.0, 2.5.1 = v2 skeleton, superseded by 2.6.0 with identical output). Old-skeleton versions still pinned by a game (Blitzball 2.2.0, Trailbound 2.2.1) stay in the store until that game has moved to 2.6.0, then they are deleted; see `dist/DEPRECATED.md`.

## 2.5.1 (api 2, generator 1: same recipes, hashes, meshes and skeleton as 2.5.0; flyer default clip changes)
Flyer hover (Alex 2026-11-27 t316u/t317u, board CF-9: "animate the pixies and imps so their default is the hovering with wings flapping"; imp = slower bat flap, pixie = faster pixie wings).
- `Hover` is rebuilt procedurally (src/hover.js, CF-authored, 2.5 s seamless loop, every one of the 29 bones keyed plus the wing parts): body lifted ~55 mm (feet off the ground), bob and drift synced to the wing beat, legs hanging relaxed with knee bend and lagging follow-through, arms relaxed, head counter-tilt, tail sway.
- Wing style follows the wing part: bat wings (imp default) flap at **2 Hz** with a 55% downstroke, membrane folding on the upstroke and opening on the downstroke, wrist/finger lag and follow-through; insect / leaf wings (pixie default) flutter at **8 Hz**, small amplitude, figure-8 tip path and stroke twist. The wing meshes get 3 procedural morph targets (`fan`, `tuck`, `billow`) driven by the clip; wire overlays follow.
- Characters with visible wings (pixie, imp, or any recipe with a wing part) now start in `Hover`, and `play()` with no name plays `Hover` for them. New `policy.flyerIdle: 'hover' | 'idle'` (default `'hover'`); `'idle'` restores the 2.5.0 behaviour (start in `Idle`). Other clips (`Idle`, `Walk`, `FlyMove`, packs) are unchanged and still selectable; `Walk` stays grounded. `clips.Hover.userData.hover` = `{ style, hz, ... }`.
- Games pinned to an older version are not affected. `dist/current.json` is not moved (stays 2.1.1).

## 2.5.0 (api 2, generator 1: same recipes and hashes as 2.4.2; rest-pose shapes unchanged; new skeleton joint positions and skin weights; animated poses change)
v2 rig rollout (Alex 2026-11-27 t315u, board CF-3: "Claude fixed the arms! ... implement this skeleton for everything"). **Supersedes the 2.4.2 RSWT weights.**
- All 14 body models (17 races, masc and fem body types) use the Fable/Claude v2 cf-humanoid-29 rig: the shoulder, elbow, knee, ankle and neck pivots move to anatomical spots (UpperArm ~54 mm up / ~28 mm in, Clavicle ~20 mm up/out, Head pivot ~25 mm up, Knee ~6 mm forward, Foot ~18 mm up, LowerArm ~3 mm), with new skin weights solved for that skeleton. Arms out, arms overhead, jumping jacks and wide-stance poses no longer pinch or collapse the shoulder and hip.
- Same joint names, same hierarchy, same 29 skin joints, no helper bones, same rest rotations, <= 4 influences, same mesh and triangle counts. Existing clips (rotation tracks + Root position) play unchanged; limbs now rotate about the new pivots.
- Rest look is unchanged: every race / body-type / frame / head-scale shape rule keeps the 2.4.x joint positions (carried in the model GLB mesh extras `cf_rigv2.legacy` / `legacy_bodytypes`); only the bones bind at the v2 joints. Per body the moved limb joints are placed by landmark transfer (local affine fit of the body within 5 cm, as the reference tool), the head pivot by the old trunk rule, so ears / snouts / horns sockets and hair stay where they were.
- Garments (wardrobe shells, hoods / cloaks, layer-fit pieces, kit garments such as Blitzball swimwear) take their skinning from the body, so they follow the new weights; kit garment retargeting uses the same shape joints as 2.4.2 (identical fit at rest).
- Model GLBs ~0.3 KB larger each (legacy joints in extras). Original weights still ride along as `_CF_J0` / `_CF_W0` (region sorting only).
- Bundled clip packs (Quaternius / KayKit anim packs) are re-retargeted onto the v2 skeleton: arms aim along the new shoulder -> elbow -> wrist segments, foot IK uses the new ankle. The private KI packs have v2 copies in the store (`private_ki_v2rig`, `private_ki_mega_v2rig`, need runtime >= 2.5.0); the original KI packs stay for <= 2.4.2. KI caveat: the higher, wider ankle makes wide side-steps / full-extension frames miss the source foot spot by a few mm more (mean +0.9 mm), foot sliding is lower.
- Games pinned to an older version (e.g. Blitzball) are not affected until they move their pin; their clips keep working on 2.5.0 (same joint names, rotation-only tracks) but arm/leg poses look different, so re-check hand / foot contacts (grips, footplants) before switching. `dist/current.json` is not moved (stays 2.1.1).

## 2.4.2 (api 2, generator 1: same recipes and hashes as 2.4.1; rest-pose shapes unchanged; animated poses change at the shoulders and hips)
Skin-weights rollout (Alex 2026-11-26 t306u, board CF-3):
- All 14 body models (17 races, masc and fem body types) get smoother shoulder (Clavicle -> UpperArm) and hip (Pelvis -> Thigh) skin weights from a robust skin-weights inpainting pass (biharmonic, Abdrashitov et al. 2023). The arm / thigh blend zone is about half as wide as before (shoulder ~112 -> ~52 mm, hip ~120 -> ~63 mm), so raised arms and lifted legs no longer pinch or notch the shoulder and groin.
- Same rig (cf-humanoid-29), same clips, same mesh and rest pose. The original weights ride along in the GLBs as `_CF_J0` / `_CF_W0` and are used only to sort body regions for the race / body-type / frame shapes and kit body hiding, so every shape and fit is the same as 2.4.1 at rest.
- Garments, kit swimwear and hair use the new weights through the body, so they follow the smoother shoulders and hips.
- Model GLBs are ~118 KB larger each (original weights kept). `dist/current.json` is not moved (stays 2.1.1).

## 2.4.1 (api 2, generator 1: same recipes, hashes and goldens as 2.4.0 except halfling body.fat > 2 and the dwarf / gnome / goblin default noses)
Frames and noses follow-up (Alex 2026-11-26 t306u):
- Halfling Weight range is now `fat: [-0.8, 3.2]` (was up to 2). Past 2 the belly stops pushing straight out and the body widens instead: rounder belly that rises into the chest, wider hips and waist, fuller cheeks and jaw. Every other race keeps its range, and shapes up to fat 2 are unchanged.
- Bigger noses: dwarf `nose_dw_bulb` and gnome `nose_gn_bulb3` bulbs are larger and sit lower over the moustache (same 116 triangles). Goblin `nose_gb_droop` is longer and droops further to a point (164 triangles + 42 brow). The `nose_gb_hook` option is unchanged.
- `dist/current.json` is not moved (stays 2.1.1).

## 2.4.0 (api 2, generator 1: same recipes, hashes and goldens as 2.3.1 for recipes without body.mu / body.fat; dwarf / gnome / goblin default noses changed)
Body frames (Alex 2026-11-26: "a watered down version of body sliders ... make some choices about frame and size within the limits of your race"; "a skinny guy vs a big bulky guy, a fat hobbit vs a more normal hobbit, a huge hulking orc vs a smaller more slender one"):
- Recipe `body.mu` (Build: skinny .. bulky / muscular: shoulders, chest, back, arm / neck / thigh thickness) and `body.fat` (Weight: lean .. heavy: belly, hips / seat, limbs, neck, face fullness). Optional; absent or 0 = the old body exactly (recipe hashes and goldens unchanged). `body.h` stays the height slider.
- Real shape deformation of the shared cf-humanoid base (the same deform code as h / b / s, extra x / z offsets), not a uniform scale and no per-race meshes. Skeleton joints widen through the limb shift only (no new bones, same clips).
- Per-race limits: `CF.options(race).frame = { mu: [min, max], fat: [min, max], h: [min, max] }` (also exported tables `FRAME`, `frameRange(race)` in core). Big frames: dwarf / goliath / firbolg / orc (Build up to 2); round: halfling (Weight up to 2), gnome 1.8, dwarf 2. Out-of-range values are clamped with a warning (`body.mu` / `body.fat`). Kit races use the default range.
- Garments follow: drop-in GLB garments and tails ride the same deform, wardrobe shells / layer-fit pieces / belt props are built on the deformed surface, and kit garments (e.g. Blitzball swimwear) get the body's frame deltas transferred onto them before autofit (nearest-vertex morph-delta transfer).
- `randomRecipe` / `generate` are unchanged (no frame values) so seeded output is identical to 2.3.1.
Noses (Alex 2026-11-26 refs): new defaults dwarf `nose_dw_bulb` (big round bulb over the moustache, wide nostrils), gnome `nose_gn_bulb3` (same shape, gnome size), goblin `nose_gb_droop` (long hooked nose drooping to a point, deeper brow swell, nasolabial creases). `nose_gb_hook` stays as an option, de-beaked (shorter, blunter tip). Previous defaults stay selectable. Recipes with `snout: 'auto'` on those three races render the new nose.
- `dist/current.json` is not moved (stays 2.1.1).

## 2.3.1 (api 2, generator 1: same recipes, hashes and goldens as 2.3.0; default 'current' lighting renders 0 px different)
Consistent pixel shading (Alex 2026-11-25: "the face has polygons changing colors very noticeably and I want the pixel shading to be consistent"):
- `setLighting({ mode: 'tb' | 'pixel' | 'flat' })` lights every mesh of a body, not only the skin. Hair, beard, ears, snouts, horns, tails, wardrobe shells and kit garments (e.g. Blitzball swimwear) get the same Trailbound dithered pixel lighting. In 2.3.0 they stayed on plain three.js lighting (hair and parts unlit).
- Skin, hair and parts are lit on the object-space clothing texel grid with smooth normals. Hair has no UVs, and before this fix its lighting was stuck on one texel, so each triangle got a single flat shade. Shells and kit garments keep their own UV atlas grid. Program cache keys are `|tb2` / `|tb2|og`.
- Switching to tb / flat also re-lights bodies that are already built. Builds in the default 'current' mode are untouched.

## 2.3.0 (api 2, generator 1: same recipes, hashes and goldens as 2.2.1; default access renders 0 px different)
Wardrobe sets and per-app access (Alex 2026-11-25: "a tab for swimsuits, and trailbound categories of clothing ... access to all and the ability to mix and match completely, within character forge. Obviously individual apps will have varying access"):
- Garment **tags** `{ sets, slot, style }` on every builtin garment (`src/wardrobe_tags.json`) and on kit garments (`cf-kit` manifest `garments[].tags`, labels in the top-level `sets`). The Blitzball kit 1.1.0 tags its 4 garments `blitzball/swimwear`.
- `CF.sets()`, `CF.garmentTags()`, `CF.garmentAllowed()`, `CF.kitAllowed()`; `tags` in `catalog()` / `options()`.
- **Access allowlist** (`cf-access/1`): `CF.init({ access | accessUrl })`, `CF.setAccess`, `CF.getAccess`, `CF.loadAccess`. The default is everything. Denied garments are filtered from catalog / options / sets / random picks; `equip` and `loadKit` throw `CF_ACCESS_DENIED`; recipes drop denied garments with a warning.
- `init()` result has `access`. Bundle has a `wardrobe` block. `dist/current.json` is not moved (stays 2.1.1).

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
