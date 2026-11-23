import { describe, expect, it } from 'vitest';
import { generateWorld, sameWorldSettings } from '../../src/core/world/world-gen';
import {
  Biome,
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
  type WorldData,
  type WorldSettings,
  worldDeltaX,
  worldX,
} from '../../src/core/world/models';
import { savedWorldSettings } from '../../src/core/save/migrations';
import type { PackedWorld } from '../../src/core/save/types';
import { chunkLandShare, planetFrame } from '../../src/core/world/planet-chunk';
import { allChunks, defaultStartChunk, makePlanetField, neighbors8 } from '../../src/core/planet';
import { defaultNewWorldGen } from '../../src/ui/creator-state';

function fnv(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Same digest as the one used to record the goldens on main (f2cf53da). */
function worldHash(w: WorldData): string {
  let h = 2166136261;
  h = fnv(h, w.biomes);
  h = fnv(h, new Uint8Array(w.heightM.buffer));
  h = fnv(h, new Uint8Array(w.heights.buffer));
  h = fnv(h, w.paths);
  h = fnv(
    h,
    new TextEncoder().encode(JSON.stringify([w.nodes, w.pois, w.features, w.settings.mapStyle])),
  );
  return h.toString(16).padStart(8, '0');
}

/** Settings exactly as saves wrote them before world sources existed. */
function oldSave(seed: number, s: Partial<WorldSettings>): PackedWorld {
  const { worldSource: _a, homeChunk: _b, ...old } = { ...DEFAULT_WORLD_SETTINGS, ...s };
  return { worldSeed: seed, worldSettings: old } as unknown as PackedWorld;
}

describe('old saves keep their island byte for byte', () => {
  // Recorded with generateWorld on main f2cf53da, before world sources.
  const GOLDEN: Array<[number, Partial<WorldSettings>, string]> = [
    [7741, { worldScale: 16 }, 'a0000d11'],
    [7741, { worldScale: 1 }, '1126ccff'],
    [7741, { worldScale: 2, mapStyle: 'continent' }, '07a8b0d8'],
    [42, { worldScale: 1, mapStyle: 'archipelago' }, 'e280ed19'],
    [42, { worldScale: 4, mapStyle: 'fjords' }, 'a0e66686'],
    [99, { worldScale: 1, mapStyle: 'random' }, '14994490'],
  ];
  for (const [seed, s, hash] of GOLDEN) {
    it(`seed ${seed} ${JSON.stringify(s)}`, () => {
      const settings = savedWorldSettings(oldSave(seed, s));
      expect(settings.worldSource).toBe('island');
      expect(settings.homeChunk).toBeNull();
      const world = generateWorld(seed, settings);
      expect(world.wraps).toBeUndefined();
      expect(worldHash(world)).toBe(hash);
    }, 30000);
  }

  it('a save with no settings at all is an island too', () => {
    expect(savedWorldSettings({ worldSeed: 1 } as unknown as PackedWorld).worldSource).toBe(
      'island',
    );
  });
});

describe('new worlds', () => {
  it('default to the Trailbound world with an open home chunk', () => {
    expect(DEFAULT_WORLD_SETTINGS.worldSource).toBe('trailbound');
    expect(defaultNewWorldGen().worldSource).toBe('trailbound');
    // A missing source in stored data still reads as the classic island.
    expect(clampSettings({}).worldSource).toBe('island');
  });
});

describe('planet worlds: the home map is a sample of the continent', () => {
  const seed = 7741;
  const settings = clampSettings({ ...DEFAULT_WORLD_SETTINGS, worldScale: 1 });
  const world = generateWorld(seed, settings);
  const frame = planetFrame(seed, settings);

  it('resolves and stores the start chunk, which regenerates identically', () => {
    expect(world.settings.homeChunk).toEqual(frame.home);
    expect(frame.home).toEqual(defaultStartChunk(frame.field));
    const again = generateWorld(seed, clampSettings({ ...world.settings }));
    expect(worldHash(again)).toBe(worldHash(world));
    expect(sameWorldSettings(world.settings, settings, seed)).toBe(true);
  });

  it('puts land exactly where the planet does (no threshold drift, no ocean margin)', () => {
    let land = 0;
    for (const b of world.biomes) if (b !== Biome.Water) land++;
    const share = land / world.biomes.length;
    const planet = chunkLandShare(frame.field, frame.home, 40);
    expect(Math.abs(share - planet)).toBeLessThan(0.08);
    // A margin would leave every edge row at sea; continents run off the edges here.
    let edgeLand = 0;
    for (let x = 0; x < world.width; x++) {
      if (world.biomes[x] !== Biome.Water) edgeLand++;
      if (world.biomes[x + (world.height - 1) * world.width] !== Biome.Water) edgeLand++;
    }
    expect(edgeLand).toBeGreaterThan(world.width * 0.3);
  });

  it('starts inside a big landmass, not on an island edge', () => {
    expect(chunkLandShare(frame.field, frame.home, 16)).toBeGreaterThan(0.55);
    const around = neighbors8(frame.n, frame.home).map((a) => chunkLandShare(frame.field, a, 8));
    const mean = around.reduce((a, b) => a + b, 0) / around.length;
    expect(mean).toBeGreaterThan(0.45);
  });

  it('has Ashfen and its towns on one landmass, joined by roads', () => {
    const ashfen = world.nodes.find((n) => n.id === 'ashfen');
    expect(ashfen).toBeDefined();
    const towns = world.nodes.filter((n) => n.kind === 'city' || n.kind === 'town');
    expect(towns.length).toBeGreaterThanOrEqual(3);
    // Flood the land from Ashfen: every town is reachable without crossing water.
    const w = world.width;
    const seen = new Uint8Array(world.biomes.length);
    const stack = [Math.floor(ashfen!.cx) + Math.floor(ashfen!.cy) * w];
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i] || world.biomes[i] === Biome.Water) continue;
      seen[i] = 1;
      const x = i % w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i + w < world.biomes.length) stack.push(i + w);
    }
    for (const t of towns) expect(seen[Math.floor(t.cx) + Math.floor(t.cy) * w]).toBe(1);
    let roads = 0;
    for (const p of world.paths) roads += p;
    expect(roads).toBeGreaterThan(100);
  });

  it('does not wrap east–west', () => {
    expect(world.wraps).toBe(false);
    expect(worldX(world, -5)).toBe(0.5);
    expect(worldX(world, world.width + 5)).toBe(world.width - 0.5);
    expect(worldDeltaX(world, 1, world.width - 1)).toBe(world.width - 2);
    const classic = { width: 100 };
    expect(worldX(classic, -5)).toBe(95);
  });

  it('takes its climate from the real latitude, not a pole-to-pole strip', () => {
    // A temperate start: no polar snow band along the north edge.
    let snowTop = 0;
    let landTop = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < world.width; x++) {
        const b = world.biomes[x + y * world.width];
        if (b === Biome.Water) continue;
        landTop++;
        if (b === Biome.Snow || b === Biome.Taiga) snowTop++;
      }
    }
    expect(landTop).toBeGreaterThan(0);
    expect(snowTop / landTop).toBeLessThan(0.2);
  });

  it('works for the procedural planet and the tiny preset', () => {
    for (const extra of [{ worldSource: 'procedural' as const }, { planet: 'tiny' as const }]) {
      const s = clampSettings({ ...DEFAULT_WORLD_SETTINGS, worldScale: 1, ...extra });
      const w = generateWorld(11, s);
      expect(w.wraps).toBe(false);
      expect(w.settings.homeChunk).not.toBeNull();
      expect(w.nodes.some((n) => n.id === 'ashfen')).toBe(true);
    }
  });

  it('a hand-picked home in open sea falls back to the auto pick', () => {
    const field = makePlanetField({ source: 'trailbound', seed, n: 20 });
    const sea = allChunks(20).find((a) => chunkLandShare(field, a, 12) === 0);
    expect(sea).toBeDefined();
    const s = clampSettings({ ...DEFAULT_WORLD_SETTINGS, worldScale: 1, homeChunk: sea! });
    expect(planetFrame(seed, s).home).toEqual(defaultStartChunk(field));
  });
});
