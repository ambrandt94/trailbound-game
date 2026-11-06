import { hash2 } from '../../core/world/noise';
import { BIOME_GROUND, PAIR_BASE } from './biome-table';

/** Subcells per world tile. 48 divides evenly, so edges land on whole texels. */
export const SUBCELLS = 6;

/**
 * Largest chebyshev radius, in world tiles, that the presentation field can
 * read. Logic stays on the world grid; this is only how far a curve can reach.
 */
export const FIELD_REACH = 2;

export interface FieldSample {
  biome: number;
  base: number;
}

export interface TileVariant {
  id: number;
  flipX: boolean;
  flipY: boolean;
  /** Wrapped source origin, in texels of the source image. */
  ox: number;
  oy: number;
}

const LOW_FREQ = 0.48;
const HIGH_FREQ = 2.6;
const FINE_FREQ = 6.5;

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

export function displaced(wx: number, wy: number, seed: number): { x: number; y: number } {
  const dx =
    (valueNoise(wx * LOW_FREQ, wy * LOW_FREQ, seed + 17) - 0.5) * 1.16 +
    (valueNoise(wx * HIGH_FREQ, wy * HIGH_FREQ, seed + 211) - 0.5) * 0.32 +
    (valueNoise(wx * FINE_FREQ, wy * FINE_FREQ, seed + 419) - 0.5) * 0.1;
  const dy =
    (valueNoise(wx * LOW_FREQ + 4.2, wy * LOW_FREQ + 1.3, seed + 91) - 0.5) * 1.16 +
    (valueNoise(wx * HIGH_FREQ + 2.2, wy * HIGH_FREQ + 5.1, seed + 307) - 0.5) * 0.32 +
    (valueNoise(wx * FINE_FREQ + 1.4, wy * FINE_FREQ + 3.7, seed + 523) - 0.5) * 0.1;
  return { x: wx + dx, y: wy + dy };
}

function priority(biome: number): number {
  return BIOME_GROUND[biome]?.priority ?? 0;
}

/**
 * The four world tiles around an already displaced point compete.
 * Higher priority wins a thin fringe. `base` is the same contest without it.
 */
export function classifyInto(
  sx: number,
  sy: number,
  seed: number,
  at: (x: number, y: number) => number,
  out: FieldSample,
): FieldSample {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  let best = at(x0, y0);
  let base = best;
  let bestScore = -1e9;
  let baseScore = -1e9;
  for (let oy = 0; oy <= 1; oy++) {
    for (let ox = 0; ox <= 1; ox++) {
      const tx = x0 + ox;
      const ty = y0 + oy;
      const biome = at(tx, ty);
      const dx = sx - (tx + 0.5);
      const dy = sy - (ty + 0.5);
      const dist = Math.hypot(dx, dy);
      const ragged = (hash2(tx, ty, seed + 53) - 0.5) * 0.08;
      const score = -dist + ragged + priority(biome) * 0.016;
      const plain = -dist + ragged;
      if (score > bestScore) {
        bestScore = score;
        best = biome;
      }
      if (plain > baseScore) {
        baseScore = plain;
        base = biome;
      }
    }
  }
  out.biome = best;
  out.base = base;
  return out;
}

export function sampleFieldInto(
  wx: number,
  wy: number,
  seed: number,
  at: (x: number, y: number) => number,
  out: FieldSample,
): FieldSample {
  const shifted = displaced(wx, wy, seed);
  return classifyInto(shifted.x, shifted.y, seed, at, out);
}

export function sampleField(
  wx: number,
  wy: number,
  seed: number,
  at: (x: number, y: number) => number,
): FieldSample {
  return sampleFieldInto(wx, wy, seed, at, { biome: 0, base: 0 });
}

/** Atlas index of an authored edge sheet, or null when the pair is generic. */
export function authoredEdge(a: number, b: number): number | null {
  if (a === b || a === 0 || b === 0) return null;
  const fg = priority(a) >= priority(b) ? a : b;
  const bg = fg === a ? b : a;
  const base = PAIR_BASE.get(`${fg}:${bg}`);
  return base === undefined ? null : base;
}

/**
 * Per-tile ground variant. Flip and a wrapped offset break the row that
 * appears when the same atlas cell repeats across a scanline.
 */
export function tileVariant(
  biome: number,
  x: number,
  y: number,
  seed: number,
  span = 48,
): TileVariant {
  const row = BIOME_GROUND[biome] ?? BIOME_GROUND[2];
  const atlas = row?.atlas ?? [0];
  const weights = row?.weights ?? [1];
  const roll = hash2(x * 13 + 1, y * 17 + 3, seed + biome * 97 + 13);
  let id = atlas[0] ?? 0;
  if (biome !== 0) {
    let acc = 0;
    for (let i = 0; i < atlas.length; i++) {
      acc += weights[i] ?? 0;
      if (roll <= acc) {
        id = atlas[i] ?? id;
        break;
      }
    }
  }
  const limit = Math.max(1, span);
  return {
    id,
    flipX: hash2(x, y, seed + 401 + biome * 3) >= 0.5,
    flipY: hash2(x, y, seed + 809 + biome * 5) >= 0.5,
    ox: Math.floor(hash2(x + 1, y, seed + 1201 + biome) * limit),
    oy: Math.floor(hash2(x, y + 1, seed + 1709 + biome) * limit),
  };
}
