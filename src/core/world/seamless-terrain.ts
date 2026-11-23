/**
 * Seamless chunk terrain (M2c): a chunk map read straight off the planet
 * field in shared sphere coordinates, so neighbouring chunks agree along
 * their edges (across cube-face edges too) and the map matches the
 * whole-planet bake, with chunk-scale detail on top.
 *
 * - Slow terms (elevation, climate, plate belts, ice) come from `field.point`,
 *   the very function the bake samples, on a coarse node grid whose edge nodes
 *   are the same sphere points the neighbour uses.
 * - The coast comes from `field.fineLand` on a fine grid near the shore.
 * - Relief detail is 3D noise of the sphere point, so it is continuous too.
 * - Each tile's biome uses the field's own thresholds (`field.biomeOf`).
 *
 * Old worlds keep their home map from the classic per-chunk generator
 * (`WorldSettings.terrainGen` 1); see `generatePlanetChunk`.
 */
import {
  chunkKey,
  chunkToSphere,
  neighbor,
  sphereToFaceOn,
  type ChunkAddr,
  type PlanetField,
  type Side,
  type Vec3,
} from '../planet';
import { fbm3 } from '../planet/noise3';
import { Biome } from './models';
import { metersToNormalized, type TerrainField } from './terrain';

/** Coarse samples per chunk side (exact bake samples; everything slow is interpolated from them). */
export const SEAMLESS_COARSE = 65;
/** Most fine samples per chunk side (coast and relief detail). */
const SEAMLESS_FINE = 385;
/** Elevations within this many metres of sea level read the fine coast. */
const COAST_BAND_M = 420;

interface Grid {
  g: number;
  data: Float32Array[];
}

