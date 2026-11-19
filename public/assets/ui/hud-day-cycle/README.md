# Day-cycle HUD sprites (placeholders)

Placeholder pixel art for the 100-TU serpentine day-cycle HUD. Everything is drawn at its native size (1x) onto a small canvas, then scaled up by a whole number in the browser with `image-rendering: pixelated`. Design at 1x. Do not anti-alias, do not use fractional alpha on edges (the fog and pulse sprites are the only translucent ones).

## How to swap art

1. Draw a PNG for a slot below, at the size in the table.
2. Drop it over the file with the same name in this folder.
3. If the size or anchor changed, edit that slot in `manifest.json` (`w`, `h` are one frame; `anchor` is the pixel inside one frame that sits on the bead or point it marks).
4. Run `npm run dev` and look. `npm test` checks every file exists and matches the manifest size.

**Art template.** To restyle everything in one go, use the sheet in `template/` (it has a reference sample of the assembled HUD on top and one spaced cell per font glyph; a second sheet, `template/hud-day-cycle-template-biomes-512.png`, holds the biome ground masks and detail overlays, with sunrise previews of eight biomes): edit `template/hud-day-cycle-template-512.png`, then run `node tools/hud-day-cycle-slice.mjs <edited.png>` to write the PNGs back here. See `template/README.md`.

Do not rerun `tools/hud-day-cycle-sprites.mjs` after swapping: it redraws the placeholders over your PNGs. It never overwrites `manifest.json` unless you pass `--manifest`.

Multi-state sprites are one PNG, frames side by side, left to right, in the order of `states` in the manifest. PNG width = `w` x number of states.

## Tinting

Slots marked **tint** are coloured by the renderer: neutral gray pixels (R = G = B) are multiplied by the phase colour of that bead, pure white (`#ffffff`) is a specular pixel that stays near white, and every other pixel is drawn as it is. So draw frames and outlines in colour and the part that should change colour in gray.

## Slots

