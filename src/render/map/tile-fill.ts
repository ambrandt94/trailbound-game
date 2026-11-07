import { BIOME_COUNT } from '../../core/world/models';
import { BIOME_GROUND, DIRT_EDGE_BASE, EDGE_INDEX, PAIR_BASE, SANDSTONE_ROAD } from './biome-table';
import { BIOME_NAMES } from './terrain-pick';

/** 4×4 Bayer matrix. Coverage picks a source pixel; it never blends channels. */
export const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

const TILE = 48;

export interface Adj {
  center: number;
  n: number;
  e: number;
  s: number;
  w: number;
  nw: number;
  ne: number;
  se: number;
  sw: number;
}

export interface FillLayer {
  fg: number;
  bg: number;
  /** Corner bits, NW<<3 | NE<<2 | SE<<1 | SW. */
  bits: number;
  /**
   * dither-fringe: one foreground pulled in from the shared edge.
   * composite-corners: the 12-edge sheet has no cell for this mask, so the
   * same dither stands in for opposite corners or a full ring.
   */
  how: 'dither-fringe' | 'composite-corners';
}

export interface TileResolution {
  kind: 'ground' | 'authored' | 'fill';
  /** Stable id. Authored ids point at an atlas cell; fill ids are derived. */
  id: string;
  atlasId: number;
  method: string;
  fills: FillLayer[];
}

export interface RoadResolution {
  kind: 'authored' | 'fill';
  id: string;
  atlasId: number;
  method: string;
  axis?: 'ew' | 'ns';
  /** West/north cell, then east/south cell, when the straight is derived. */
  parts?: [number, number];
}

export function biomePriority(biome: number): number {
  return BIOME_GROUND[biome]?.priority ?? 0;
}

export function primaryAtlas(biome: number): number {
  return BIOME_GROUND[biome]?.atlas[0] ?? 0;
}

function isForeground(center: number, other: number): boolean {
  if (other === center) return false;
  const pc = biomePriority(center);
  const po = biomePriority(other);
  if (po > pc) return true;
  return po === pc && other > center;
}

/**
 * Corner mask of one foreground biome around `center`.
 * A cardinal paints both corners of that side. An inner corner (both cardinals
 * foreground, the diagonal still the centre) stays clear so the fill cuts in.
 */
export function foregroundBits(adj: Adj, fg: number): number {
  const on = (biome: number) => biome === fg;
  const n = on(adj.n);
  const e = on(adj.e);
  const s = on(adj.s);
  const w = on(adj.w);
  let nw = on(adj.nw) || n || w;
  let ne = on(adj.ne) || n || e;
  let se = on(adj.se) || s || e;
  let sw = on(adj.sw) || s || w;
  if (n && w && !on(adj.nw)) nw = false;
  if (n && e && !on(adj.ne)) ne = false;
  if (s && e && !on(adj.se)) se = false;
  if (s && w && !on(adj.sw)) sw = false;
  return (nw ? 8 : 0) | (ne ? 4 : 0) | (se ? 2 : 0) | (sw ? 1 : 0);
}

export function neighborAnchor(
  adj: Adj,
  fg: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const spots: ReadonlyArray<readonly [number, number, number]> = [
    [0, -1, adj.n],
    [1, 0, adj.e],
    [0, 1, adj.s],
    [-1, 0, adj.w],
    [-1, -1, adj.nw],
    [1, -1, adj.ne],
    [1, 1, adj.se],
    [-1, 1, adj.sw],
  ];
  for (const [dx, dy, biome] of spots) {
    if (biome === fg) return { x: x + dx, y: y + dy };
  }
  return { x, y };
}

function layerFor(adj: Adj, fg: number): FillLayer | null {
  const bits = foregroundBits(adj, fg);
  if (bits === 0) return null;
  return {
    fg,
    bg: adj.center,
    bits,
    how: EDGE_INDEX.has(bits) ? 'dither-fringe' : 'composite-corners',
  };
}

