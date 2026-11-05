import { hash2 } from '../../core/world/noise';
import { BIOME_GROUND, EDGE_INDEX, PAIR_BASE, SAND_WET, type BiomeRim } from './biome-table';

export interface CellPick {
  /** Foreground atlas cell, or the only cell when the corners agree. */
  atlasId: number;
  mask?: { bgId: number; maskIndex: number; rim: BiomeRim };
  water: 'none' | 'deep' | 'shallow';
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

/** Drop the rarest corner until a cell has at most two biomes. */
function simplify(corners: readonly number[]): [number, number, number, number] {
  const next: [number, number, number, number] = [
    corners[0] ?? 2,
    corners[1] ?? 2,
    corners[2] ?? 2,
    corners[3] ?? 2,
  ];
  for (let pass = 0; pass < 4; pass++) {
    const unique = new Set(next);
    if (unique.size <= 2) break;
    let low = 0;
    for (let i = 1; i < 4; i++) {
      if (priority(next[i] ?? 0) < priority(next[low] ?? 0)) low = i;
    }
    let high = next[0] ?? 2;
    for (const corner of next) {
      if (priority(corner) > priority(high)) high = corner;
    }
    next[low] = high;
  }
  return next;
}

/**
 * One bake cell. Corners are NW, NE, SE, SW. `openWater` is true when the
 * cell and its four neighbours are all water, which picks the deep plane.
 */
export function pickCell(
  rawCorners: readonly number[],
  x: number,
  y: number,
  seed: number,
  centerWater: boolean,
  openWater: boolean,
): CellPick {
  const corners = simplify(rawCorners);
  const unique = [...new Set(corners)];
  const only = unique[0] ?? 2;
  if (unique.length <= 1) {
    return {
      atlasId: only === 0 ? SAND_WET : weighted(only, x, y, seed),
      water: only === 0 ? (openWater ? 'deep' : 'shallow') : 'none',
    };
  }
  const first = unique[0] ?? 2;
  const second = unique[1] ?? first;
  const fg = priority(first) >= priority(second) ? first : second;
  const bg = fg === first ? second : first;
  const bits =
    (corners[0] === fg ? 8 : 0) |
    (corners[1] === fg ? 4 : 0) |
    (corners[2] === fg ? 2 : 0) |
    (corners[3] === fg ? 1 : 0);
  const edge = EDGE_INDEX.get(bits);
  const base = PAIR_BASE.get(`${fg}:${bg}`);
  const water = centerWater ? (openWater ? 'deep' : 'shallow') : 'none';
  if (edge !== undefined && base !== undefined) {
    return { atlasId: base + edge, water };
  }
  const rim = BIOME_GROUND[fg]?.rim ?? { lit: '#F2D08C', shaded: '#C4A478', shadow: '#C4A478' };
  if (edge === undefined) {
    return { atlasId: fg === 0 ? SAND_WET : weighted(fg, x, y, seed), water };
  }
  return {
    atlasId: fg === 0 ? SAND_WET : weighted(fg, x, y, seed),
    mask: {
      bgId: bg === 0 ? SAND_WET : weighted(bg, x, y, seed + 99),
      maskIndex: edge,
      rim,
    },
    water,
  };
}
