# Character Forge runtime 2.3.1 (api 2)

> **2.6.0: v2 skeleton only.** cf-humanoid-29 (29 skin joints, same names/hierarchy as every 2.x) with the v2 joint positions (shoulders, elbows, knees, ankles, neck moved to anatomical pivots). Releases <= 2.5.1 are deprecated; see CHANGELOG.md.

```js
import * as THREE from 'three';                       // peer dependency, >=0.187 <0.190 (tested 0.187.0)
import CF from './character-forge/2.2.0/cf-runtime.mjs';
await CF.init({ THREE, baseUrl: '/character-forge/2.2.0/' });   // optional: fetch, createCanvas|canvasFactory, decodeImage, policy, bundle (CF_API_MISMATCH check), privateAnimBaseUrl, animationSet, platform
const recipe = CF.randomRecipe(1234, { race: 'dwarf', role: 'smith', tier: 'town' });
const body = await CF.build(recipe, { texSize: 256, signal });   // sliced: yields every ~6 ms (budgetMs), sync-equivalent result
scene.add(body.object3D); body.play('Walk');           // per frame: body.mixer.update(dt)
const { recipe: r2 } = CF.equip(recipe, 'torso_mid', 'calico_vest', { variant: 'indigo' });
await body.setRecipe(r2);                              // painted change: uniform/atlas only (~0.1-5 ms)
```

## Core (DOM-free, no three, no Math.random)
Import and these run in Node with no `document` / `window`: `init`, `catalog`, `races`, `options`, `describe`, `checkEdit`, `edit`, `equip`, `unequip`, `dye`, `hideTable`,
`randomRecipe(seed, {race, races, bodyType, role, style, tier, richness, outfit})`, `generate(seed, profileEntry)` (v1-shaped, game profile entries),
`defaultRecipe`, `blankRecipe`, `normalize`, `validateRecipe`, `validateProfile`, `recipeHash` (16 hex, sha256 of canonical JSON), `migrate(v1|v2)`, `setPolicy`/`getPolicy`.

- `checkEdit(recipe, patch)` / `edit(recipe, patch)` keys: the recipe fields (`race bodyType bodyAmt tone marks hair hairColor fade beard beardColor ears snout horns hornSize hornDye wings eyes brows iris browColor eyeOffset style seed body expression outfit dye`) plus aliases **`skin` / `skinTone` → `tone`** and **`hairStyle` → `hair`** (noted in `warnings`). Any other key is an **error** (`checkEdit` → `ok:false`, `errors[{path,msg}]`; `edit` throws `CF_EDIT_REJECTED`); an alias that disagrees with its field in the same patch is an error; `format`/`v`/`generatorVersion` are accepted only unchanged; `name` is rejected (normalized recipes do not store it). 2.1.0 ignored unknown keys with a warning.
- Race ids: `human wood_elf dark_elf great_elf mousefolk tiefling halfling gnome dwarf goliath firbolg orc goblin kobold imp pixie dragonborn`.
  v1 `elf`, `djinn`, `elder`, `thug` do not exist in v2; `policy.missingRaces` maps them (default elf→wood_elf, djinn/elder/thug→human, with a migrate note).
- Roles: player, wanderer, villager, guard, merchant, smith, mage, ranger, innkeeper (+ profile style aliases pioneer, villager_man/woman, soldier, miner, scholar). Tiers hamlet..capital = richness .15..9.
- Recipe v2: see `recipe.schema.json`. Painted pairs (socks) use `'left/right'` variants (`'grey/darned'`).
- Wardrobe results: `{recipe, displaced[], hidden[], warnings[]}`. Race cuts are warnings (`cut`), `denied` is an error. Wings show through cloaks (`policy.wingsUnderCloak`).

