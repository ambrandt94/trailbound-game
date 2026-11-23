import { expect, test, vi } from 'vitest';
import { savedWorldSettings } from '../../src/core/save/migrations';
import { createWorld } from '../../src/core/state/world-state';
import {
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
  EXPERIMENTAL_WORLD_SCALES,
  WORLD_SCALES,
  worldExtent,
  worldSizeKm,
  type WorldScale,
} from '../../src/core/world/models';
import { generateWorld, resolveLandStyle, sameWorldSettings } from '../../src/core/world/world-gen';
import { TILE_M } from '../../src/core/world/terrain';
import {
  defaultNewWorldGen,
  newWorldGen,
  newWorldLand,
  newWorldSettings,
  setNewWorldGen,
} from '../../src/ui/creator-state';

// The 32× smoke builds a 6144² world (~5 s locally, more on CI runners).
vi.setConfig({ testTimeout: 180_000 });

const CF = { version: 'x', generatorVersion: 'x' };

test('32× is a world size; 16× stays the default and the fallback', () => {
  expect(WORLD_SCALES).toContain(32);
  expect(EXPERIMENTAL_WORLD_SCALES).toEqual([32]);
  expect(DEFAULT_WORLD_SETTINGS.worldScale).toBe(16);
  expect(clampSettings({ worldScale: 32 }).worldScale).toBe(32);
  expect(clampSettings({ worldScale: 64 as WorldScale }).worldScale).toBe(16);
  expect(worldExtent(32)).toBe(6144);
  expect(TILE_M).toBe(8);
  expect(worldSizeKm(16)).toBeCloseTo(24.576, 3);
  expect(worldSizeKm(32)).toBeCloseTo(49.152, 3);
});

test('the new-world controls clamp to the world-settings ranges', () => {
  newWorldGen.value = defaultNewWorldGen();
  setNewWorldGen({ worldScale: 32, poiCount: 9999, wanderers: -5, caravans: 12.6, armies: 50 });
  expect(newWorldGen.value).toMatchObject({
    worldScale: 32,
    poiCount: 400,
    wanderers: 0,
    caravans: 13,
    armies: 20,
  });
  newWorldLand.value = 'lakes';
  const settings = newWorldSettings();
  expect(settings.mapStyle).toBe('lakes');
  expect(settings.worldScale).toBe(32);
  newWorldGen.value = defaultNewWorldGen();
  newWorldLand.value = 'random';
  expect(newWorldSettings()).toEqual(clampSettings({ ...DEFAULT_WORLD_SETTINGS }));
});

test('sameWorldSettings compares random land by the style the seed resolves to', () => {
  const want = clampSettings({ ...DEFAULT_WORLD_SETTINGS });
  const have = { ...want, mapStyle: resolveLandStyle('random', 7) };
  expect(sameWorldSettings(have, want, 7)).toBe(true);
  expect(sameWorldSettings(have, { ...want, worldScale: 32 }, 7)).toBe(false);
  expect(sameWorldSettings(have, { ...want, poiCount: 10 }, 7)).toBe(false);
});

test('saves carry the world settings and older saves load the default world', () => {
  const world = createWorld({ id: 'waystead', name: 'Waystead', x: 8, y: 8 });
  world.beginGeneratedWorld(3, {
    settings: clampSettings({
      ...DEFAULT_WORLD_SETTINGS,
      worldSource: 'island',
      worldScale: 2,
      mapStyle: 'archipelago',
      poiCount: 12,
      wanderers: 3,
    }),
  });
  const packed = world.toPacked({ gameVersion: 'test', cfPin: CF });
  expect(packed.worldSettings).toMatchObject({
    worldScale: 2,
    mapStyle: 'archipelago',
    poiCount: 12,
    wanderers: 3,
  });
  const roundTrip = JSON.parse(JSON.stringify(packed)) as typeof packed;
  const restored = savedWorldSettings(roundTrip);
  expect(restored).toEqual(world.data!.settings);

  const loaded = createWorld({ id: 'waystead', name: 'Waystead', x: 8, y: 8 });
  loaded.beginGeneratedWorld(roundTrip.worldSeed, { keepHero: true, settings: restored });
  loaded.load(roundTrip);
  expect(loaded.data!.width).toBe(world.data!.width);
  expect(loaded.data!.settings.mapStyle).toBe('archipelago');
  expect(loaded.hero.x).toBeCloseTo(world.hero.x, 5);

  const old = { ...roundTrip };
  delete old.worldSettings;
  // Saves from before world sources keep the classic island.
  expect(savedWorldSettings(old)).toEqual(
    clampSettings({
      ...DEFAULT_WORLD_SETTINGS,
      worldSource: 'island',
      homeChunk: null,
      terrainGen: 1,
    }),
  );
  // Planet saves from before seamless chunks keep the classic home map.
  const prePlanet = {
    ...roundTrip,
    worldSettings: { ...roundTrip.worldSettings, worldSource: 'trailbound', terrainGen: undefined },
  } as never;
  expect(savedWorldSettings(prePlanet).terrainGen).toBe(1);
  const garbage = { ...roundTrip, worldSettings: { worldScale: 5 } as never };
  expect(savedWorldSettings(garbage).worldScale).toBe(16);
});

test('a 32× world generates end to end', () => {
  const world = generateWorld(7, clampSettings({ ...DEFAULT_WORLD_SETTINGS, worldScale: 32 }));
  expect(world.width).toBe(6144);
  expect(world.height).toBe(6144);
  expect(world.heightM.length).toBe(6144 * 6144);
  expect(world.biomes.length).toBe(6144 * 6144);
  expect(world.nodes.length).toBeGreaterThan(0);
  expect(world.pois.length).toBe(DEFAULT_WORLD_SETTINGS.poiCount);
  let land = 0;
  for (let i = 0; i < world.biomes.length; i += 997) if (world.biomes[i] !== 0) land++;
  expect(land).toBeGreaterThan(0);
  for (const node of world.nodes) {
    expect(node.cx).toBeGreaterThan(0);
    expect(node.cx).toBeLessThan(6144);
  }
});
