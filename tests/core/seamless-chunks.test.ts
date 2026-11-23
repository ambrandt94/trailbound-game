import { describe, expect, it } from 'vitest';
import {
  chunkToSphere,
  neighbor,
  type ChunkAddr,
  type PlanetField,
  type Side,
} from '../../src/core/planet';
import {
  Biome,
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
  type WorldData,
} from '../../src/core/world/models';
import { planetFrame } from '../../src/core/world/planet-chunk';
import { edgeGates } from '../../src/core/world/seamless-terrain';
import { generateChunkAt, generateWorld } from '../../src/core/world/world-gen';

const SEED = 7741;

function settingsFor(source: 'trailbound' | 'procedural', terrainGen: 1 | 2 = 2) {
  return clampSettings({
    ...DEFAULT_WORLD_SETTINGS,
    worldSource: source,
    worldScale: 2,
    terrainGen,
  });
}

/** Tiles along one side of a map, walking the side's own direction (x for N/S, y for E/W). */
function sideRow(world: WorldData, side: Side): Array<{ h: number; b: number; road: number }> {
  const w = world.width;
  const out = [];
  for (let k = 0; k < w; k++) {
    const x = side === 1 ? w - 1 : side === 3 ? 0 : k;
    const y = side === 2 ? w - 1 : side === 0 ? 0 : k;
    const i = y * w + x;
    out.push({ h: world.heightM[i]!, b: world.biomes[i]!, road: world.paths[i]! });
  }
  return out;
}

/** The neighbour's row, re-ordered so index k touches our index k (found from the sphere). */
function matchedRows(n: number, a: ChunkAddr, side: Side, A: WorldData, B: WorldData) {
  const nb = neighbor(n, a, side);
  const back = ((side + 2 + nb.rot) % 4) as Side;
  const ours = sideRow(A, side);
  const theirs = sideRow(B, back);
  // Which way does their row run against ours? Compare the corner points on the sphere.
  const start = side === 1 ? [1, 0] : side === 3 ? [0, 0] : side === 0 ? [0, 0] : [0, 1];
  const p = chunkToSphere(n, a, start[0]!, start[1]!);
  const bStart = back === 1 ? [1, 0] : back === 3 ? [0, 0] : back === 0 ? [0, 0] : [0, 1];
  const q = chunkToSphere(n, nb.addr, bStart[0]!, bStart[1]!);
  const same = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6;
  return { ours, theirs: same ? theirs : [...theirs].reverse(), addr: nb.addr };
}

/** Land share along an edge, from the field (to pick edges with a coast on them). */
function edgeLand(field: PlanetField, n: number, a: ChunkAddr, side: Side): number {
  let land = 0;
  for (let k = 0; k < 24; k++) {
    const u = (k + 0.5) / 24;
    const x = side === 1 ? 1 : side === 3 ? 0 : u;
    const y = side === 2 ? 1 : side === 0 ? 0 : u;
    if (field.point(chunkToSphere(n, a, x, y)).elevM > 0) land++;
  }
  return land / 24;
}