## Bodies
`CF.build(recipe, {budgetMs, texSize, signal, trace})` → `{object3D, mixer, clips, info, play(name,{fade,timeScale}), setTimeScale, socket(name), setRecipe(next, {budgetMs, signal, trace}), dispose}`.
- Feet at y=0, +Z forward, 1 unit = 1 m (chibi scale: human 0.946 m; per race `catalog().races[id].heightM`, `strideM`, `walkDuration`).
- Clips (2.2.1, `policy.locomotion: 'full'`, the default): `Idle`, `Walk`, `Run` are fully animated mocap with every rig bone keyed: `KI_*` when the private KI pack is in `animationSet`, otherwise CC0 Quaternius (public-safe, `assets/packs/quaternius_anims.glb`, loaded automatically). The CF-authored clips stay as `CF_Idle`, `CF_Walk`. `clip.userData.locomotion` = `'ki' | 'quaternius'`. `locomotion: 'cf'` restores the 2.2.0 behaviour below.
- Clips (2.2.0 / `locomotion: 'cf'`): `Idle`, `Walk` always (CF-authored); pixie/imp also `Hover`, `FlyMove` (wing flap baked as tracks). 2.5.1: `Hover` is a procedural hover (imp bat flap 2 Hz, pixie flutter 8 Hz, wing morphs, legs dangling) and is the default clip for winged characters (`policy.flyerIdle: 'idle'` to opt out). With `policy.animationSet: 'cf+cc0'`: `Run Attack1H Magic PickUp Cheer` (Quaternius, CC0).
  With `'cf+ki'` / `'cf+cc0+ki'`: `KI_Idle KI_Walk KI_Run KI_Attack1H KI_Magic KI_PickUp KI_Cheer` from the **private** Kevin Iglesias pack (see below; HumanF clips for `fem`, HumanM for `neutral`/`masc`; race Idle tail sway layered in). `clip.userData.license` names the source of every clip.
