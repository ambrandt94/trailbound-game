# World gen: the Trailbound world, planet chunks, and the World Gen screen

Plan approved by Alex on Nov 22, 2026, and built in four PRs:

- **WG1** the default world from the reference map's shape
- **WG2** the home chunk sampled from the planet
- **WG3** the World Gen screen
- **WG4** smooth Globe ↔ World map ↔ Chunk transitions

## WG1: the Trailbound world (`src/core/planet/trailbound-layer.ts`)

### Source and derived asset

- Alex's reference world map supplies the **shape only**. Its colours and biome placement are ignored.
- The original image is not in the repo. Only the derived masks are committed:
  - `src/core/planet/data/trailbound-land.json`: 1024×474, 21 KB, 7.7 KB gzipped.
  - `src/core/planet/data/trailbound-ice.json`: 6 KB.
- Format: row run-lengths starting with water. `decodeRle` and `encodeRle` live in `mask.ts`. JSON was chosen over PNG so core code, the worker and node tests read the same data with no DOM.
- How the masks were derived:
  - Land was thresholded from the reference.
  - River lines were closed with a 3 px disc; only pixels within 3 px of land are filled, so straits stay open.
  - Water specks under 40 px were filled.
  - The scale bar was removed.
  - The result was box-downsampled to 1024 wide.
  - The ice mask keeps only polar components.

### Projection

- The mask is equirectangular over the full turn: `lon = atan2(x, z)`, the same as `sphereToLatLon`. Its centre column is the centre of cube face 0.
- The source is 1920×888 (2.16:1). It is read as a **2:1 map cropped at ±83.25°**, which is why its polar ice caps are cut off at the top and bottom edges.
- Rows map linearly onto ±83.25°. Everything poleward is ice.
- The mask's east and west columns are both ocean, so there is no seam.

### Field

- **Coast.** The coast is a signed distance to the mask's coastline, in mask pixels (1 px ≈ 0.35°, ≈ 1/13 of a chunk at 20 per face). It is read through a small seeded 3D domain warp, with two fbm octaves added near the coast.
  - `landValue(v, fine)` adds two more octaves below one mask pixel, for chunk-scale sampling.
- **Relief and climate** come from our own noise:
  - inland plateau and hills
  - ridged mountain belts gated by a low-frequency "range" field
  - latitude temperature with altitude lapse
  - moisture belts
  - `classify`, shared with `PlanetLayer`
- **Sea level.** `TRAILBOUND_SEA_LEVEL = 0` makes **34.2% of the flat map land, the same as the reference's pixels**. By area on the sphere that is ~39.6%, because the land sits nearer the equator than the poles and an equirect map under-weights the equator.
  - Pushing the default down to 34% by area would erode the reference's small islands, so the WG3 sea-level slider covers that instead.
- **Seed.** The seed moves coasts by a few pixels; under 6% of sample points change between seeds. The continents stay put.

### Start chunk (`start-pick.ts`)

`rankStartChunks(field)` scores every chunk from a 4×4 sample. The score rewards:

- the chunk's own land share (best near 80%)
- its 8 neighbours' land share, so the start is inside a landmass rather than on an island edge
- a temperate latitude (35° ± 14°, with north preferred)
- at least 2 chunks from a cube-face edge
- little snow or taiga

It takes ~150 ms for 2,400 chunks. Seed 7741's start is face 1 (5,3), at about 28°N.

### Plumbing

- **World sources** are `trailbound`, `procedural` and `island` (`presets.ts`).
- `makePlanetField(spec)` builds the planet for a source. `PlanetField` is the shared contract used by the globe bake and, from WG2, the chunk generator.
- **Globe preview.** In WG1 the game's home map is unchanged. `?world=trailbound` or `?world=procedural` previews that planet on the map's globe, with no home patch and the pin on the picked start chunk.
- **Timings** (box, software GL):
  - Bake: island 4.7 s, procedural 5.1 s, Trailbound 7.0 s (standard), 1.8 s (tiny).
  - The bake runs in the worker; the globe build is 7–19 ms on the main thread.
  - Globe frames: 16.2–16.6 ms average.

## WG2: the home map is a chunk of the planet (`src/core/world/planet-chunk.ts`)

`WorldSettings.worldSource` picks the world: `'trailbound'` (default for new games), `'procedural'`, or `'island'` (the classic generator).

### Saves

- **Old saves keep their island.** A save with no `worldSource` reads as `'island'` (in `clampSettings` and `savedWorldSettings`); nothing is migrated. `tests/core/world-source.test.ts` regenerates six old-save worlds (including seed 7741 at 16x) and checks biomes, heights, roads, nodes and features hash to the values recorded on main before this change.
- **Planet worlds** store the source plus the resolved `homeChunk`, so a load regenerates the same chunk even if the start-pick scorer changes later.
- A hand-set `homeChunk` that is under 20% land falls back to the auto pick, so a world never starts at sea.

### Generation

`generateWorld` branches to `generatePlanetChunk` for non-island sources:

1. **Frame.** `planetFrame(seed, settings)` builds the planet field (Trailbound or procedural), at 20 chunks per face for the standard preset, and resolves the home chunk.
2. **Land.** `planetLandSampler` samples the field's land value on a grid over the chunk and maps it so the generator's coast threshold (`landCut('continent')`) sits exactly on the planet's coast. This fixes the old mismatch, where the mockup showed 85% land against the generator's 58%. A home chunk now matches the planet's land share within a few percent (seed 7741: 0.80–0.84 on the map against 0.84 on the planet).
3. **No island scaffolding.** Planet chunks skip the ocean margin, the sea ring and the forced main range. Coasts run off the map edges because the continent goes on.
4. **Climate.** Latitude comes from the chunk's real place on the planet (`planetLatAt`) instead of a pole-to-pole strip. A temperate start has no snow band along its north edge.
5. **Towns.** Sites are restricted to the largest landmass in the chunk, so Ashfen and the authored towns stay connected by road.

### No east–west wrap

The classic island wraps east–west; a chunk of a continent doesn't. `WorldData.wraps === false` marks planet chunks. `worldX` and `worldDeltaX` clamp or wrap as needed, and the map camera and renderer stop drawing wrap copies.

Some `wrapX` call sites are left alone (fog, projection, zone history, area windows, hero keep and spawn, and entity formation). They're harmless because positions are clamped. The one visible effect is that an area window right at the east edge can sample a sliver of the west edge.

### Globe

On the world map's globe, a planet world bakes its own source and stamps the home map onto `homeChunk`. Island worlds behave as before: the island sits on face 0, and `?world=` previews still work.

### Sea level

The default stays at `TRAILBOUND_SEA_LEVEL = 0`: 34.2% of the flat map is land, matching the reference. That is ~39.6% by sphere area. Forcing 34% _by area_ would mean raising the sea about 0.06, which drowns most of the small islands and thins the straits in Alex's shape. So the "about 34%" target is met on the map as drawn. The sea-level slider (WG3) moves it either way.