/** Every world-tile adjacency resolves to an authored cell or a derived fill. */
export function resolveTile(adj: Adj): TileResolution {
  const center = adj.center;
  const seen = new Set<number>();
  const order = [adj.n, adj.e, adj.s, adj.w, adj.nw, adj.ne, adj.se, adj.sw];
  for (const biome of order) {
    if (isForeground(center, biome)) seen.add(biome);
  }
  const layers: FillLayer[] = [];
  for (const fg of [...seen].sort((a, b) => biomePriority(a) - biomePriority(b) || a - b)) {
    const layer = layerFor(adj, fg);
    if (layer) layers.push(layer);
  }
  if (layers.length === 0) {
    return {
      kind: 'ground',
      id: `ground:${center}`,
      atlasId: primaryAtlas(center),
      method: 'authored interior',
      fills: [],
    };
  }
  const only = layers.length === 1 ? layers[0] : undefined;
  const base = only ? PAIR_BASE.get(`${only.fg}:${only.bg}`) : undefined;
  const edge = only ? EDGE_INDEX.get(only.bits) : undefined;
  if (only && base !== undefined && edge !== undefined) {
    const atlasId = base + edge;
    return {
      kind: 'authored',
      id: `atlas:${atlasId}`,
      atlasId,
      method: `authored edge sheet ${base}, index ${edge}`,
      fills: [],
    };
  }
  const id = `fill:${layers.map((layer) => `${layer.fg}-${layer.bg}-${layer.bits}`).join('+')}`;
  const method = layers
    .map((layer) => {
      const name = `${BIOME_NAMES[layer.fg] ?? layer.fg} onto ${BIOME_NAMES[layer.bg] ?? layer.bg}`;
      if (layer.how === 'composite-corners') {
        return `${name} mask ${layer.bits}: composite of the two authored grounds, dithered (no 12-edge cell)`;
      }
      return `${name} mask ${layer.bits}: dithered fringe mirrored from the foreground ground tile`;
    })
    .join('; ');
  return {
    kind: 'fill',
    id,
    atlasId: primaryAtlas(center),
    method,
    fills: layers,
  };
}

/** Cardinal road mask. 5 (east-west) and 10 (north-south) are not on the 12-edge sheet. */
export function resolveRoad(n: boolean, e: boolean, s: boolean, w: boolean): RoadResolution {
  const bits = (n ? 8 : 0) | (e ? 4 : 0) | (s ? 2 : 0) | (w ? 1 : 0);
  if (bits === 0 || bits === 15) {
    return {
      kind: 'authored',
      id: `road:${SANDSTONE_ROAD}`,
      atlasId: SANDSTONE_ROAD,
      method: bits === 0 ? 'authored isolated road' : 'authored road crossing',
    };
  }
  const edge = EDGE_INDEX.get(bits);
  if (edge !== undefined) {
    const atlasId = DIRT_EDGE_BASE + edge;
    return {
      kind: 'authored',
      id: `road:${atlasId}`,
      atlasId,
      method: `authored road edge ${edge}`,
    };
  }
  const axis = bits === 5 ? 'ew' : 'ns';
  const parts: [number, number] =
    axis === 'ew'
      ? [DIRT_EDGE_BASE + (EDGE_INDEX.get(1) ?? 0), DIRT_EDGE_BASE + (EDGE_INDEX.get(4) ?? 0)]
      : [DIRT_EDGE_BASE + (EDGE_INDEX.get(8) ?? 0), DIRT_EDGE_BASE + (EDGE_INDEX.get(2) ?? 0)];
  return {
    kind: 'fill',
    id: `road-fill:${bits}`,
    atlasId: SANDSTONE_ROAD,
    axis,
    parts,
    method:
      axis === 'ew'
        ? 'east-west straight: mirrored the authored west and east road caps and dithered the join'
        : 'north-south straight: mirrored the authored north and south road caps and dithered the join',
  };
}

export function fringeBand(size = TILE): number {
  return Math.max(2, Math.round((size * 14) / 48));
}

