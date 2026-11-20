import { describe, expect, test } from 'vitest';
import {
  allChunks,
  angleBetween,
  chunkKey,
  chunkLatLon,
  chunkSeed,
  chunkToSphere,
  faceToSphere,
  homeChunk,
  latLonToSphere,
  neighbor,
  neighbors4,
  neighbors8,
  oppositeSide,
  parseChunkKey,
  planetChunkCount,
  planetStats,
  PLANET_PRESET_SPECS,
  sameChunk,
  sphereToChunk,
  sphereToLatLon,
  type Side,
} from '../../src/core/planet';

const SIZES = [1, 2, 4, 5, 20];

describe('cube-sphere chunk addressing', () => {
  test('presets: default is 20 per face (2,400 chunks), tiny is 4 per face (96)', () => {
    expect(PLANET_PRESET_SPECS.standard.n).toBe(20);
    expect(planetChunkCount('standard')).toBe(2400);
    expect(PLANET_PRESET_SPECS.tiny.n).toBe(4);
    expect(planetChunkCount('tiny')).toBe(96);
  });

  test('every chunk centre maps back to the same chunk', () => {
    for (const n of SIZES) {
      const seen = new Set<string>();
      for (const a of allChunks(n)) {
        seen.add(chunkKey(a));
        for (const [x, y] of [
          [0.5, 0.5],
          [0.01, 0.99],
          [0.99, 0.02],
        ] as const) {
          const back = sphereToChunk(n, chunkToSphere(n, a, x, y));
          expect(chunkKey(back.chunk)).toBe(chunkKey(a));
          expect(back.x).toBeCloseTo(x, 6);
          expect(back.y).toBeCloseTo(y, 6);
        }
      }
      expect(seen.size).toBe(6 * n * n);
    }
  });

  test('points are unit vectors and faces tile the sphere without gaps', () => {
    for (let i = 0; i < 2000; i++) {
      const lat = Math.asin(((i * 0.618034) % 1) * 2 - 1);
      const lon = ((i * 0.754877) % 1) * Math.PI * 2 - Math.PI;
      const p = latLonToSphere(lat, lon);
      const hit = sphereToChunk(20, p);
      const q = chunkToSphere(20, hit.chunk, hit.x, hit.y);
      expect(angleBetween(p, q)).toBeLessThan(1e-6);
      expect(Math.hypot(...q)).toBeCloseTo(1, 9);
    }
  });

  test('lat/long: the home face centre is 0,0; the caps are the poles', () => {
    const c = sphereToLatLon(faceToSphere(0, 0, 0));
    expect(c.lat).toBeCloseTo(0, 9);
    expect(c.lon).toBeCloseTo(0, 9);
    expect(sphereToLatLon(faceToSphere(4, 0, 0)).lat).toBeCloseTo(Math.PI / 2, 9);
    expect(sphereToLatLon(faceToSphere(5, 0, 0)).lat).toBeCloseTo(-Math.PI / 2, 9);
    expect(sphereToLatLon(faceToSphere(1, 0, 0)).lon).toBeCloseTo(Math.PI / 2, 9);
    // East (+cx) on the home face is increasing longitude; south (+cy) is decreasing latitude.
    const a = chunkLatLon(20, { face: 0, cx: 10, cy: 10 });
    const east = chunkLatLon(20, { face: 0, cx: 11, cy: 10 });
    const south = chunkLatLon(20, { face: 0, cx: 10, cy: 11 });
    expect(east.lon).toBeGreaterThan(a.lon);
    expect(south.lat).toBeLessThan(a.lat);
    for (let k = 0; k < 50; k++) {
      const lat = -1.4 + k * 0.056;
      const lon = -3 + k * 0.12;
      const back = sphereToLatLon(latLonToSphere(lat, lon));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });

  test('neighbours are mutual on every chunk, across all 12 cube edges', () => {
    for (const n of SIZES) {
      for (const a of allChunks(n)) {
        for (const side of [0, 1, 2, 3] as Side[]) {
          const nb = neighbor(n, a, side);
          expect(sameChunk(nb.addr, a)).toBe(false);
          // Walking back out of the side we arrived through returns home.
          const arrived = ((side + nb.rot) % 4) as Side;
          const back = neighbor(n, nb.addr, oppositeSide(arrived));
          expect(chunkKey(back.addr)).toBe(chunkKey(a));
          expect((back.rot + nb.rot) % 4).toBe(0);
          // Neighbour centres sit about one chunk apart.
          const gap = angleBetween(chunkToSphere(n, a), chunkToSphere(n, nb.addr));
          expect(gap).toBeGreaterThan((Math.PI / 2 / n) * 0.6);
          expect(gap).toBeLessThan((Math.PI / 2 / n) * 1.45);
        }
      }
    }
  });

  test('all 24 face-edge pairings are found exactly once each way', () => {
    const n = 3;
    const pairs = new Set<string>();
    for (const a of allChunks(n)) {
      for (const side of [0, 1, 2, 3] as Side[]) {
        const nb = neighbor(n, a, side);
        if (nb.addr.face !== a.face) pairs.add(`${a.face}>${nb.addr.face}:${side}:${nb.rot}`);
      }
    }
    const facePairs = new Set([...pairs].map((p) => p.split(':')[0]));
    expect(facePairs.size).toBe(24);
    // Side faces hand over east-west without turning.
    expect(neighbor(n, { face: 0, cx: 2, cy: 1 }, 1)).toEqual({
      addr: { face: 1, cx: 0, cy: 1 },
      rot: 0,
    });
    expect(neighbor(n, { face: 3, cx: 0, cy: 1 }, 3)).toEqual({
      addr: { face: 2, cx: 2, cy: 1 },
      rot: 0,
    });
  });

  test('ring: 8 neighbours inside a face, 7 at a cube corner', () => {
    expect(neighbors8(20, { face: 0, cx: 10, cy: 10 })).toHaveLength(8);
    expect(neighbors8(20, { face: 0, cx: 0, cy: 7 })).toHaveLength(8);
    for (const face of [0, 1, 2, 3, 4, 5] as const) {
      for (const [cx, cy] of [
        [0, 0],
        [19, 0],
        [0, 19],
        [19, 19],
      ] as const) {
        const ring = neighbors8(20, { face, cx, cy });
        expect(ring).toHaveLength(7);
        expect(new Set(ring.map(chunkKey)).size).toBe(7);
      }
    }
    expect(neighbors4(4, { face: 4, cx: 0, cy: 0 })).toHaveLength(4);
  });

  test('equi-angular chunks stay within 1.5x of each other in size', () => {
    const n = 20;
    let lo = Infinity;
    let hi = 0;
    for (const a of allChunks(n).filter((c) => c.face === 0)) {
      const w = angleBetween(chunkToSphere(n, a, 0, 0.5), chunkToSphere(n, a, 1, 0.5));
      const h = angleBetween(chunkToSphere(n, a, 0.5, 0), chunkToSphere(n, a, 0.5, 1));
      lo = Math.min(lo, w * h);
      hi = Math.max(hi, w * h);
    }
    expect(hi / lo).toBeLessThan(1.5);
  });

  test('seeds: deterministic, distinct, and the home chunk keeps the world seed', () => {
    const home = homeChunk(20);
    expect(home).toEqual({ face: 0, cx: 10, cy: 10 });
    expect(chunkSeed(1234, home, home)).toBe(1234);
    const seeds = new Set(allChunks(20).map((a) => chunkSeed(1234, a)));
    expect(seeds.size).toBe(2400);
    expect(chunkSeed(1234, { face: 3, cx: 5, cy: 9 })).toBe(
      chunkSeed(1234, { face: 3, cx: 5, cy: 9 }),
    );
    expect(chunkSeed(1234, { face: 3, cx: 5, cy: 9 })).not.toBe(
      chunkSeed(1235, { face: 3, cx: 5, cy: 9 }),
    );
  });

  test('keys round-trip and reject bad input', () => {
    expect(parseChunkKey('4:3:2', 20)).toEqual({ face: 4, cx: 3, cy: 2 });
    expect(parseChunkKey('6:0:0', 20)).toBeNull();
    expect(parseChunkKey('0:20:0', 20)).toBeNull();
    expect(parseChunkKey('nope', 20)).toBeNull();
  });

  test('stats: 20 maps of 24.576 km per face edge', () => {
    const s = planetStats(20, 24.576);
    expect(s.chunks).toBe(2400);
    expect(s.circumferenceKm).toBeCloseTo(1966.08, 2);
  });
});
