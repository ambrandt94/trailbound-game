import { describe, expect, it } from 'vitest';
import {
  bakeWorld,
  chunkRaster,
  makePlanetField,
  rankStartChunks,
  scoreStartChunk,
  startChoices,
  latLonToSphere,
} from '../../src/core/planet';
import { TrailboundLayer } from '../../src/core/planet/trailbound-layer';
import { PlanetLayer } from '../../src/core/planet/global-layer';
import {
  Biome,
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
  type WorldSettings,
} from '../../src/core/world/models';
import {
  generateChunkAt,
  generatePlanetChunk,
  generateWorld,
  sameWorldSettings,
} from '../../src/core/world/world-gen';
import { planetFrame, planetLatAt } from '../../src/core/world/planet-chunk';

const planet = (s: Partial<WorldSettings> = {}) =>
  clampSettings({ ...DEFAULT_WORLD_SETTINGS, worldScale: 1, ...s });

function landShare(biomes: Uint8Array): number {
  let land = 0;
  for (const b of biomes) if (b !== Biome.Water) land++;
  return land / biomes.length;
}

describe('World Gen shape settings', () => {
  it('read 0 when missing and clamp to −1..1 in 0.05 steps', () => {
    const s = clampSettings({});
    expect([s.seaLevel, s.tempBias, s.moistBias]).toEqual([0, 0, 0]);
    const t = clampSettings({ seaLevel: 3, tempBias: -0.333, moistBias: Number.NaN });
    expect([t.seaLevel, t.tempBias, t.moistBias]).toEqual([1, -0.35, 0]);
  });

  it('a neutral shape leaves both planets exactly as before', () => {
    const vs = [latLonToSphere(0.3, 0.1), latLonToSphere(-0.6, 2.2), latLonToSphere(1.3, -1)];
    const zero = { sea: 0, temp: 0, moist: 0 };
    for (const [a, b] of [
      [
        new TrailboundLayer({ seed: 5, n: 20 }),
        new TrailboundLayer({ seed: 5, n: 20, shape: zero }),
      ],
      [new PlanetLayer({ seed: 5, n: 20 }), new PlanetLayer({ seed: 5, n: 20, shape: zero })],
    ] as const) {
      for (const v of vs) expect(b.sample(v)).toEqual(a.sample(v));
    }
  });

  it('sea level drowns land and warmth shrinks the ice, for both sources', () => {
    for (const source of ['trailbound', 'procedural'] as const) {
      const share = (sea: number, temp = 0) => {
        const f = makePlanetField({ source, seed: 9, n: 20, shape: { sea, temp, moist: 0 } });
        return bakeWorld(f, 96, 48);
      };
      const base = share(0);
      const high = share(1);
      const low = share(-1);
      expect(high.landShare).toBeLessThan(base.landShare - 0.05);
      expect(low.landShare).toBeGreaterThan(base.landShare + 0.005);
      const iceOf = (b: typeof base) => {
        let ice = 0;
        for (let i = 1; i < b.flags.length; i += 4) ice += b.flags[i]! > 127 ? 1 : 0;
        return ice;
      };
      if (source === 'trailbound') expect(iceOf(share(0, 1))).toBeLessThan(iceOf(base));
    }
  });

  it('sea level, climate and source make a different world', () => {
    const a = planet();
    expect(sameWorldSettings(a, planet({ seaLevel: 0.2 }), 1)).toBe(false);
    expect(sameWorldSettings(a, planet({ tempBias: 0.2 }), 1)).toBe(false);
    expect(sameWorldSettings(a, planet({ moistBias: -0.2 }), 1)).toBe(false);
    expect(sameWorldSettings(a, planet(), 1)).toBe(true);
  });

  it('flow into the chunk map: higher sea, less land; warmer, warmer climate rows', () => {
    const seed = 7741;
    const base = generateWorld(seed, planet());
    const wet = generateWorld(seed, planet({ seaLevel: 0.3, homeChunk: base.settings.homeChunk }));
    expect(wet.settings.homeChunk).toEqual(base.settings.homeChunk);
    expect(landShare(wet.biomes)).toBeLessThan(landShare(base.biomes) - 0.2);
    // Drown the start completely and the auto pick takes over.
    const drowned = generateWorld(
      seed,
      planet({ seaLevel: 0.6, homeChunk: base.settings.homeChunk }),
    );
    expect(drowned.settings.homeChunk).not.toEqual(base.settings.homeChunk);
    const home = base.settings.homeChunk!;
    const cold = planetLatAt(20, home, -1)(0, 100);
    const warm = planetLatAt(20, home, 1)(0, 100);
    expect(warm).toBeGreaterThan(cold);
    expect(planetLatAt(20, home)(0, 100)).toBe(planetLatAt(20, home, 0)(0, 100));
  });
});