/** 1 on the outer pixel of an active corner, 0 outside the fringe. */
export function fringeCoverage(bits: number, x: number, y: number, size = TILE): number {
  const band = fringeBand(size);
  const nw = (bits & 8) !== 0;
  const ne = (bits & 4) !== 0;
  const se = (bits & 2) !== 0;
  const sw = (bits & 1) !== 0;
  const mid = size / 2;
  let cover = 0;
  if (y < band && (x < mid ? nw : ne)) cover = Math.max(cover, 1 - y / band);
  if (y >= size - band && (x < mid ? sw : se)) cover = Math.max(cover, 1 - (size - 1 - y) / band);
  if (x < band && (y < mid ? nw : sw)) cover = Math.max(cover, 1 - x / band);
  if (x >= size - band && (y < mid ? ne : se)) cover = Math.max(cover, 1 - (size - 1 - x) / band);
  return cover;
}

/** Mirror across the stronger edge so the outer pixel continues the neighbour tile. */
export function fringeSample(
  bits: number,
  x: number,
  y: number,
  size = TILE,
): { x: number; y: number } {
  const band = fringeBand(size);
  const nw = (bits & 8) !== 0;
  const ne = (bits & 4) !== 0;
  const se = (bits & 2) !== 0;
  const sw = (bits & 1) !== 0;
  const mid = size / 2;
  let vertical = 0;
  let horizontal = 0;
  if (y < band && (x < mid ? nw : ne)) vertical = Math.max(vertical, 1 - y / band);
  if (y >= size - band && (x < mid ? sw : se)) {
    vertical = Math.max(vertical, 1 - (size - 1 - y) / band);
  }
  if (x < band && (y < mid ? nw : sw)) horizontal = Math.max(horizontal, 1 - x / band);
  if (x >= size - band && (y < mid ? ne : se)) {
    horizontal = Math.max(horizontal, 1 - (size - 1 - x) / band);
  }
  if (horizontal > vertical) return { x: size - 1 - x, y };
  return { x, y: size - 1 - y };
}

export function averageOpaque(pixels: Uint8ClampedArray): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const pr = pixels[i] ?? 0;
    const pg = pixels[i + 1] ?? 0;
    const pb = pixels[i + 2] ?? 0;
    if (pr + pg + pb < 12) continue;
    r += pr;
    g += pg;
    b += pb;
    n += 1;
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

function writePixel(
  out: Uint8ClampedArray,
  index: number,
  r: number,
  g: number,
  b: number,
  fallback: { r: number; g: number; b: number },
): void {
  if (r + g + b < 12) {
    const fr = fallback.r + fallback.g + fallback.b < 12 ? 0 : fallback.r;
    out[index] = fr || r;
    out[index + 1] = fallback.r + fallback.g + fallback.b < 12 ? g : fallback.g;
    out[index + 2] = fallback.r + fallback.g + fallback.b < 12 ? b : fallback.b;
  } else {
    out[index] = r;
    out[index + 1] = g;
    out[index + 2] = b;
  }
  out[index + 3] = 255;
}

/**
 * Transparent overlay. Lit pixels are copied from the foreground tile
 * (palette-locked, Bayer dither, no channel blend).
 */
export function compositeFringe(
  fg: Uint8ClampedArray,
  bits: number,
  out: Uint8ClampedArray,
  size = TILE,
): void {
  out.fill(0);
  const fallback = averageOpaque(fg);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cover = fringeCoverage(bits, x, y, size);
      if (cover <= 0) continue;
      const bayer = BAYER_4[((y & 3) * 4 + (x & 3)) % 16] ?? 0;
      if ((bayer + 0.5) / 16 >= cover) continue;
      const src = fringeSample(bits, x, y, size);
      const si = (src.y * size + src.x) * 4;
      const di = (y * size + x) * 4;
      writePixel(out, di, fg[si] ?? 0, fg[si + 1] ?? 0, fg[si + 2] ?? 0, fallback);
    }
  }
}

