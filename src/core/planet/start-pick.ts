/**
 * Where a new game starts on a planet: a mostly-land chunk inside a big
 * landmass (its neighbours are land too, so it is not an island edge), at a
 * temperate latitude, away from cube-face edges and ice.
 */
import {
  allChunks,
  chunkKey,
  chunkToSphere,
  neighbors8,
  sphereToLatLon,
  type ChunkAddr,
} from './cube-sphere';
import type { PlanetField } from './field';
import { Biome } from '../world/models';

export interface StartCandidate {
  addr: ChunkAddr;
  score: number;
  /** Land share of the chunk, 0..1. */
  land: number;
  /** Mean land share of its neighbours, 0..1. */
  around: number;
  /** Latitude of the chunk centre, degrees (north +). */
  latDeg: number;
}

/** Samples per chunk side when scoring. */
const GRID = 4;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

interface ChunkStats {
  land: number;
  cold: number;
}

function chunkStats(field: PlanetField, addr: ChunkAddr): ChunkStats {
  let land = 0;
  let cold = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const p = chunkToSphere(field.n, addr, (i + 0.5) / GRID, (j + 0.5) / GRID);
      const s = field.sample(p);
      if (s.elevM > 0) {
        land++;
        if (s.biome === Biome.Snow || s.biome === Biome.Taiga) cold++;
      }
    }
  }
  const total = GRID * GRID;
  return { land: land / total, cold: cold / total };
}

function scoreFrom(
  n: number,
  a: ChunkAddr,
  st: ChunkStats,
  statsOf: (b: ChunkAddr) => ChunkStats,
): StartCandidate {
  const ring = neighbors8(n, a);
  let around = 0;
  for (const b of ring) around += statsOf(b).land;
  around /= Math.max(1, ring.length);
  const latDeg = (sphereToLatLon(chunkToSphere(n, a)).lat * 180) / Math.PI;
  const own = 1 - clamp01(Math.abs(st.land - 0.8) / 0.4);
  const inland = clamp01((around - 0.45) / 0.35);
  const temperate = Math.exp(-(((Math.abs(latDeg) - 35) / 14) ** 2)) * (latDeg >= 0 ? 1 : 0.85);
  const edge = Math.min(a.cx, a.cy, n - 1 - a.cx, n - 1 - a.cy);
  const away = n < 6 ? 1 : edge >= 2 ? 1 : 0.35;
  const score = own * (0.15 + 0.85 * inland) * temperate * away * (1 - st.cold);
  return { addr: a, score, land: st.land, around, latDeg };
}

/** Every chunk scored, best first. Deterministic for a field. */
export function rankStartChunks(field: PlanetField): StartCandidate[] {
  const n = field.n;
  const stats = new Map<string, ChunkStats>();
  const chunks = allChunks(n);
  for (const a of chunks) stats.set(chunkKey(a), chunkStats(field, a));
  const statsOf = (b: ChunkAddr) => stats.get(chunkKey(b)) ?? { land: 0, cold: 0 };
  const out: StartCandidate[] = [];
  for (const a of chunks) {
    const st = statsOf(a);
    if (st.land < 0.4) continue;
    out.push(scoreFrom(n, a, st, statsOf));
  }
  out.sort((x, y) => y.score - x.score || chunkKey(x.addr).localeCompare(chunkKey(y.addr)));
  return out;
}

/** One chunk's start score (World Gen's hand pick), on the same scale as `rankStartChunks`. */
export function scoreStartChunk(field: PlanetField, addr: ChunkAddr): StartCandidate {
  const own = chunkStats(field, addr);
  return scoreFrom(field.n, addr, own, (b) => chunkStats(field, b));
}

/**
 * Starts for World Gen's "Reroll start": the best candidates, each at least
 * two chunks from every earlier one so a reroll visibly moves.
 */
export function startChoices(ranked: readonly StartCandidate[], count = 12): StartCandidate[] {
  const out: StartCandidate[] = [];
  for (const c of ranked) {
    if (out.length >= count) break;
    if (c.score <= 0) break;
    const near = out.some(
      (o) =>
        o.addr.face === c.addr.face &&
        Math.abs(o.addr.cx - c.addr.cx) <= 2 &&
        Math.abs(o.addr.cy - c.addr.cy) <= 2,
    );
    if (!near) out.push(c);
  }
  return out;
}

/** The best start chunk, or the field's first land chunk on a planet with no good one. */
export function defaultStartChunk(field: PlanetField): ChunkAddr {
  const best = rankStartChunks(field)[0];
  return best ? best.addr : { face: 0, cx: Math.floor(field.n / 2), cy: Math.floor(field.n / 2) };
}