- Sockets (Object3D children of bones, follow animation): `hand_l hand_r` (0.55 × hand length), `back` (Chest, back surface), `belt` (Hips), `head` (crown).
- `setRecipe` paths: `painted` (painted garments/dye/procedural colours: uniforms + cached atlas, synchronous), `layers` (mesh layers, hair, face, sliders) and `rebuild` (race/model change): a fresh Character is built in slices off to the side and swapped in at the end (no half-built frame; the current clip and its time carry over). Returns `{path, ms, maxStepMs, steps, trace}`.
- **Sliced build (2.1.0):** the Character build is cooperative: it runs in steps of about `budgetMs` (default **6 ms**) and yields to the event loop between steps (MessageChannel task), so frames keep rendering while a body builds. `budgetMs: 0` or `Infinity` = one synchronous step (2.0.0 behaviour). Builds are queued one at a time; results are identical to the unsliced build (same goldens). `info.steps`, `info.maxStepMs`, `info.workMs` (sum of steps), `info.maxStepAt`; `{trace: true}` adds `info.trace` ([ms, fromSite, toSite] per step).
- Not sliced: the first engine start (module evaluate + face / hair tables, one ~80-170 ms task once per page: call `CF.preload([...])` behind a loading screen) and GLB parsing (three's GLTFLoader, async).
- Memory (2.1.0): bodies of the same model share index / uv / skin weights / rest attributes (only position + normal are per body; rest normals shared unless the chest reshape is on); downscaled skin maps are cached per palette; wardrobe and hair maps are 8-bit palette indices + small colour ramps. Disposing a body never frees shared buffers' CPU data (three re-uploads on next use).
- `build` honours `signal` (AbortError) between steps.
- `CF.setLighting({mode, sunDir:[x,y,z], dir, yaw, pattern, space:'texel'|'screen', edge, strength, hue})` is global (shared shader uniforms). `mode`: `'current' | 'tb' | 'flat'`; `'pixel'` is a documented alias of `'tb'` (same shader) and the result says so (`aliases: ['mode: pixel -> tb']`, `mode: 'tb'`). `sunColor` is **rejected** (the v2 shader has no light colour: use `hue` in tb mode or tint your scene), as are unknown keys / modes / malformed values: error `code: 'CF_LIGHTING'`.
- `CF.freeCpuGeometry === false`: CPU geometry is kept; bodies survive renderer disposal.
- Assets: `CF.assetsFor(recipes)` lists exactly the lazy files `build` fetches; `CF.preload(recipes|raceIds|fileIds, {signal})`.

## Headless / injected platform (Node, workers, tests)
Only `build` / `setRecipe` need a canvas and an image decoder; pass them instead of relying on DOM globals (`document`, `Image`, `createImageBitmap`, `self` are never required when a platform is given):
```js
import { createCanvas, loadImage } from '@napi-rs/canvas';   // any canvas with getContext('2d') + getImageData/putImageData/drawImage
await CF.init({ THREE, baseUrl: '', platform: {
  createCanvas: () => createCanvas(1, 1),                                   // resized by the runtime
  createImageBitmap: async (blob) => loadImage(Buffer.from(await blob.arrayBuffer())),   // or decodeImage: async (b64png) => drawable
  fetch: async (url) => new Response(await readFile(new URL(url, distDir))) } });
```
- Keys: `createCanvas`, `createImageBitmap(blob, opts)`, `decodeImage(b64png)` (either decoder is enough; the other is derived), `fetch`, `document` (`{createElement('canvas')}`). Unknown keys throw. Top-level `createCanvas` / `decodeImage` / `document` / `fetch` still work (2.0 shape).
- With a platform decoder (or when the page has no `createImageBitmap` / `self`), GLB textures are decoded through it (no `blob:` URLs). Missing pieces throw `CF_PLATFORM` at build time.
- Tested: `test/node_headless/build_test.mjs` (Node 24, no DOM globals, @napi-rs/canvas): 6 races + painted / layers `setRecipe`; tris, recipe hash and vertex checksums equal the Chrome build (`test/node_parity.html`).

## Policy (defaults are neutral placeholders until decided)
`animationSet`: `'cf' | 'cf+cc0' | 'cf+ki' | 'cf+cc0+ki'` (anything else throws).
`{ animationSet: 'cf', flyerIdle: 'hover', migration: 'regenerate', missingRaces: {elf:'wood_elf', djinn:'human', elder:'human', thug:'human'}, tieflingPlayable: true, regalia: 'kits', regaliaMinRichness: .85, adoption: 'runtime-first', wingsUnderCloak: 'show', locomotion: 'full' }`

## Migration from 1.2.x
`CF.migrate(v1)` → `{recipe, lossy: true, notes[]}`: race (renamed / mapped), gender→bodyType, nearest skin tone, nearest hair colour, eye colour if in the v2 iris set, seed and style carried; hair style, face, sliders (24→3) and outfit (69 garments → v2 kit by style) are regenerated from the seed. `migrate(v2)` is identity (`lossy:false`).

## Kits (2.2.0): registering slots, garments, races and clips
Additive in 2.2.0: every 2.1.x recipe, `recipeHash`, `randomRecipe` / `generate` result and golden is unchanged, and seeded generation never picks kit content.
```js
await CF.init({ THREE, baseUrl: '/cf/2.2.0/' });
const res = await CF.loadKit('/kits/blitzball/blitzball.cfkit.json');   // or a manifest object + { baseUrl }; assets resolve relative to the manifest
// res = { namespace, version, slots, garments, races, clips, warnings }
let r = CF.normalize(CF.blankRecipe('orc'));
r = CF.equip(r, 'legs', 'blitzball/boardshorts').recipe;                 // kit ids are '<namespace>/<id>'
r = CF.dye(r, 'blitzball/boardshorts', 'team', '#1e5bd8').recipe;        // tint dye: painted change, no rebuild
const b = await CF.build(r); b.play('Swim');                             // kit clips join the clip list (Idle, Walk, ..., Swim, Tread)
```
- `CF.loadKit(urlOrManifest, { baseUrl, namespace, signal, preload })` validates and registers a **`cf-kit/1`** manifest (a superset of Blitzball's `wardrobe.json` `cf-swimwear/1`: add `format`, `namespace`, `version`). Invalid → throws `CF_KIT_INVALID` (`err.errors[{path,msg}]`); fetch failure → `CF_KIT_FETCH`; ids owned by another loaded kit → `CF_KIT_CONFLICT`. Loading the same namespace again replaces it. `preload: true` fetches the meshes / textures / clips now; otherwise `build` fetches them (and `assetsFor` lists them).
- `CF.validateKit(manifest)` → `{ ok, errors, warnings }` (no registration). `CF.unloadKit(namespace)`. `CF.registry()` → `{ format, rig, kits, slots, garments, races, clips }` (kit content only).
- `CF.registerSlot(def, {namespace})`, `CF.registerGarment(def, {namespace, baseUrl})`, `CF.registerRace(def, {namespace})`, `CF.registerClip(def, {namespace, baseUrl})`: one-entry kits (`def.id` = `'ns/id'`, or a local id + `{namespace}`); they merge into a loaded kit of that namespace.
- **Garments** (`garments.<id>`): `kind: 'mesh'` GLB (`file`, optional `nodes`, `segments: {name: node}`) skinned to **cf-humanoid-29** and bound by bone name; `slot` (builtin or kit slot), `band` / `layer` (under < base < mid < armor < outer), `variants`, `texture`, `mask`, `dye: [{ region, kind: 'tint', default, mask }]` (legacy `material: 'TeamTint'` = one `team` region), `hides`, `hiddenBy`, `displaces`, `races: '*' | [ids]`, `fit: { mode: 'auto' | 'hug' | 'keep', hugMm: 8, minGapMm: 2, weights: 'surface' | 'garment' }`, `shellOffsetM`.
- **Overrides:** a kit may replace a builtin garment with `override: true` under the builtin id; it must keep the builtin slot and variant ids. Overrides do not add a `kits` entry to recipes (they are a deployment choice, not recipe content). Builtin slots cannot be overridden; builtin `Idle` / `Walk` clips only with `override: true`.
- **Hides as data:** `body:<region>` (only body triangles the garment really covers, in that region: `pelvis torso neck thigh_L/R shin_L/R foot_L/R upperarm_L/R forearm_L/R hand_L/R covered`), `slot:<slotId>` (drops the painted piece in that slot, e.g. `slot:smallclothes`), `<garmentId>`, `<garmentId>:<segment>`, `horns`, `wings`; `hiddenBy` is the reverse.
- **Autofit:** garments are authored on human / neutral (`authoredOn`) and fitted at build time to every race, body type and body slider: joint retarget, tight vertices snapped to the body at their authored offset, loose parts (flares, hems) carried by harmonic interpolation, a gap guard, skin weights from the body under each vertex, and covered body triangles hidden. `body.info.kit` reports per garment `{ id, layer, anchors, minGapMm, maxGapMm, guardMaxMm, bodyTrisHidden, fitMs, coverMs }`. The fit runs once per build on the main thread (not sliced): about 50-200 ms per garment (Node, this box); bodies of the same race / body type / garment are not cached yet.
- **Known limits (2.2.0 autofit):** rest pose: no garment inside the body on any race / body type / slider extreme tested (one 0.9 mm exception, see the Blitzball audit). In animation the fitted garment follows the body's own skinning (no cloth simulation), so deep flexion creases (Tread's knee / hip flex, Swim's chest stretch) push a few mm of garment under the skin, as they do on Blitzball's own authored swimmer. There is no child body in v2 (the smallest bodies are the small races and the body sliders at -1).
- **Tint:** `dye` kind `tint` multiplies the texture by the colour where the mask is white (`diffuse = mix(tex, tex × tint, mask.r)`); without a mask the whole garment is tinted. Changing a tint is a painted change (uniform only).
- **Races (minimal):** `races.<id> = { base, label, tones, defaults, playable, heightScale }` registers an alias of a builtin cf-humanoid-29 race (same body; tone subset by index; default features). Aliases appear in `CF.races()` / `options` and builtin garment availability follows the base race; they are never picked by seeded generation. Custom race models are not supported in cf-kit/1.
- **Clips:** `clips.<Name> = { file | tracks, loop, license }` in CF clip JSON (`{ name, duration, tracks: [{ name, type, times, values }] }`, quaternion tracks as-is, `Root` / `Trans` position tracks relative to the race rest pose and scaled per race). Licensed (KI) content is refused in kits.
- **Recipes:** stay `v: 2`. A recipe that uses kit content carries `kits: [{ namespace, version }]` (written only when non-empty, derived on `normalize` from the namespaced race / garments / dyes it uses). Building or `setRecipe` with a kit that is not loaded throws `CF_KIT_MISSING` (`err.code`, `err.errors[{path,msg,code}]`; `normalize` / `validateRecipe` report the same as errors with `code`); a loaded kit with a different major version gives the warning `CF_KIT_VERSION`.

## Pixel lighting (2.3.1)
`CF.setLighting({ mode: 'tb' })` (alias `'pixel'`) gives the whole body the Trailbound dithered pixel lighting: skin, hair and parts on the clothing texel grid, and shells and kit garments on their UV atlas. `'flat'` shows albedo only, and `'current'` (the default) is unchanged.

## Wardrobe sets and per-app access (2.3.0)
Every garment has **tags** `{ sets: string[], slot, style: string[] }`. Builtin garments get theirs from `wardrobe_tags.json` (made from Character Forge's `wardrobe_sets.json`). Kit garments use the manifest's `garments[].tags`. Set labels come from the manifest's top-level `sets`. A garment can be in several sets, and sets never limit mix and match: any allowed garment combines with any other.

| Set | Label | Builtin + kit garments |
|---|---|---|
| `blitzball/swimwear` | Swimwear | 4 (kit `blitzball` 1.1.0: onepiece, trunks, boardshorts, boardshorts_asym) |
| `trailbound/basics` | Basics | 6 |
| `trailbound/homestead` | Homestead | 9 |
| `trailbound/western` | Western | 8 |
| `trailbound/adventurer` | Adventurer | 9 |
| `trailbound/armor` | Armor | 3 (light: baldric, bracers, gloves; plate not built yet) |

- `CF.sets({ race?, all? })` returns `[{ id, label, note, kit, count, garments, allowed }]` in display order. It lists only sets that have an accessible garment; `all: true` also lists empty or denied ones.
- `CF.garmentTags(id)`, `CF.garmentAllowed(id)`, `CF.kitAllowed(namespace)`. `catalog().garments[*].tags` and `options().slots[*].garments[*].tags` are filled in.
- **Access** is an allowlist. The default (`null`) allows everything the app loads, and 2.2.1 behaviour is unchanged: same goldens, 0 px parity.
  - Set it with `CF.init({ access })`, `CF.init({ accessUrl })`, `CF.setAccess(obj | null)` or `await CF.loadAccess(url | obj)`. Read it back with `CF.getAccess()`.
  - Format `cf-access/1`: `{ "format": "cf-access/1", "app": "trailbound", "sets": ["trailbound/*"], "kits": [], "untagged": true }`.
  - Patterns are `'*'`, an exact set id, or `'<ns>/*'`.
  - `sets: null` means any set. `kits: null` means any loaded kit; `[]` means no kits.
  - `untagged` (default true) allows garments with no tags.
- **What access does:**
  - Denied garments disappear from `catalog()`, `options()`, `sets()` and `randomRecipe` / `generate` picks. With access set, the seeded stream can differ; with the default, it is identical.
  - `equip` of a denied garment throws `CF_ACCESS_DENIED`.
  - `loadKit` of a denied kit namespace throws `CF_ACCESS_DENIED`.
  - `normalize` / `validateRecipe` / `build` drop a denied garment from a recipe with a `CF_ACCESS_DENIED` warning, so a shared recipe still builds.
- Examples:
  - Trailbound: `CF.init({ THREE, baseUrl, access: { app: 'trailbound', sets: ['trailbound/*'], kits: [] } })`.
  - Blitzball: `{ app: 'blitzball', sets: ['blitzball/swimwear'], kits: ['blitzball'] }`.
  - Character Forge (the editor): no access, so everything is available.

## Private animation pack (Kevin Iglesias, licensed: never in the public bundle)
The KI clips are licensed content: they are **not** in `dist/`, `assets.json`, `bundle.json` or the licence manifest's file list. The game serves the pack privately (`ki_manifest.json` + `KI_HumanM_anims.glb` + `KI_HumanF_anims.glb`, format `cf-anim-pack/1`) and registers it:
```js
await CF.init({ THREE, baseUrl: '/cf/2.2.0/', privateAnimBaseUrl: '/private/ki/', animationSet: 'cf+ki' });   // register + switch policy in one call
// or a loader (auth headers, asset bundles, Electron fs ...): name is 'ki_manifest.json' or a file the manifest lists
CF.registerAnimSet('ki', async (name, { signal }) => fetch('/private/ki/' + name, { credentials: 'include', signal }));   // may return Response | ArrayBuffer | Uint8Array
CF.setPolicy({ animationSet: 'cf+ki' });   // or 'cf+cc0+ki' (needed after registerAnimSet unless init got animationSet)
const b = await CF.build(recipe); b.play('KI_Cheer');
CF.animSets();   // { ki: { registered, loaded, clips } }
```
- **Registering a pack does not switch the policy.** `privateAnimBaseUrl` / `registerAnimSet` only make the pack available; KI clips appear once `policy.animationSet` is `'cf+ki'` or `'cf+cc0+ki'` (init option `animationSet`, `policy.animationSet`, or `CF.setPolicy`). `init` returns `notes[]` when a pack is registered but the policy leaves it off.
- `registerAnimSet(name: 'ki', urlOrLoader)`: a string is the pack folder URL (or the manifest URL); files are fetched from it with `init({fetch})` / global fetch. The manifest's `sha256` is checked when `crypto.subtle` exists.
- Building with a `+ki` policy and no registered pack throws `CF_ANIMSET_MISSING`.
- Known issue (from the KI retarget checks): long hair is rigid on Head, so `long_straight` sinks into the shoulders in KI clips (built-in clips are fine).

## Body frames (2.4.0)
- Recipe `body.mu` (Build, skinny .. bulky) and `body.fat` (Weight, lean .. heavy); optional, absent = 0 (old body, same hash). `CF.normalize` clamps them to the race range and warns; zero values are dropped from the recipe.
- `CF.options(race).frame` = `{ mu: [min, max], fat: [min, max], h: [min, max] }`. Ranges: human mu -1..1.5 fat -1..1.5; elves mu -1..1 (great elf 1.2) fat -1..0.8; halfling mu -0.8..1 fat -0.8..3.2 h -1..0.6; gnome mu -0.8..1 fat -0.8..1.8 h -1..0.6; dwarf mu -0.5..2 fat -0.6..2 h -0.8..0.6; goliath mu -0.6..2 fat -0.6..1.6; firbolg mu -0.6..2 fat -0.6..2; orc mu -1..2 fat -0.8..1.6; goblin mu -1..1 fat -0.8..1.5; tiefling / dragonborn mu -1..1.8 fat -0.8..1.4; kobold / mousefolk / imp / pixie mu -0.8..0.8 fat -0.8..1.2. The h range is advisory (the UI uses it); `body.h` itself still accepts -1..1 on every race.
- A frame change rebuilds the body (like h / b / s); kit garments are re-fitted with the body's frame deltas transferred first.