/** Join two authored road caps into the straight the sheet does not contain. */
export function compositeRoadStraight(
  first: Uint8ClampedArray,
  second: Uint8ClampedArray,
  out: Uint8ClampedArray,
  axis: 'ew' | 'ns',
  size = TILE,
): void {
  const fallback = averageOpaque(first);
  const mid = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const along = axis === 'ew' ? x : y;
      const di = (y * size + x) * 4;
      let src: Uint8ClampedArray = first;
      if (along > mid + 4) src = second;
      else if (along >= mid - 4) {
        const bayer = BAYER_4[((y & 3) * 4 + (x & 3)) % 16] ?? 0;
        src = bayer < 8 ? first : second;
      }
      writePixel(out, di, src[di] ?? 0, src[di + 1] ?? 0, src[di + 2] ?? 0, fallback);
    }
  }
}

export interface FillCase {
  fg: number;
  bg: number;
  name: string;
  authoredBase: number | null;
  method: string;
}

/** Pairs the world can show, higher priority (or higher id) on the lower one. */
export function fillCases(): FillCase[] {
  const cases: FillCase[] = [];
  for (let fg = 0; fg < BIOME_COUNT; fg++) {
    for (let bg = 0; bg < BIOME_COUNT; bg++) {
      if (!isForeground(bg, fg)) continue;
      const base = PAIR_BASE.get(`${fg}:${bg}`);
      const name = `${BIOME_NAMES[fg] ?? fg} onto ${BIOME_NAMES[bg] ?? bg}`;
      cases.push({
        fg,
        bg,
        name,
        authoredBase: base ?? null,
        method:
          base === undefined
            ? 'No authored edge. The background tile keeps its ground, and the foreground ground is mirrored across the shared edge with a 4×4 Bayer dither. Colours are copied from those two tiles.'
            : `Authored sheet at atlas ${base} for the 12 corner masks. Masks 5, 10 and 15 are not on that sheet; those use the same dither, still from the two ground tiles.`,
      });
    }
  }
  return cases;
}

/** Short note for the artist. Derived tiles are not written back into the atlas. */
export function tileFillReport(): string {
  const cases = fillCases();
  const authored = cases.filter((item) => item.authoredBase !== null);
  const missing = cases.filter((item) => item.authoredBase === null);
  const lines = [
    '# Derived map tiles',
    '',
    'Authored art stays in `public/assets/map/trailbound48/`. Nothing here is painted back into `atlas_terrain.png`. Missing transitions are built at runtime into a separate canvas cache.',
    '',
    'A fill copies the two ground tiles. The foreground is mirrored across the shared edge (so the outer pixel continues the neighbour) and chosen with a 4×4 Bayer dither. There is no channel blend and no flat rim colour. A near-black sample is replaced with that tile’s own average non-black colour.',
    '',
    'Rivers are the Marsh biome. Coasts are land (usually Sand) onto Water. Roads use the dirt-edge sheet; the two straight masks that sheet does not contain are joins of the authored caps.',
    '',
    '## Authored pairs',
    '',
    ...authored.map((item) => `- ${item.name}: ${item.method}`),
    '',
    '## Filled pairs',
    '',
    'No authored edge. The background tile keeps its ground, and the foreground ground is mirrored across the shared edge with a 4×4 Bayer dither. Colours are copied from those two tiles.',
    '',
    ...missing.map((item) => `- ${item.name}`),
    '',
    '## Autotile masks',
    '',
    '- Edges, outer corners, inner corners and T-junctions are the 12 corner masks on `EDGE_INDEX`. An authored pair uses that sheet.',
    '- Mask 0 is empty and mask 15 is a solid ring. Opposite-corner masks 5 and 10 are not on the sheet. Those three, and every pair with no sheet, use the dither fill.',
    '- An isolated foreground tile stays the authored ground. The surrounding background tiles carry the fringe, so the seam is the same pixel on both sides.',
    '',
    '## Roads',
    '',
    '- Caps, corners, T-junctions, the isolated tile and the crossing are authored (`DIRT_EDGE_BASE` and the sandstone road).',
    '- Mask 5 (east-west) and mask 10 (north-south) have no cell. Each is the west/north cap joined to the east/south cap, with a Bayer dither on the four-pixel join.',
    '',
    '## Chunk edges',
    '',
    'Region paints and chunk bakes read neighbour biomes and roads from the world, including the tile just outside the canvas, so two chunks agree on the shared edge.',
    '',
  ];
  return lines.join('\n');
}