function bilerp(a: Float32Array, g: number, gx: number, gy: number): number {
  const x0 = Math.min(g - 2, Math.max(0, Math.floor(gx)));
  const y0 = Math.min(g - 2, Math.max(0, Math.floor(gy)));
  const tx = gx - x0;
  const ty = gy - y0;
  const i = x0 + y0 * g;
  const p = a[i]!;
  const q = a[i + 1]!;
  const r = a[i + g]!;
  const s = a[i + g + 1]!;
  return p + (q - p) * tx + (r - p) * ty + (p - q - r + s) * tx * ty;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The exact bake terms on a `c`×`c` grid of the chunk (edges included). */
function coarseGrid(field: PlanetField, n: number, addr: ChunkAddr, c: number): Grid {
  const names = 7;
  const data = Array.from({ length: names }, () => new Float32Array(c * c));
  const [elev, temp, moist, belt, cont, ice, lv] = data as [
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  for (let j = 0; j < c; j++) {
    for (let i = 0; i < c; i++) {
      const p = field.point(chunkToSphere(n, addr, i / (c - 1), j / (c - 1)));
      const k = i + j * c;
      elev[k] = p.elevM;
      temp[k] = p.temp;
      moist[k] = p.moist;
      belt[k] = p.belt;
      cont[k] = p.cont;
      ice[k] = p.ice;
      lv[k] = p.lv;
    }
  }
  return { g: c, data };
}

/** Relief detail amplitude (metres) for a land point: plains stay calm, belts and highlands get rugged. */
function reliefAmp(elevM: number, belt: number): number {
  const rough = 0.12 + 0.88 * clamp01(belt * 1.5) + 0.5 * clamp01((elevM - 400) / 1400);
  return 14 + rough * 360;
}

/**
 * Fine terms on a `g`×`g` grid over the chunk plus `pad` nodes past each edge
 * (the shore pass looks a little into the neighbours): coast, relief detail
 * and lapse-adjusted climate.
 */
function fineGrid(
  field: PlanetField,
  n: number,
  addr: ChunkAddr,
  coarse: Grid,
  g: number,
  pad: number,
): Grid {
  const seed = field.seed;
  const G = g + pad * 2;
  const data = Array.from({ length: 6 }, () => new Float32Array(G * G));
  const [E, T, M, B, C, I] = data as [
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  const [elev, temp, moist, belt, cont, ice] = coarse.data as [
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  const c = coarse.g;
  const scale = (c - 1) / (g - 1);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const v = chunkToSphere(n, addr, (i - pad) / (g - 1), (j - pad) / (g - 1));
      const cx = (i - pad) * scale;
      const cy = (j - pad) * scale;
      const e0 = bilerp(elev, c, cx, cy);
      const b = bilerp(belt, c, cx, cy);
      let land = e0 > 0;
      if (Math.abs(e0) < COAST_BAND_M) land = field.fineLand(v) > 0;
      let e = e0;
      if (land) {
        if (e < 2) e = 2;
        const amp = reliefAmp(e0, b);
        const d = (fbm3(v[0] * 170, v[1] * 170, v[2] * 170, seed + 301, 4) - 0.5) * 2 * amp;
        // Fade relief in from the shore so beaches stay low.
        e = Math.max(2, e + d * clamp01((e - 2) / 60));
      } else {
        if (e > -3) e = -3;
        const d = (fbm3(v[0] * 120, v[1] * 120, v[2] * 120, seed + 307, 3) - 0.5) * 60;
        e = Math.min(-3, e + d * clamp01((-e - 3) / 40));
      }
      const k = i + j * G;
      E[k] = e;
      T[k] = clamp01(bilerp(temp, c, cx, cy) - (Math.max(0, e) - Math.max(0, e0)) / 4200);
      M[k] = clamp01(
        bilerp(moist, c, cx, cy) +
          (fbm3(v[0] * 90, v[1] * 90, v[2] * 90, seed + 311, 2) - 0.5) * 0.07,
      );
      B[k] = b;
      C[k] = bilerp(cont, c, cx, cy);
      I[k] = bilerp(ice, c, cx, cy);
    }
  }
  return { g: G, data };
}

/**
 * A `w`×`w` chunk map from the planet: heights (metres and normalised) and
 * biomes. Tile (x, y) samples the chunk at ((x + 0.5) / w, (y + 0.5) / w).
 */
export function seamlessTerrain(
  field: PlanetField,
  n: number,
  addr: ChunkAddr,
  w: number,
): TerrainField {
  const coarse = coarseGrid(field, n, addr, SEAMLESS_COARSE);
  const g = Math.max(2, Math.min(SEAMLESS_FINE, Math.ceil(w / 8) + 1));
  const k = (g - 1) / w;
  // Beach width scales with the map (tiles cover more ground on small maps).
  const beach = Math.max(2, Math.round((BEACH_TILES * w) / 3072));
  const p = beach + 1;
  const pad = Math.ceil(p * k) + 1;
  const fine = fineGrid(field, n, addr, coarse, g, pad);
  const G = fine.g;
  const [E, T, M, B, C, I] = fine.data as [
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
    Float32Array,
  ];
  const heightM = new Float32Array(w * w);
  const heights = new Float32Array(w * w);
  const biomes = new Uint8Array(w * w);
  // Water on a padded tile grid, so beaches see the sea just over the edge.
  const W = w + p * 2;
  const wet = new Uint8Array(W * W);
  for (let y = -p; y < w + p; y++) {
    const gy = (y + 0.5) * k + pad;
    for (let x = -p; x < w + p; x++) {
      const gx = (x + 0.5) * k + pad;
      const e = bilerp(E, G, gx, gy);
      wet[x + p + (y + p) * W] = e < 0 ? 1 : 0;
      if (x < 0 || y < 0 || x >= w || y >= w) continue;
      const i = x + y * w;
      heightM[i] = e;
      heights[i] = metersToNormalized(e);
      biomes[i] = e < 0 ? Biome.Water : Biome.Sand;
    }
  }
  // Beaches hug the water: the planet's sand band is a bake texel wide (km),
  // so at chunk scale only tiles near the sea keep it.
  const shore = waterDistance(wet, W, beach + 1);
  for (let y = 0; y < w; y++) {
    const gy = (y + 0.5) * k + pad;
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      if (biomes[i] === Biome.Water) continue;
      const gx = (x + 0.5) * k + pad;
      const e = heightM[i]!;
      const b = field.biomeOf(
        shore[x + p + (y + p) * W]! > beach ? Math.max(e, INLAND_MIN_M) : e,
        bilerp(T, G, gx, gy),
        bilerp(M, G, gx, gy),
        bilerp(B, G, gx, gy),
        bilerp(C, G, gx, gy),
        bilerp(I, G, gx, gy),
      );
      biomes[i] = b;
    }
  }
  return { heightM, heights, biomes };
}

/** Beach width in tiles on a 16× (3072-tile) map, 8 m each. */
const BEACH_TILES = 14;
/** Classification floor away from the shore (just above the field's sand line). */
const INLAND_MIN_M = 24;

/** Chamfer distance (tiles, capped) from each tile to the nearest wet tile. */
function waterDistance(wet: Uint8Array, w: number, cap: number): Uint8Array {
  const d = new Uint8Array(w * w);
  for (let i = 0; i < d.length; i++) d[i] = wet[i] ? 0 : cap;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      let v = d[i]!;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1]! + 1);
      if (y > 0) v = Math.min(v, d[i - w]! + 1);
      d[i] = v;
    }
  }
  for (let y = w - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = x + y * w;
      let v = d[i]!;
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1]! + 1);
      if (y < w - 1) v = Math.min(v, d[i + w]! + 1);
      d[i] = v;
    }
  }
  return d;
}

