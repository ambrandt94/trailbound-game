import { BIOME_COUNT, Biome, WORLD_BASE, type WorldFeature } from '../../core/world/models';

/**
 * The 2D map is one Pixel Kingdom tile per cell of the original 192-wide
 * world. A 16× continent (3072 fine tiles) becomes a 16×16 block per cell.
 * The fine grid stays the source for 3D.
 */
export function mapCellStep(width: number): number {
  if (width >= WORLD_BASE && width % WORLD_BASE === 0) return width / WORLD_BASE;
  return 1;
}

export interface CoarseMap {
  width: number;
  height: number;
  step: number;
  biomes: Uint8Array;
  paths: Uint8Array;
  features: WorldFeature[];
}

export interface CoarseSource {
  width: number;
  height: number;
  biomes: Uint8Array;
  paths: Uint8Array;
  seed?: number;
}

/** Majority biome per cell. A road or river that crosses the cell stays a line. */
export function buildCoarseMap(source: CoarseSource, step = mapCellStep(source.width)): CoarseMap {
  const width = Math.max(1, Math.ceil(source.width / step));
  const height = Math.max(1, Math.ceil(source.height / step));
  const biomes = new Uint8Array(width * height);
  const paths = new Uint8Array(width * height);
  const features: WorldFeature[] = [];
  const counts = new Array<number>(BIOME_COUNT).fill(0);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      counts.fill(0);
      const x0 = cx * step;
      const y0 = cy * step;
      const x1 = Math.min(source.width, x0 + step);
      const y1 = Math.min(source.height, y0 + step);
      let waterN = 0;
      let marshN = 0;
      let pathN = 0;
      let landN = 0;
      let wetN = false;
      let wetE = false;
      let wetS = false;
      let wetW = false;
      let pathNorth = false;
      let pathEast = false;
      let pathSouth = false;
      let pathWest = false;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const biome = source.biomes[x + y * source.width] ?? Biome.Plains;
          counts[biome] = (counts[biome] ?? 0) + 1;
          const wet = biome === Biome.Water || biome === Biome.Marsh;
          if (biome === Biome.Water) waterN += 1;
          if (biome === Biome.Marsh) marshN += 1;
          if (wet && y === y0) wetN = true;
          if (wet && y === y1 - 1) wetS = true;
          if (wet && x === x0) wetW = true;
          if (wet && x === x1 - 1) wetE = true;
          if (biome !== Biome.Water) {
            landN += 1;
            if (source.paths[x + y * source.width]) {
              pathN += 1;
              if (y === y0) pathNorth = true;
              if (y === y1 - 1) pathSouth = true;
              if (x === x0) pathWest = true;
              if (x === x1 - 1) pathEast = true;
            }
          }
        }
      }
      const area = Math.max(1, (x1 - x0) * (y1 - y0));
      let best = Biome.Plains;
      let bestN = -1;
      for (let b = 0; b < counts.length; b++) {
        if ((counts[b] ?? 0) > bestN) {
          bestN = counts[b] ?? 0;
          best = b;
        }
      }
      const wetSides = Number(wetN) + Number(wetE) + Number(wetS) + Number(wetW);
      if (waterN / area >= 0.5) best = Biome.Water;
      else if (marshN >= step && wetSides >= 2) best = Biome.Marsh;
      else if (waterN >= step && wetSides >= 2 && waterN / area < 0.5) best = Biome.Water;
      biomes[cx + cy * width] = best;
      const pathSides = Number(pathNorth) + Number(pathEast) + Number(pathSouth) + Number(pathWest);
      const road =
        best !== Biome.Water &&
        (pathSides >= 2 || pathN >= step || (landN > 0 && pathN / landN > 0.08));
      paths[cx + cy * width] = road ? 1 : 0;
      const sprite = natureAt(best, cx, cy, source.seed ?? 1);
      if (sprite) {
        features.push({
          kind: sprite.kind,
          sprite: sprite.sprite,
          x: x0 + step * 0.5,
          y: y0 + step * (sprite.kind === 'tree' ? 0.72 : 0.6),
        });
      }
    }
  }
  return { width, height, step, biomes, paths, features };
}

function hashNoise(x: number, y: number, seed: number): number {
  let h = Math.imul(x + seed, 374761393) + Math.imul(y, 668265263);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** Same scatter thresholds as the original 192-wide map, one roll per cell. */
function natureAt(
  biome: Biome,
  x: number,
  y: number,
  seed: number,
): { kind: WorldFeature['kind']; sprite: string } | null {
  const n = hashNoise(x, y, seed);
  const tree = treeFor(biome, n);
  if (tree && n > tree.threshold) return { kind: 'tree', sprite: tree.sprite };
  if ((biome === Biome.Mountain || biome === Biome.Hills || biome === Biome.Heath) && n > 0.86) {
    return { kind: 'rock', sprite: n > 0.95 ? 'rock-4' : n > 0.9 ? 'rock-3' : 'rock-1' };
  }
  if ((biome === Biome.Snow || biome === Biome.Taiga) && n > 0.86) {
    return { kind: 'rock', sprite: 'rock-snow' };
  }
  if ((biome === Biome.Meadow || biome === Biome.Plains) && n > 0.78 && n < 0.86) {
    return { kind: 'flower', sprite: n > 0.82 ? 'flower-7' : 'flower-1' };
  }
  if ((biome === Biome.Hills || biome === Biome.Heath) && n > 0.78 && n < 0.86) {
    return { kind: 'flower', sprite: 'flower-autumn' };
  }
  if (biome === Biome.Marsh && n > 0.7 && n < 0.84) {
    return { kind: 'flower', sprite: n > 0.78 ? 'reed' : 'mushroom-dark' };
  }
  return null;
}

function treeFor(biome: Biome, n: number): { threshold: number; sprite: string } | null {
  switch (biome) {
    case Biome.DarkForest:
      return {
        threshold: 0.55,
        sprite: ['forest-1', 'forest-2', 'forest-6', 'forest-8'][Math.floor(n * 40) % 4]!,
      };
    case Biome.Forest:
      return {
        threshold: 0.64,
        sprite: ['summer-1', 'summer-3', 'summer-8', 'summer-11'][Math.floor(n * 28) % 4]!,
      };
    case Biome.Taiga:
      return { threshold: 0.6, sprite: n > 0.8 ? 'winter-11' : 'winter-6' };
    case Biome.Hills:
    case Biome.Heath:
      return { threshold: 0.88, sprite: n > 0.94 ? 'autumn-11' : 'autumn-8' };
    case Biome.Meadow:
    case Biome.Plains:
      return {
        threshold: 0.94,
        sprite: ['summer-8', 'summer-10', 'summer-3'][Math.floor(n * 15) % 3]!,
      };
    case Biome.Snow:
      return { threshold: 0.9, sprite: 'winter-2' };
    case Biome.Marsh:
      return { threshold: 0.9, sprite: 'forest-8' };
    default:
      return null;
  }
}