| File                     | Size (per frame) | Anchor | States       | What it is                                                                                                                                                                                                   |
| ------------------------ | ---------------- | ------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node_socket_empty.png`  | 5x5              | 2,2    | default      | Recessed bezel under every bead. Shows once a TU has drained.                                                                                                                                                |
| `node_gem_lit.png`       | 5x5              | 2,2    | default      | **tint.** Lit bead, drawn over the socket. Top-left white pixel is the specular.                                                                                                                             |
| `node_leading_pulse.png` | 7x7              | 3,3    | f0, f1, f2   | Highlight ring over the active bead. Loops at 7 fps.                                                                                                                                                         |
| `spine_link.png`         | 5x5              | 2,2    | default      | Chain link stamped 5 times between beads.                                                                                                                                                                    |
| `fog_shroud.png`         | 7x7              | 3,3    | default      | Translucent mist over a bead when pre-dawn fog is on.                                                                                                                                                        |
| `anchor_left_moon.png`   | 13x13            | 6,6    | default      | Left end-cap. 0 TU, the wrap back to 05:00.                                                                                                                                                                  |
| `anchor_right_dawn.png`  | 13x13            | 6,6    | default      | Right end-cap. 100 TU, 05:00, start of day.                                                                                                                                                                  |
| `medallion_sunset.png`   | 11x11            | 5,5    | lit, drained | On the sunset bead (34 TU in summer).                                                                                                                                                                        |
| `medallion_sunrise.png`  | 9x9              | 4,4    | lit, drained | On the sunrise bead (97 TU in summer).                                                                                                                                                                       |
| `sub_node.png`           | 9x9              | 4,4    | lit, drained | **tint.** Solar noon and midnight beads. Lit well is gray.                                                                                                                                                   |
| `sky_sun.png`            | 7x7              | 3,3    | default      | Glides across the sky strip by day.                                                                                                                                                                          |
| `sky_moon.png`           | 7x7              | 3,3    | default      | Glides across the sky strip by night. A lunar phase sheet can replace it: add states and a frame pick in the renderer.                                                                                       |
| `sky_frame.png`          | 8x8, 9-slice 2   | 0,0    | default      | Border around the sky strip. Centre must be transparent.                                                                                                                                                     |
| `terrain_mask.png`       | 36x8, tiles      | 0,0    | default      | **tint.** Hills silhouette along the sky floor. Three 12 px hills in a repeating strip. Gray, tinted by the hour's ground colour.                                                                            |
| `cursor_pill_day.png`    | 9x9, 9-slice 3   | 4,4    | default      | Tooltip box by day (gold). The TU and clock text sit inside.                                                                                                                                                 |
| `cursor_pill_night.png`  | 9x9, 9-slice 3   | 4,4    | default      | Tooltip box by night (violet).                                                                                                                                                                               |
| `cursor_stem_day.png`    | 1x6              | 0,0    | default      | Stem from the pill to the active bead. Stretched vertically.                                                                                                                                                 |
| `cursor_stem_night.png`  | 1x6              | 0,0    | default      | Night stem.                                                                                                                                                                                                  |
| `pixel_font.png`         | glyph cells 3x5  |        |              | Font sheet: white glyphs on transparent, tinted at draw time. Order is `font.glyphs` in the manifest; `font.widths` gives the advance of narrow glyphs (`:` `.` space). Digits, A to Z, `- . / :` and space. |

The 100 beads sit on a wave of 2.5 cycles (11 px high), 3.2 px apart, so bead sprites overlap a little on purpose: they read as one chain. Keep bead sprites to 5x5.

## Biome sky (layered ground)

The sky strip changes with the biome under the caravan (map) or the area you stand in (3D). Terrain is drawn back to front:

1. Sky gradient, stars, sun and moon (unchanged).
2. One **base** ground mask: a tileable gray silhouette, tinted by the hour.
3. Zero or more **detail** overlays (trees, rocks, snowcaps, cactus, reeds, waves), tinted per layer.

Each biome is a recipe in `src/ui/day-cycle/biome-recipes.ts`: `{base, details[], tints}`. Every biome id the game has (and the reserved names) maps to a recipe, and masks are reused across recipes. An unknown biome, or no biome data, uses the original hills strip (`terrain_mask`, tinted with the sky ground colour, so it looks exactly as before). If an art file for a recipe is missing, the strip falls back to that default. When the biome changes, the strip crossfades for about 1 s (instant with reduced motion).

Tint kinds: `ground`, `detail`, `water` (blue-green, flat) and `accent` (snow white). Tints are multiplied by the time-of-day light (`groundLight` in `src/core/sim/day-cycle.ts`), so a recipe reads at dawn, noon, dusk and night. The usual tint rule applies: gray is multiplied, pure white stays near white, any other colour is drawn as-is.

| File                   | Size (per frame) | Anchor | What it is                                                                           |
| ---------------------- | ---------------- | ------ | ------------------------------------------------------------------------------------ |
| `ground_flat.png`      | 36x8, tiles      | 0,0    | **tint.** Base: flatlands, very low rolling edge.                                    |
| `ground_grass.png`     | 36x8, tiles      | 0,0    | **tint.** Base: rolling grass mounds.                                                |
| `ground_mountains.png` | 36x11, tiles     | 0,0    | **tint.** Base: jagged peaks. Taller than the sky strip, so peaks rise into the sky. |
| `ground_coast.png`     | 36x8, tiles      | 0,0    | **tint.** Base: a land edge plus a water band.                                       |
| `ground_dunes.png`     | 36x8, tiles      | 0,0    | **tint.** Base: smooth desert dunes.                                                 |
| `detail_pine.png`      | 36x12, tiles     | 0,0    | **tint.** Detail: conifers. Pine, taiga, dark forest.                                |
| `detail_broadleaf.png` | 36x11, tiles     | 0,0    | **tint.** Detail: round-crowned trees. Forest, jungle, dark forest.                  |
| `detail_scrub.png`     | 36x5, tiles      | 0,0    | **tint.** Detail: bushes and tufts. Plains, meadow, hills.                           |
| `detail_rocks.png`     | 36x5, tiles      | 0,0    | **tint.** Detail: boulders. Mountains, badlands, ashlands.                           |
| `detail_snowcaps.png`  | 36x11, tiles     | 0,0    | **tint.** Detail: caps that line up with `ground_mountains`' peaks. White = snow.    |
| `detail_cactus.png`    | 36x8, tiles      | 0,0    | **tint.** Detail: cacti. Desert.                                                     |
| `detail_reeds.png`     | 36x7, tiles      | 0,0    | **tint.** Detail: reeds. Marsh, jungle.                                              |
| `detail_water.png`     | 36x5, tiles      | 0,0    | **tint.** Detail drawn behind the base: a water band. Marsh.                         |
| `detail_waves.png`     | 36x5, tiles      | 0,0    | **tint.** Detail: wave crests and foam (white = foam). Sea, coast.                   |

These 14 strips are on the second template sheet (`template/hud-day-cycle-template-biomes-512.png`) and carry `"sheet": "biomes"` in `manifest.json`.

Preview a biome in the running game: `__tbDayCycle.forceBiome('Forest')` in the console (`null` returns to the real one). Names are the ones in `BIOME_ID_NAMES` (Forest, Mountain, Snow, Sand, Desert, Plains, Taiga, Marsh, Jungle, ...).

## Colours

The placeholders use the blueprint palette: outline `#1c1610`, frame dark/mid/light `#6e4e24 #b58938 #f3cf7a`, well `#0c0e16`, empty socket `#3b4568` with a plum outline `#54425e`. Phase colours for the beads are set in code (`src/core/sim/day-cycle.ts`), not in the art. No large black fills: keep outlines tinted.
