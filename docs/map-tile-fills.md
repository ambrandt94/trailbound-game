# Derived map tiles

Authored art stays in `public/assets/map/trailbound48/`. Nothing here is painted back into `atlas_terrain.png`. Missing transitions are built at runtime into a separate canvas cache.

A fill copies the two ground tiles. The foreground is mirrored across the shared edge (so the outer pixel continues the neighbour) and chosen with a 4×4 Bayer dither. There is no channel blend and no flat rim colour. A near-black sample is replaced with that tile’s own average non-black colour.

Rivers are the Marsh biome. Coasts are land (usually Sand) onto Water. Roads use the dirt-edge sheet; the two straight masks that sheet does not contain are joins of the authored caps.

## Authored pairs

- Plains onto Sand: Authored sheet at atlas 60 for the 12 corner masks. Masks 5, 10 and 15 are not on that sheet; those use the same dither, still from the two ground tiles.
- Plains onto Marsh: Authored sheet at atlas 72 for the 12 corner masks. Masks 5, 10 and 15 are not on that sheet; those use the same dither, still from the two ground tiles.
- Meadow onto Sand: Authored sheet at atlas 60 for the 12 corner masks. Masks 5, 10 and 15 are not on that sheet; those use the same dither, still from the two ground tiles.
- Meadow onto Marsh: Authored sheet at atlas 72 for the 12 corner masks. Masks 5, 10 and 15 are not on that sheet; those use the same dither, still from the two ground tiles.
- Hills onto Marsh: Authored sheet at atlas 72 for the 12 corner masks. Masks 5, 10 and 15 are not on that sheet; those use the same dither, still from the two ground tiles.
- Snow onto Mountain: Authored sheet at atlas 84 for the 12 corner masks. Masks 5, 10 and 15 are not on that sheet; those use the same dither, still from the two ground tiles.

## Filled pairs

No authored edge. The background tile keeps its ground, and the foreground ground is mirrored across the shared edge with a 4×4 Bayer dither. Colours are copied from those two tiles.

- Sand onto Water
- Plains onto Water
- Plains onto Heath
- Plains onto Mountain
- Plains onto Desert
- Plains onto Ashlands
- Meadow onto Water
- Meadow onto Plains
- Meadow onto Heath
- Meadow onto Mountain
- Meadow onto Desert
- Meadow onto Ashlands
- Forest onto Water
- Forest onto Sand
- Forest onto Plains
- Forest onto Meadow
- Forest onto Hills
- Forest onto Heath
- Forest onto Marsh
- Forest onto Mountain
- Forest onto Desert
- Forest onto Ashlands
- DarkForest onto Water
- DarkForest onto Sand
- DarkForest onto Plains
- DarkForest onto Meadow
- DarkForest onto Forest
- DarkForest onto Hills
- DarkForest onto Heath
- DarkForest onto Marsh
- DarkForest onto Mountain
- DarkForest onto Taiga
- DarkForest onto Desert
- DarkForest onto Ashlands
- Hills onto Water
- Hills onto Sand
- Hills onto Plains
- Hills onto Meadow
- Hills onto Heath
- Hills onto Mountain
- Hills onto Desert
- Hills onto Ashlands
- Heath onto Water
- Heath onto Sand
- Heath onto Marsh
- Heath onto Desert
- Heath onto Ashlands
- Marsh onto Water
- Marsh onto Sand
- Mountain onto Water
- Mountain onto Sand
- Mountain onto Heath
- Mountain onto Marsh
- Mountain onto Desert
- Mountain onto Ashlands
- Snow onto Water
- Snow onto Sand
- Snow onto Plains
- Snow onto Meadow
- Snow onto Forest
- Snow onto DarkForest
- Snow onto Hills
- Snow onto Heath
- Snow onto Marsh
- Snow onto Taiga
- Snow onto Desert
- Snow onto Jungle
- Snow onto Ashlands
- Taiga onto Water
- Taiga onto Sand
- Taiga onto Plains
- Taiga onto Meadow
- Taiga onto Forest
- Taiga onto Hills
- Taiga onto Heath
- Taiga onto Marsh
- Taiga onto Mountain
- Taiga onto Desert
- Taiga onto Ashlands
- Desert onto Water
- Desert onto Sand
- Desert onto Marsh
- Jungle onto Water
- Jungle onto Sand
- Jungle onto Plains
- Jungle onto Meadow
- Jungle onto Forest
- Jungle onto DarkForest
- Jungle onto Hills
- Jungle onto Heath
- Jungle onto Marsh
- Jungle onto Mountain
- Jungle onto Taiga
- Jungle onto Desert
- Jungle onto Ashlands
- Ashlands onto Water
- Ashlands onto Sand
- Ashlands onto Marsh
- Ashlands onto Desert

## Autotile masks

- Edges, outer corners, inner corners and T-junctions are the 12 corner masks on `EDGE_INDEX`. An authored pair uses that sheet.
- Mask 0 is empty and mask 15 is a solid ring. Opposite-corner masks 5 and 10 are not on the sheet. Those three, and every pair with no sheet, use the dither fill.
- An isolated foreground tile stays the authored ground. The surrounding background tiles carry the fringe, so the seam is the same pixel on both sides.

## Roads

- Caps, corners, T-junctions, the isolated tile and the crossing are authored (`DIRT_EDGE_BASE` and the sandstone road).
- Mask 5 (east-west) and mask 10 (north-south) have no cell. Each is the west/north cap joined to the east/south cap, with a Bayer dither on the four-pixel join.

## Chunk edges

Region paints and chunk bakes read neighbour biomes and roads from the world, including the tile just outside the canvas, so two chunks agree on the shared edge.
