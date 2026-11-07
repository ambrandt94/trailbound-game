import { BIOME_COUNT } from '../../core/world/models';
import { hash2 } from '../../core/world/noise';
import { BIOME_GROUND, DIRT_EDGE_BASE, EDGE_INDEX, PAIR_BASE, SANDSTONE_ROAD } from './biome-table';
import { BIOME_NAMES } from './terrain-pick';

const TILE = 48;

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  return n00 + (n10 - n00) * sx + (n01 - n00) * sy + (n00 - n10 - n01 + n11) * sx * sy;
}

/**
 * Edge wander in tiles. Low frequency only, so the coast is one irregular
 * contour. It is a function of world position, so neighbouring tiles agree
 * and nothing is mirrored.
 */
export function edgeField(wx: number, wy: number, seed: number): { x: number; y: number } {
  const n = valueNoise(wx * 0.62, wy * 0.62, seed + 17);
  const m = valueNoise(wx * 0.62 + 11.7, wy * 0.62 + 4.4, seed + 91);
  const n2 = valueNoise(wx * 1.55 + 3.1, wy * 1.55 + 8.6, seed + 211);
  const m2 = valueNoise(wx * 1.55 + 6.4, wy * 1.55 + 1.2, seed + 307);
  return {
    x: (n - 0.5) * 1.24 + (n2 - 0.5) * 0.36,
    y: (m - 0.5) * 1.24 + (m2 - 0.5) * 0.36,
  };
}

/** World tile that owns this texel after the edge field is applied. */
export function ownerTile(
  tileX: number,
  tileY: number,
  px: number,
  py: number,
  seed: number,
  size = TILE,
): { x: number; y: number } {
  const wx = tileX + (px + 0.5) / size;
  const wy = tileY + (py + 0.5) / size;
  const shift = edgeField(wx, wy, seed);
  return { x: Math.floor(wx + shift.x), y: Math.floor(wy + shift.y) };
}

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
        ? 'east-west straight: joined the authored west and east road caps with an irregular hash'
        : 'north-south straight: joined the authored north and south road caps with an irregular hash',
  };
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
        src = hash2(x, y, 3) < 0.5 ? first : second;
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
            ? 'No authored edge. Both tiles sample one world-space noise field and copy the owning ground tile, so the edge wanders across the boundary instead of repeating a comb.'
            : `Authored sheet at atlas ${base} for the 12 corner masks (edges, inner and outer corners, T-junctions). Masks 5, 10 and 15 are not on that sheet; those sample the same noise field.`,
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
    'A fill does not mirror and does not use a repeating dither. Each texel asks a low-frequency noise field, continuous across tile boundaries, which world tile owns it, then copies that tile’s authored ground pixel. There is no channel blend and no flat rim colour. A near-black sample is replaced with that tile’s own average non-black colour.',
    '',
    'Rivers are the Marsh biome. Coasts are land (usually Sand) onto Water. Roads use the dirt-edge sheet; the two straight masks that sheet does not contain are joins of the authored caps.',
    '',
    '## Authored pairs',
    '',
    ...authored.map((item) => `- ${item.name}: ${item.method}`),
    '',
    '## Filled pairs',
    '',
    'No authored edge. The edge is the world-space noise field described above, shared with the neighbouring tile.',
    '',
    ...missing.map((item) => `- ${item.name}`),
    '',
    '## Autotile masks',
    '',
    '- Edges, outer corners, inner corners and T-junctions are the 12 corner masks on `EDGE_INDEX`. An authored pair uses that sheet.',
    '- Mask 0 is an interior. Opposite-corner masks 5 and 10, the full ring, and every pair with no sheet use the noise field, so a diagonal run cuts across the tile instead of stepping in whole tiles.',
    '- Ground interiors use an authored variant, randomly flipped. The source is not scrolled, so a seamless tile stays seamless.',
    '',
    '## Roads',
    '',
    '- Caps, corners, T-junctions, the isolated tile and the crossing are authored (`DIRT_EDGE_BASE` and the sandstone road).',
    '- Mask 5 (east-west) and mask 10 (north-south) have no cell. Each is the west/north cap joined to the east/south cap. The join is an irregular hash, not a repeating comb.',
    '',
    '## Snow beside sand',
    '',
    'Seed 7741 places snow directly beside beach sand, and a few snow tiles beside open water. That is the world generator: high latitudes are forced to snow, and low shore land next to water becomes sand. The map draws that pair; it does not insert a land biome between them.',
    '',
    '## Chunk edges',
    '',
    'Region paints and chunk bakes read neighbour biomes and roads from the world, including the tile just outside the canvas, so two chunks agree on the shared edge.',
    '',
  ];
  return lines.join('\n');
}