/** A road gate on one chunk edge, in this chunk's tiles. */
export interface EdgeGate {
  side: Side;
  x: number;
  y: number;
  /** Shared by both chunks of the edge (seeds the road wiggle). */
  key: number;
}

function hashString(s: string, seed: number): number {
  let h = (seed ^ 0x6d2b79f5) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Sides' corner points in chunk-local 0..1 coordinates. */
const SIDE_CORNERS: Record<Side, [[number, number], [number, number]]> = {
  0: [
    [0, 0],
    [1, 0],
  ],
  1: [
    [1, 0],
    [1, 1],
  ],
  2: [
    [0, 1],
    [1, 1],
  ],
  3: [
    [0, 0],
    [0, 1],
  ],
};

function before(a: Vec3, b: Vec3): boolean {
  for (let i = 0; i < 3; i++) {
    const d = Math.round(a[i]! * 1e7) - Math.round(b[i]! * 1e7);
    if (d !== 0) return d < 0;
  }
  return true;
}

/** Share of edges that carry a road (when there is land on both sides). */
const GATE_CHANCE = 0.75;

/**
 * Road gates on the chunk's four edges. A gate is a function of the edge
 * alone (its two chunks and the planet), so the chunk on the other side puts
 * its gate on the same spot and the two roads meet. Edges with sea at the
 * gate get none.
 */
export function edgeGates(field: PlanetField, n: number, addr: ChunkAddr, w: number): EdgeGate[] {
  const out: EdgeGate[] = [];
  const self = chunkKey(addr);
  for (const side of [0, 1, 2, 3] as Side[]) {
    const other = chunkKey(neighbor(n, addr, side).addr);
    const edge = self < other ? `${self}|${other}` : `${other}|${self}`;
    const key = hashString(edge, field.seed);
    if ((key & 0xffff) / 0x10000 > GATE_CHANCE) continue;
    const [c0, c1] = SIDE_CORNERS[side];
    let a = chunkToSphere(n, addr, c0[0], c0[1]);
    let b = chunkToSphere(n, addr, c1[0], c1[1]);
    if (!before(a, b)) [a, b] = [b, a];
    const u = 0.22 + 0.56 * ((key >>> 16) / 0x10000);
    const p = normalize3([
      a[0] + (b[0] - a[0]) * u,
      a[1] + (b[1] - a[1]) * u,
      a[2] + (b[2] - a[2]) * u,
    ]);
    // Firm land only, so both sides' tiles agree it is land.
    if (field.point(p).elevM < 30 || field.fineLand(p) <= 0) continue;
    const { s, t } = sphereToFaceOn(addr.face, p);
    const lx = ((s + 1) / 2) * n - addr.cx;
    const ly = ((t + 1) / 2) * n - addr.cy;
    const tx = side === 1 ? w - 1 : side === 3 ? 0 : clampTile(lx * w, w);
    const ty = side === 2 ? w - 1 : side === 0 ? 0 : clampTile(ly * w, w);
    out.push({ side, x: tx, y: ty, key });
  }
  return out;
}

function clampTile(v: number, w: number): number {
  return Math.min(w - 1, Math.max(0, Math.floor(v)));
}

function normalize3(v: [number, number, number]): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
