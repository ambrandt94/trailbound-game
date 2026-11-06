import { hash2 } from '../../core/world/noise';
import { BIOME_GROUND, EDGE_INDEX, PAIR_BASE, SAND_WET, type BiomeRim } from './biome-table';

export const BIOME_NAMES = [
  'Water',
  'Sand',
  'Plains',
  'Meadow',
  'Forest',
  'DarkForest',
  'Hills',
  'Heath',
  'Marsh',
  'Mountain',
  'Snow',
  'Taiga',
  'Desert',
  'Jungle',
  'Ashlands',
] as const;

export interface CellPick {
  /** Foreground atlas cell, or the only cell when the corners agree. */
  atlasId: number;
  mask?: { bgId: number; maskIndex: number; rim: BiomeRim };
  /** Land bits after saddle cleanup. 0 and 15 are solid. */
  landBits: number;
  water: 'none' | 'deep' | 'shallow';
}

export interface FoamRun {
  axis: 'h' | 'v';
  /** Start along the run, 0–1 of the tile. */
  u: number;
  /** Cross position, 0–1 of the tile. */
  v: number;
  len: number;
}

function priority(biome: number): number {
  return BIOME_GROUND[biome]?.priority ?? 0;
}

function weighted(biome: number, x: number, y: number, seed: number): number {
  const row = BIOME_GROUND[biome] ?? BIOME_GROUND[2];
  if (!row) return 0;
  if (biome === 0) return SAND_WET;
  const roll = hash2(x, y, seed + biome * 17);
  let acc = 0;
  for (let i = 0; i < row.atlas.length; i++) {
    acc += row.weights[i] ?? 0;
    if (roll <= acc) return row.atlas[i] ?? row.atlas[0] ?? 0;
  }
  return row.atlas[row.atlas.length - 1] ?? 0;
}

/**
 * NW, NE, SE, SW of the cell whose northwest tile is (x, y).
 * A step in the coast is an inner or outer corner instead of a hard square.
 */
export function cellCorners(
  at: (x: number, y: number) => number,
  x: number,
  y: number,
): [number, number, number, number] {
  return [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
}

/**
 * Shore band. Land-adjacent water is the beach tile (no open plane).
 * The next ring is shallow, and open water past that is deep.
 */
export function waterBand(
  at: (x: number, y: number) => number,
  x: number,
  y: number,
): 'shallow' | 'deep' {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (at(x + dx, y + dy) !== 0) return 'shallow';
    }
  }
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 2) continue;
      if (at(x + dx, y + dy) !== 0) return 'shallow';
    }
  }
  return 'deep';
}

function collapseSaddle(bits: number, x: number, y: number, seed: number): number {
  if (bits !== 5 && bits !== 10) return bits;
  const flip = hash2(x, y, seed + 3) > 0.5;
  if (bits === 5) return flip ? 4 : 1;
  return flip ? 8 : 2;
}

/**
 * Foam along the land/water corner boundary.
 * Straight edges become one line; inner and outer corners turn.
 */
export function foamRuns(bits: number): FoamRun[] {
  if (bits === 0 || bits === 15) return [];
  const on = (mask: number) => (bits & mask) !== 0;
  const runs: FoamRun[] = [];
  if (on(8) !== on(4)) runs.push({ axis: 'v', u: 0.5, v: 0, len: 0.5 });
  if (on(1) !== on(2)) runs.push({ axis: 'v', u: 0.5, v: 0.5, len: 0.5 });
  if (on(8) !== on(1)) runs.push({ axis: 'h', u: 0, v: 0.5, len: 0.5 });
  if (on(4) !== on(2)) runs.push({ axis: 'h', u: 0.5, v: 0.5, len: 0.5 });
  return runs;
}

export function authoredPair(a: number, b: number): boolean {
  if (a === b) return true;
  const fg = priority(a) >= priority(b) ? a : b;
  const bg = fg === a ? b : a;
  return PAIR_BASE.has(`${fg}:${bg}`);
}

/**
 * One bake cell. Corners are NW, NE, SE, SW.
 * Mixed land/water cells stay on the edge tile so the water plane does not cover the beach.
 */
export function pickCell(
  rawCorners: readonly number[],
  x: number,
  y: number,
  seed: number,
  band: 'none' | 'deep' | 'shallow' = 'none',
): CellPick {
  const corners: [number, number, number, number] = [
    rawCorners[0] ?? 2,
    rawCorners[1] ?? 2,
    rawCorners[2] ?? 2,
    rawCorners[3] ?? 2,
  ];
  const unique = [...new Set(corners)];
  const only = unique[0] ?? 2;
  if (unique.length <= 1) {
    return {
      atlasId: only === 0 ? SAND_WET : weighted(only, x, y, seed),
      landBits: only === 0 ? 0 : 15,
      water: only === 0 ? (band === 'none' ? 'deep' : band) : 'none',
    };
  }
  const first = unique[0] ?? 2;
  const second = unique[1] ?? first;
  const fg = priority(first) >= priority(second) ? first : second;
  const bg = fg === first ? second : first;
  let bits =
    (corners[0] === fg ? 8 : 0) |
    (corners[1] === fg ? 4 : 0) |
    (corners[2] === fg ? 2 : 0) |
    (corners[3] === fg ? 1 : 0);
  bits = collapseSaddle(bits, x, y, seed);
  const edge = EDGE_INDEX.get(bits);
  const base = PAIR_BASE.get(`${fg}:${bg}`);
  const water = 'none' as const;
  if (edge !== undefined && base !== undefined) {
    return { atlasId: base + edge, landBits: bits, water };
  }
  const rim = BIOME_GROUND[fg]?.rim ?? { lit: '#F2D08C', shaded: '#C4A478', shadow: '#C4A478' };
  const maskIndex = edge ?? 0;
  return {
    atlasId: fg === 0 ? SAND_WET : weighted(fg, x, y, seed),
    mask: {
      bgId: bg === 0 ? SAND_WET : weighted(bg, x, y, seed + 99),
      maskIndex,
      rim,
    },
    landBits: bits,
    water,
  };
}