/** A chunk on face `face` whose `side` edge has a coast on it. */
function coastalEdge(field: PlanetField, n: number, face: 0 | 1 | 4, side: Side): ChunkAddr {
  let best: ChunkAddr = { face, cx: 0, cy: 0 };
  let bestScore = -1;
  for (let k = 0; k < n; k++) {
    const a: ChunkAddr =
      side === 1
        ? { face, cx: n - 1, cy: k }
        : side === 0
          ? { face, cx: k, cy: 0 }
          : side === 2
            ? { face, cx: k, cy: n - 1 }
            : { face, cx: 0, cy: k };
    const l = edgeLand(field, n, a, side);
    const score = 1 - Math.abs(l - 0.5) * 2;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

function compare(rows: ReturnType<typeof matchedRows>) {
  let dh = 0;
  let land = 0;
  let biome = 0;
  for (let k = 0; k < rows.ours.length; k++) {
    const a = rows.ours[k]!;
    const b = rows.theirs[k]!;
    dh += Math.abs(a.h - b.h);
    if ((a.b === Biome.Water) === (b.b === Biome.Water)) land++;
    if (a.b === b.b) biome++;
  }
  const m = rows.ours.length;
  return { meanDh: dh / m, land: land / m, biome: biome / m };
}

describe('seamless chunks (M2c)', () => {
  for (const source of ['trailbound', 'procedural'] as const) {
    it(`${source}: neighbours on one face meet at the edge`, () => {
      const settings = settingsFor(source);
      const frame = planetFrame(SEED, settings);
      const a = frame.home;
      const A = generateChunkAt(SEED, settings, a, frame);
      for (const side of [1, 2] as Side[]) {
        const rows = matchedRows(
          frame.n,
          a,
          side,
          A,
          generateChunkAt(SEED, settings, neighbor(frame.n, a, side).addr, frame),
        );
        const c = compare(rows);
        expect(c.land).toBeGreaterThan(0.97);
        expect(c.biome).toBeGreaterThan(0.9);
        expect(c.meanDh).toBeLessThan(25);
      }
    });

    it(`${source}: neighbours across a cube-face edge meet`, () => {
      const settings = settingsFor(source);
      const frame = planetFrame(SEED, settings);
      for (const [face, side] of [
        [0, 1],
        [0, 0],
      ] as const) {
        const a = coastalEdge(frame.field, frame.n, face, side);
        const A = generateChunkAt(SEED, settings, a, frame);
        const rows = matchedRows(
          frame.n,
          a,
          side,
          A,
          generateChunkAt(SEED, settings, neighbor(frame.n, a, side).addr, frame),
        );
        expect(rows.addr.face).not.toBe(a.face);
        const c = compare(rows);
        expect(c.land).toBeGreaterThan(0.97);
        expect(c.biome).toBeGreaterThan(0.9);
        expect(c.meanDh).toBeLessThan(25);
      }
    });
  }

  it('roads leave a chunk where the next chunk picks them up', () => {
    const settings = settingsFor('trailbound');
    const frame = planetFrame(SEED, settings);
    const a = frame.home;
    const w = generateChunkAt(SEED, settings, a, frame).width;
    for (const side of [0, 1, 2, 3] as Side[]) {
      const nb = neighbor(frame.n, a, side);
      const ours = edgeGates(frame.field, frame.n, a, w).find((g) => g.side === side);
      const back = ((side + 2 + nb.rot) % 4) as Side;
      const theirs = edgeGates(frame.field, frame.n, nb.addr, w).find((g) => g.side === back);
      expect(Boolean(ours)).toBe(Boolean(theirs));
      if (ours && theirs) expect(ours.key).toBe(theirs.key);
    }
  });

  it('chunk maps match the planet bake', () => {
    const settings = settingsFor('trailbound');
    const frame = planetFrame(SEED, settings);
    const world = generateChunkAt(SEED, settings, frame.home, frame);
    const w = world.width;
    let land = 0;
    let biome = 0;
    let total = 0;
    for (let y = 4; y < w; y += 8) {
      for (let x = 4; x < w; x += 8) {
        const s = frame.field.sample(
          chunkToSphere(frame.n, frame.home, (x + 0.5) / w, (y + 0.5) / w),
        );
        const b = world.biomes[y * w + x]!;
        if (s.elevM > 0 === (b !== Biome.Water)) land++;
        if (s.biome === b) biome++;
        total++;
      }
    }
    expect(land / total).toBeGreaterThan(0.95);
    expect(biome / total).toBeGreaterThan(0.75);
  });

  it('old worlds keep their home map (terrainGen 1)', () => {
    const old = settingsFor('trailbound', 1);
    const frame = planetFrame(SEED, old);
    const a = generateWorld(SEED, old);
    const b = generateChunkAt(SEED, old, frame.home, frame);
    expect(Buffer.from(a.biomes).equals(Buffer.from(b.biomes))).toBe(true);
    // Seamless differs from the classic map, so the gate matters.
    const fresh = generateWorld(SEED, settingsFor('trailbound', 2));
    expect(Buffer.from(fresh.biomes).equals(Buffer.from(a.biomes))).toBe(false);
    expect(clampSettings({}).terrainGen).toBe(1);
    expect(DEFAULT_WORLD_SETTINGS.terrainGen).toBe(2);
  });
});
