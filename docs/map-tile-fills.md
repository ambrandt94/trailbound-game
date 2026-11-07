# Pixel Kingdom map tiles

The default world map draws `public/assets/map/classic/tilesets/grasslands.png` the way [trailbound-world-map](https://github.com/ambrandt94/trailbound-world-map) does. Each cell is a 16 px pack tile. The camera scales it with nearest-neighbour only. No noise mask, no dither, and no new texture is generated for this skin.

Autotile selection is `blobLocal` on the pack's 3×3 blob, then `tileSrc(group, season, lx, ly)`. Grass under every land biome is the plateau interior of that biome's season. An overlay group, when the original has one, is stamped on top with the same blob. Trees, rocks, and mountain rocks are the same feature scatter as the original (`summer-*`, `forest-*`, `winter-*`, `autumn-*`, `rock-1`, `rock-3`, `rock-4`, `rock-snow`).

The pack has no separate sheet for snow, taiga, marsh, desert, jungle, heath, or ashlands. Those biomes use a seasonal row that is already in the pack (the pack's own recolor), which is what the original map does. Crops below are the interior cell, scaled 4×. "Before" is the summer cell. "After" is the seasonal cell that is actually drawn.

Trailbound 48 stays on the map menu as a non-default skin. It is not this path.

## Filled from pack rows

### Snow

No snow sheet. Winter grass under the winter rock blob.

![Summer grass](map-fills/summer-grass.png)
![Winter grass](map-fills/winter-grass.png)

![Summer rock](map-fills/summer-rock.png)
![Winter rock](map-fills/winter-rock.png)

### Taiga

No taiga sheet. Winter grass under the winter forest blob.

![Summer forest](map-fills/summer-forest.png)
![Winter forest](map-fills/winter-forest.png)

### Marsh

No marsh autotile. Lush grass, plus the pack's lily deco on the same scatter as the original. Overlay group is none.

![Summer grass](map-fills/summer-grass.png)
![Lush grass](map-fills/lush-grass.png)

### Desert, heath, and ashlands

No desert or ash sheet. Autumn grass under the autumn path blob (the pack's sand-colored path). Sand itself stays on the summer path row.

![Summer path](map-fills/summer-path.png)
![Autumn path](map-fills/autumn-path.png)

### Jungle and dark forest

No jungle sheet. Lush grass under the lush forest blob. Dark forest uses that same lush forest row.

![Summer forest](map-fills/summer-forest.png)
![Lush forest](map-fills/lush-forest.png)

### Mountain

Autumn grass under the autumn rock blob. Close zoom scatters `rock-1`, `rock-3`, and `rock-4` the same way the original does.

![Summer rock](map-fills/summer-rock.png)
![Autumn rock](map-fills/autumn-rock.png)

## Unchanged pack pairs

These already have a summer cell and are not recolored.

- Water: summer plateau grass, then the summer water blob.
- Sand: summer plateau grass, then the summer path blob.
- Plains and meadow: summer plateau grass. Meadow also stamps the pack flower and leaf decos.
- Forest: summer plateau grass, then the summer forest blob.
- Hills: autumn plateau grass, then the autumn plateau blob (the pack's cliff edges).

![Summer water](map-fills/summer-water.png)
