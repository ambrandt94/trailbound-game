import { Biome, TILE } from './models';

export const GROUPS = {
  plateau: 0,
  waterCliff: 4,
  path: 8,
  water: 12,
  forest: 16,
  rock: 20,
} as const;

export const SEASON = {
  summer: 0,
  winter: 7,
  autumn: 14,
  lush: 21,
} as const;

export interface TileSrc {
  sx: number;
  sy: number;
}

export function tileSrc(groupCol: number, seasonRow: number, lx: number, ly: number): TileSrc {
  return {
    sx: (groupCol + lx) * TILE,
    sy: (seasonRow + ly) * TILE,
  };
}

/** Neighbour bits for {@link blobQuadrants}, clockwise from north. */
export const NB = {
  n: 1,
  ne: 2,
  e: 4,
  se: 8,
  s: 16,
  sw: 32,
  w: 64,
  nw: 128,
} as const;

/** 3x3-local offsets for each {@link NB} bit, in bit order. */
export const NB_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** Piece index inside a 4x6 Pixel Kingdom group block: `lx + ly * 4`. */
export function pieceIndex(lx: number, ly: number): number {
  return lx + ly * 4;
}

function quadrant(
  a: boolean,
  b: boolean,
  diag: boolean,
  full: number,
  inner: number,
  onlyA: number,
  onlyB: number,
  outer: number,
): number {
  if (a && b) return diag ? full : inner;
  if (a) return onlyA;
  if (b) return onlyB;
  return outer;
}

const QUAD_LUT = new Uint32Array(256);
for (let mask = 0; mask < 256; mask++) {
  const n = (mask & NB.n) !== 0;
  const e = (mask & NB.e) !== 0;
  const s = (mask & NB.s) !== 0;
  const w = (mask & NB.w) !== 0;
  const ne = (mask & NB.ne) !== 0;
  const se = (mask & NB.se) !== 0;
  const sw = (mask & NB.sw) !== 0;
  const nw = (mask & NB.nw) !== 0;
  const p = pieceIndex;
  // Inner-corner pieces: (0,4) hole SE, (1,4) hole SW, (0,5) hole NE, (1,5) hole NW.
  const qNW = quadrant(n, w, nw, p(1, 1), p(1, 5), p(0, 1), p(1, 0), p(0, 0));
  const qNE = quadrant(n, e, ne, p(1, 1), p(0, 5), p(2, 1), p(1, 0), p(2, 0));
  const qSE = quadrant(s, e, se, p(1, 1), p(0, 4), p(2, 1), p(1, 2), p(2, 2));
  const qSW = quadrant(s, w, sw, p(1, 1), p(1, 4), p(0, 1), p(1, 2), p(0, 2));
  QUAD_LUT[mask] = qNW | (qNE << 5) | (qSE << 10) | (qSW << 15);
}

/**
 * 8-neighbour quarter-tile autotile (RPG Maker A2 style) over the Pixel Kingdom
 * group block. `mask` sets an {@link NB} bit where the same terrain continues.
 * Returns the four 8x8 quadrant pieces (NW, NE, SE, SW) packed 5 bits each;
 * read them with {@link quadPiece}. Inner corners come from block rows 4-5.
 */
export function blobQuadrants(mask: number): number {
  return QUAD_LUT[mask & 255]!;
}

/** Quadrant `q` (0 NW, 1 NE, 2 SE, 3 SW) of a {@link blobQuadrants} result. */
export function quadPiece(packed: number, q: number): number {
  return (packed >>> (q * 5)) & 31;
}

/** True when all four quadrants come from the same piece (draw it whole). */
export function quadUniform(packed: number): boolean {
  const a = packed & 31;
  return packed === (a | (a << 5) | (a << 10) | (a << 15));
}

export function biomeSeason(biome: Biome): number {
  switch (biome) {
    case Biome.Snow:
    case Biome.Taiga:
      return SEASON.winter;
    case Biome.Hills:
    case Biome.Heath:
    case Biome.Desert:
    case Biome.Ashlands:
      return SEASON.autumn;
    case Biome.DarkForest:
    case Biome.Marsh:
    case Biome.Jungle:
      return SEASON.lush;
    default:
      return SEASON.summer;
  }
}

/**
 * Raised or wooded layer drawn over a biome's ground (forest canopy, rock,
 * plateau cliffs). Grounds themselves come from the transition manifest.
 */
export function featureGroup(biome: Biome): number | null {
  switch (biome) {
    case Biome.Forest:
    case Biome.DarkForest:
    case Biome.Taiga:
    case Biome.Jungle:
      return GROUPS.forest;
    case Biome.Hills:
      return GROUPS.plateau;
    case Biome.Mountain:
    case Biome.Snow:
      return GROUPS.rock;
    default:
      return null;
  }
}

export const FLOORS: TileSrc[] = [
  { sx: 16 * TILE, sy: 1 * TILE },
  { sx: 4 * TILE, sy: 1 * TILE },
  { sx: 1 * TILE, sy: 1 * TILE },
  { sx: 10 * TILE, sy: 1 * TILE },
  { sx: 16 * TILE, sy: 7 * TILE },
  { sx: 4 * TILE, sy: 7 * TILE },
  { sx: 1 * TILE, sy: 7 * TILE },
  { sx: 10 * TILE, sy: 7 * TILE },
];

export function decoFor(
  biome: Biome,
  kind: 'flower' | 'leaf' | 'pebble' | 'lily' | 'ripple',
): TileSrc {
  const season = biomeSeason(biome);
  switch (kind) {
    case 'flower':
      return tileSrc(GROUPS.plateau, season, 0, 6);
    case 'leaf':
      return tileSrc(GROUPS.plateau, season, 1, 6);
    case 'pebble':
      return tileSrc(GROUPS.plateau, season, 2, 6);
    case 'lily':
      return tileSrc(GROUPS.waterCliff, season, 0, 6);
    case 'ripple':
      return tileSrc(GROUPS.waterCliff, season, 2, 6);
  }
}
