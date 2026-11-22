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