describe('the planet bake', () => {
  it('is equirect: biome, height and flags layers, land share by area', () => {
    const f = makePlanetField({ source: 'trailbound', seed: 7741, n: 20 });
    const b = bakeWorld(f, 128, 64);
    expect(b.biome.length).toBe(128 * 64 * 4);
    expect(b.height.length).toBe(128 * 64 * 4);
    expect(b.flags.length).toBe(128 * 64 * 4);
    // WG1: ~40% of the sphere is land.
    expect(b.landShare).toBeGreaterThan(0.33);
    expect(b.landShare).toBeLessThan(0.46);
    expect(b.maxM).toBeGreaterThan(500);
    expect(b.minM).toBeLessThan(-500);
    // The top row is polar ice.
    let ice = 0;
    for (let x = 0; x < 128; x++) ice += b.flags[x * 4 + 1]! > 127 ? 1 : 0;
    expect(ice).toBe(128);
  });
});

describe('start choices', () => {
  const field = makePlanetField({ source: 'trailbound', seed: 7741, n: 20 });
  const ranked = rankStartChunks(field);

  it('scores one chunk the same way the ranking does', () => {
    const best = ranked[0]!;
    expect(scoreStartChunk(field, best.addr).score).toBeCloseTo(best.score, 10);
  });

  it('rerolls through good, spread-out starts', () => {
    const choices = startChoices(ranked);
    expect(choices.length).toBeGreaterThan(3);
    expect(choices[0]!.addr).toEqual(ranked[0]!.addr);
    for (let i = 0; i < choices.length; i++) {
      expect(choices[i]!.land).toBeGreaterThan(0.4);
      for (let j = 0; j < i; j++) {
        const a = choices[i]!.addr;
        const b = choices[j]!.addr;
        const near = a.face === b.face && Math.abs(a.cx - b.cx) <= 2 && Math.abs(a.cy - b.cy) <= 2;
        expect(near).toBe(false);
      }
    }
  });
});

describe('any chunk on demand', () => {
  it('generates a chunk other than home with its own seed, no wrap, and a raster', () => {
    const settings = planet();
    const frame = planetFrame(7741, settings);
    const other = { ...frame.home, cx: frame.home.cx - 2 };
    const world = generateChunkAt(7741, settings, other, frame);
    expect(world.wraps).toBe(false);
    const home = generatePlanetChunk(7741, settings, frame.home, frame);
    expect(world.biomes).not.toEqual(home.biomes);
    const r = chunkRaster(world, 96);
    expect(r.size).toBe(96);
    expect(r.biome.length).toBe(96 * 96 * 4);
    expect(r.tiles).toBe(world.width);
    expect(Math.abs(r.land - landShare(world.biomes))).toBeLessThan(1e-9);
    for (const n of r.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(96);
    }
  });

  it('the home chunk of an island world is exactly its playable map', () => {
    const settings = clampSettings({
      ...DEFAULT_WORLD_SETTINGS,
      worldSource: 'island',
      worldScale: 1,
    });
    const frame = planetFrame(42, settings);
    const a = generateChunkAt(42, settings, frame.home, frame);
    const b = generateWorld(42, settings);
    expect(a.biomes).toEqual(b.biomes);
    // Other island-world chunks come from the procedural globe around it.
    const other = generateChunkAt(42, settings, { ...frame.home, cx: frame.home.cx + 3 }, frame);
    expect(other.wraps).toBe(false);
  });
});
