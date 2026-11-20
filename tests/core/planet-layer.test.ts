import { describe, expect, test } from 'vitest';
import { Biome } from '../../src/core/world/models';
import {
  allChunks,
  bakeFace,
  chunkToSphere,
  homeChunk,
  homePatchRgba,
  neighbor,
  PlanetLayer,
  type Side,
} from '../../src/core/planet';

describe('planet layer', () => {
  const layer = new PlanetLayer({ seed: 1234, n: 20, home: homeChunk(20) });

  test('deterministic from the seed', () => {
    const again = new PlanetLayer({ seed: 1234, n: 20, home: homeChunk(20) });
    const other = new PlanetLayer({ seed: 99, n: 20, home: homeChunk(20) });
    let differs = 0;
    for (const a of allChunks(20).slice(0, 400)) {
      expect(again.sampleChunk(a)).toEqual(layer.sampleChunk(a));
      if (other.sampleChunk(a).biome !== layer.sampleChunk(a).biome) differs++;
    }
    expect(differs).toBeGreaterThan(40);
  });

  test('has oceans and continents, mountains and a range of climates', () => {
    const biomes = new Map<number, number>();
    let land = 0;
    let maxM = -Infinity;
    let minM = Infinity;
    const chunks = allChunks(20);
    for (const a of chunks) {
      const s = layer.sampleChunk(a);
      biomes.set(s.biome, (biomes.get(s.biome) ?? 0) + 1);
      if (s.elevM >= 0) land++;
      maxM = Math.max(maxM, s.elevM);
      minM = Math.min(minM, s.elevM);
    }
    const frac = land / chunks.length;
    expect(frac).toBeGreaterThan(0.15);
    expect(frac).toBeLessThan(0.6);
    expect(maxM).toBeGreaterThan(1500);
    expect(maxM).toBeLessThanOrEqual(3200);
    expect(minM).toBeLessThan(-2000);
    expect(minM).toBeGreaterThanOrEqual(-4000);
    expect(biomes.size).toBeGreaterThanOrEqual(8);
    expect(biomes.get(Biome.Water)).toBeGreaterThan(0);
  });

  test('poles are cold, the equator is warm', () => {
    const pole = layer.sample([0, 1, 0]);
    const eq = layer.sample([0.70710678, 0, -0.70710678]);
    expect(pole.temp).toBeLessThan(0.25);
    expect(eq.temp).toBeGreaterThan(pole.temp + 0.3);
  });

  test('continuous across chunk and cube-face borders', () => {
    // The layer is a function of the sphere point, so both sides of an edge read the same value.
    for (const a of allChunks(20).filter((c) => c.cx === 19 || c.cy === 0)) {
      for (const side of [1, 0] as Side[]) {
        const nb = neighbor(20, a, side);
        if (nb.addr.face === a.face) continue;
        const edge = side === 1 ? chunkToSphere(20, a, 1, 0.5) : chunkToSphere(20, a, 0.5, 0);
        expect(layer.sample(edge)).toEqual(layer.sample([edge[0], edge[1], edge[2]]));
      }
    }
    // Small steps give small changes (no seams).
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const a = chunkToSphere(20, { face: 0, cx: 19, cy: i % 20 }, 0.9999, (i * 0.37) % 1);
      const b = chunkToSphere(20, { face: 1, cx: 0, cy: i % 20 }, 0.0001, (i * 0.37) % 1);
      worst = Math.max(worst, Math.abs(layer.sample(a).elevM - layer.sample(b).elevM));
    }
    expect(worst).toBeLessThan(150);
  });

  test('home chunk sits in open sea so the island meets water', () => {
    const home = homeChunk(20);
    // Every border of the home chunk, and the near quarter of each neighbour, is sea.
    for (let i = 0; i <= 8; i++) {
      const f = i / 8;
      for (const [x, y] of [
        [f, -0.25],
        [f, 1.25],
        [-0.25, f],
        [1.25, f],
        [f, 0],
        [f, 1],
        [0, f],
        [1, f],
      ] as const) {
        expect(layer.sample(chunkToSphere(20, home, x, y)).elevM).toBeLessThan(0);
      }
    }
  });

  test('face bake: RGBA, opaque, and the home patch is stamped', () => {
    const tiny = new PlanetLayer({ seed: 5, n: 4, home: homeChunk(4) });
    const size = 32;
    const patch = new Uint8ClampedArray(8 * 8 * 4).fill(255);
    for (let i = 0; i < patch.length; i += 4) patch[i + 1] = 0; // magenta
    const face = bakeFace(tiny, 0, size, [{ addr: homeChunk(4), size: 8, rgba: patch }]);
    expect(face.length).toBe(size * size * 4);
    for (let i = 3; i < face.length; i += 4) expect(face[i]).toBe(255);
    // Home (2,2) on a 4-wide face covers texels 16..23.
    const at = (r: number, c: number) => [
      ...face.slice((r * size + c) * 4, (r * size + c) * 4 + 3),
    ];
    expect(at(20, 20)).toEqual([255, 0, 255]);
    expect(at(4, 4)).not.toEqual([255, 0, 255]);
  });

  test('home patch from a world map', () => {
    const width = 16;
    const biomes = new Uint8Array(width * width).fill(Biome.Water);
    const heightM = new Float32Array(width * width).fill(-200);
    for (let y = 4; y < 12; y++)
      for (let x = 4; x < 12; x++) {
        biomes[y * width + x] = Biome.Forest;
        heightM[y * width + x] = 120;
      }
    const rgba = homePatchRgba({ width, height: width, biomes, heightM }, 8);
    expect(rgba.length).toBe(8 * 8 * 4);
    const px = (r: number, c: number) => rgba.slice((r * 8 + c) * 4, (r * 8 + c) * 4 + 3);
    expect(px(0, 0)[2]).toBeGreaterThan(px(0, 0)[0]!); // sea is blue
    expect(px(4, 4)[1]).toBeGreaterThan(px(4, 4)[2]!); // forest is green
  });
});
