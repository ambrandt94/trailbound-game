# Character Forge runtime 2.1.1 (api 2)

```js
import * as THREE from 'three';                       // peer dependency, >=0.187 <0.190 (tested 0.187.0)
import CF from './character-forge/2.1.1/cf-runtime.mjs';
await CF.init({ THREE, baseUrl: '/character-forge/2.1.1/' });   // optional: fetch, createCanvas|canvasFactory, decodeImage, policy, bundle (CF_API_MISMATCH check), privateAnimBaseUrl, animationSet, platform
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
- Clips: `Idle`, `Walk` always (CF-authored); pixie/imp also `Hover`, `FlyMove` (wing flap baked as tracks). With `policy.animationSet: 'cf+cc0'`: `Run Attack1H Magic PickUp Cheer` (Quaternius, CC0).
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
`{ animationSet: 'cf', migration: 'regenerate', missingRaces: {elf:'wood_elf', djinn:'human', elder:'human', thug:'human'}, tieflingPlayable: true, regalia: 'kits', regaliaMinRichness: .85, adoption: 'runtime-first', wingsUnderCloak: 'show' }`

## Migration from 1.2.x
`CF.migrate(v1)` → `{recipe, lossy: true, notes[]}`: race (renamed / mapped), gender→bodyType, nearest skin tone, nearest hair colour, eye colour if in the v2 iris set, seed and style carried; hair style, face, sliders (24→3) and outfit (69 garments → v2 kit by style) are regenerated from the seed. `migrate(v2)` is identity (`lossy:false`).

## Private animation pack (Kevin Iglesias, licensed: never in the public bundle)
The KI clips are licensed content: they are **not** in `dist/`, `assets.json`, `bundle.json` or the licence manifest's file list. The game serves the pack privately (`ki_manifest.json` + `KI_HumanM_anims.glb` + `KI_HumanF_anims.glb`, format `cf-anim-pack/1`) and registers it:
```js
await CF.init({ THREE, baseUrl: '/cf/2.1.1/', privateAnimBaseUrl: '/private/ki/', animationSet: 'cf+ki' });   // register + switch policy in one call
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
