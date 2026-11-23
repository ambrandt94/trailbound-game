/**
 * World Gen's chunk inspector image: a generated chunk map squeezed into
 * small rasters (biomes with roads and hillshade, and hypsometric height),
 * plus its towns for labels. Pure data, so the worker builds it next to the
 * generator and only a few MB cross to the main thread.
 */
import { Biome, type NodeKind, type WorldData } from '../world/models';
import { biomeRgb } from './atlas';
import { hypsoRgb } from './world-bake';

export interface ChunkRasterNode {
  name: string;
  kind: NodeKind;
  /** Position in raster pixels. */
  x: number;
  y: number;
}

export interface ChunkRaster {
  /** Raster side in pixels. */
  size: number;
  /** The map's side in tiles (the raster's source). */
  tiles: number;
  biome: Uint8ClampedArray;
  height: Uint8ClampedArray;
  /** Biome id per raster pixel (for the biome overlay and legend focus). */
  ids: Uint8Array;
  nodes: ChunkRasterNode[];
  /** Land share of the generated map, 0..1. */
  land: number;
  minM: number;
  maxM: number;
  /** Biome → share of land tiles, largest first (top 4). */
  biomes: Array<{ biome: Biome; share: number }>;
}

/** Ground a chunk spans, metres (a 16× map: 3072 tiles of 8 m). */
const CHUNK_GROUND_M = 3072 * 8;

const ROAD: readonly [number, number, number] = [196, 150, 96];

/** Rasterise a generated map at up to `maxSize` px a side (nearest tile, max-pooled roads). */
export function chunkRaster(world: WorldData, maxSize: number): ChunkRaster {
  const tiles = world.width;
  const size = Math.max(1, Math.min(tiles, Math.floor(maxSize)));
  const step = tiles / size;
  const biome = new Uint8ClampedArray(size * size * 4);
  const height = new Uint8ClampedArray(size * size * 4);
  const ids = new Uint8Array(size * size);
  // Real ground per raster pixel: a chunk is the same patch of planet at any
  // map scale (16× maps have 8 m tiles), so small maps don't shade 16× too steep.
  const cellM = (CHUNK_GROUND_M / tiles) * step;
  const hAt = (x: number, y: number) => {
    const tx = Math.min(tiles - 1, Math.max(0, Math.floor((x + 0.5) * step)));
    const ty = Math.min(tiles - 1, Math.max(0, Math.floor((y + 0.5) * step)));
    return world.heightM[ty * tiles + tx]!;
  };
  for (let y = 0; y < size; y++) {
    const ty = Math.min(tiles - 1, Math.floor((y + 0.5) * step));
    for (let x = 0; x < size; x++) {
      const tx = Math.min(tiles - 1, Math.floor((x + 0.5) * step));
      const t = ty * tiles + tx;
      const e = world.heightM[t]!;
      const b = world.biomes[t]!;
      let road = false;
      if (b !== Biome.Water) {
        // Any road tile inside this pixel's footprint keeps the road visible when shrunk.
        const span = Math.max(1, Math.round(step));
        const x0 = Math.floor(x * step);
        const y0 = Math.floor(y * step);
        for (let j = 0; j < span && !road; j++) {
          const row = Math.min(tiles - 1, y0 + j) * tiles;
          for (let i = 0; i < span; i++) {
            if (world.paths[row + Math.min(tiles - 1, x0 + i)]) {
              road = true;
              break;
            }
          }
        }
      }
      let shade = 1;
      if (e > 0) {
        const gx = (Math.max(0, hAt(x + 1, y)) - Math.max(0, hAt(x - 1, y))) / (2 * cellM);
        const gy = (Math.max(0, hAt(x, y + 1)) - Math.max(0, hAt(x, y - 1))) / (2 * cellM);
        shade = Math.max(0.6, Math.min(1.3, 1 - (gx + gy) * 2));
      }
      const col = road ? ROAD : biomeRgb(b, b === Biome.Water ? Math.min(-1, e) : Math.max(1, e));
      const hyp = hypsoRgb(b === Biome.Water ? Math.min(-1, e) : Math.max(1, e));
      ids[y * size + x] = b;
      const o = (y * size + x) * 4;
      biome[o] = col[0] * shade;
      biome[o + 1] = col[1] * shade;
      biome[o + 2] = col[2] * shade;
      biome[o + 3] = 255;
      height[o] = road ? ROAD[0] : hyp[0] * shade;
      height[o + 1] = road ? ROAD[1] : hyp[1] * shade;
      height[o + 2] = road ? ROAD[2] : hyp[2] * shade;
      height[o + 3] = 255;
    }
  }
  const counts = new Map<Biome, number>();
  let land = 0;
  let minM = Infinity;
  let maxM = -Infinity;
  for (let i = 0; i < world.biomes.length; i++) {
    const b = world.biomes[i]! as Biome;
    const e = world.heightM[i]!;
    if (e < minM) minM = e;
    if (e > maxM) maxM = e;
    if (b === Biome.Water) continue;
    land++;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const biomes = [...counts.entries()]
    .map(([b, c]) => ({ biome: b, share: land > 0 ? c / land : 0 }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 4);
  const nodes = world.nodes
    .filter((n) => n.kind === 'city' || n.kind === 'town' || n.kind === 'village')
    .map((n) => ({ name: n.name, kind: n.kind, x: n.cx / step, y: n.cy / step }));
  return {
    size,
    tiles,
    biome,
    height,
    ids,
    nodes,
    land: land / Math.max(1, world.biomes.length),
    minM,
    maxM,
    biomes,
  };
}
