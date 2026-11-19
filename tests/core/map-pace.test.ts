import { expect, test } from 'vitest';
import {
  CARAVAN_TILES_PER_UNIT,
  createCaravan,
  setRoute,
  type CaravanState,
} from '../../src/core/sim/caravan';
import {
  MAP_SPEEDS,
  caravanStatus,
  formatMapSpeed,
  mapTimeRuns,
  normalizeMapSpeed,
} from '../../src/core/sim/map-pace';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/state/settings';
import { WorldState } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import {
  Biome,
  DEFAULT_WORLD_SETTINGS,
  GAME_HOURS_PER_REAL_SEC,
  METERS_PER_WORLD_TILE,
  paceMps,
  type WorldData,
} from '../../src/core/world/models';

function rolling(): CaravanState {
  const tiles = 20 * CARAVAN_TILES_PER_UNIT;
  return setRoute(
    createCaravan(2, 20.5),
    [
      { x: 2, y: 20.5 },
      { x: 2 + tiles, y: 20.5 },
    ],
    [{ x: 2 + tiles, y: 20.5, name: 'Far', placeId: null }],
    null,
  );
}

function plains(size = 128): WorldData {
  const n = size * size;
  return {
    seed: 9,
    width: size,
    height: size,
    settings: { ...DEFAULT_WORLD_SETTINGS, worldScale: 1 },
    biomes: new Uint8Array(n).fill(Biome.Plains),
    heightM: new Float32Array(n).fill(40),
    heights: new Float32Array(n).fill(metersToNormalized(40)),
    paths: new Uint8Array(n),
    nodes: [],
    pois: [],
    features: [],
  };
}

function worldWithRoute(): WorldState {
  const world = new WorldState();
  world.data = plains();
  world.seed = 9;
  world.caravan = rolling();
  return world;
}

test('map speed steps are 1x, 2x, 4x, 8x and anything else falls back to 1x', () => {
  expect([...MAP_SPEEDS]).toEqual([1, 2, 4, 8]);
  expect(normalizeMapSpeed(4)).toBe(4);
  expect(normalizeMapSpeed('8')).toBe(8);
  expect(normalizeMapSpeed(3)).toBe(1);
  expect(normalizeMapSpeed('fast')).toBe(1);
  expect(normalizeMapSpeed(undefined)).toBe(1);
  expect(formatMapSpeed(2)).toBe('2x');
});

test('settings default to time-only-when-moving on and 1x, and persist through normalize', () => {
  expect(DEFAULT_SETTINGS.timeOnlyWhenMoving).toBe(true);
  expect(DEFAULT_SETTINGS.mapSpeed).toBe(1);
  expect(normalizeSettings({}).timeOnlyWhenMoving).toBe(true);
  expect(normalizeSettings({}).mapSpeed).toBe(1);
  const saved = normalizeSettings({ timeOnlyWhenMoving: false, mapSpeed: 8 });
  expect(saved.timeOnlyWhenMoving).toBe(false);
  expect(saved.mapSpeed).toBe(8);
  expect(normalizeSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  expect(normalizeSettings({ timeOnlyWhenMoving: 'no', mapSpeed: 16 }).timeOnlyWhenMoving).toBe(
    true,
  );
  expect(normalizeSettings({ mapSpeed: 16 }).mapSpeed).toBe(1);
});

test('map time: hero walking always runs it; the rolling caravan only when the setting is off', () => {
  const idle = createCaravan(0, 0);
  const car = rolling();
  expect(mapTimeRuns(idle, true, true)).toBe(true);
  expect(mapTimeRuns(idle, true, false)).toBe(true);
  expect(mapTimeRuns(idle, false, true)).toBe(false);
  expect(mapTimeRuns(idle, false, false)).toBe(false);
  expect(mapTimeRuns(car, false, true)).toBe(false);
  expect(mapTimeRuns(car, false, false)).toBe(true);
  expect(mapTimeRuns({ ...car, halted: true }, false, false)).toBe(false);
  expect(mapTimeRuns({ ...car, halted: true }, true, true)).toBe(true);
});

test('caravan status says Waiting on the map while the clock is paused, Rolling in 3D', () => {
  const base = { hasRoute: true, halted: false, clockPaused: true, view: 'map' as const };
  expect(caravanStatus(base)).toBe('Waiting');
  expect(caravanStatus({ ...base, clockPaused: false })).toBe('Rolling');
  expect(caravanStatus({ ...base, view: 'area' })).toBe('Rolling');
  expect(caravanStatus({ ...base, halted: true })).toBe('Halted');
  expect(caravanStatus({ ...base, hasRoute: false })).toBe('No route');
});

test('on: an idle hero leaves the clock, caravan, and travellers frozen', () => {
  const world = worldWithRoute();
  const before = { clock: world.clockHours, along: world.caravan.along };
  for (let i = 0; i < 120; i++)
    expect(world.stepMapIdle(1 / 60, GAME_HOURS_PER_REAL_SEC, 1, true)).toBe(false);
  expect(world.clockHours).toBe(before.clock);
  expect(world.caravan.along).toBe(before.along);
});

test('on: walking runs the clock and the caravan advances with it', () => {
  const world = worldWithRoute();
  const clock = world.clockHours;
  const along = world.caravan.along;
  const metres = 4 * METERS_PER_WORLD_TILE;
  world.advanceTravel(metres, paceMps(false));
  expect(world.clockHours).toBeGreaterThan(clock);
  expect(world.caravan.along).toBeGreaterThan(along);
});

test('off: the rolling caravan runs the clock by itself, as before', () => {
  const world = worldWithRoute();
  const clock = world.clockHours;
  const along = world.caravan.along;
  expect(world.stepMapIdle(0.5, GAME_HOURS_PER_REAL_SEC, 1, false)).toBe(true);
  expect(world.clockHours).toBeGreaterThan(clock);
  expect(world.caravan.along).toBeGreaterThan(along);
  const bare = new WorldState();
  bare.data = plains();
  expect(bare.stepMapIdle(0.5, GAME_HOURS_PER_REAL_SEC, 1, false)).toBe(false);
});

test('speed scales the idle clock and the caravan together: 8x covers 8x', () => {
  const run = (speed: number) => {
    const world = worldWithRoute();
    const clock = world.clockHours;
    const along = world.caravan.along;
    for (let i = 0; i < 60; i++) world.stepMapIdle(1 / 60, GAME_HOURS_PER_REAL_SEC, speed, false);
    return { hours: world.clockHours - clock, along: world.caravan.along - along };
  };
  const one = run(1);
  for (const speed of [2, 4, 8]) {
    const fast = run(speed);
    expect(fast.hours / one.hours).toBeCloseTo(speed, 6);
    expect(fast.along / one.along).toBeCloseTo(speed, 3);
  }
});

test('speed scales a walk: the same frames at 8x charge 8x the clock without clipping', () => {
  const run = (speed: number) => {
    const world = worldWithRoute();
    const clock = world.clockHours;
    const along = world.caravan.along;
    // A walk frame at map pace: 3 tiles a frame, scaled by the speed step.
    for (let i = 0; i < 20; i++) {
      world.advanceTravel(3 * speed * METERS_PER_WORLD_TILE, paceMps(false), speed);
    }
    return { hours: world.clockHours - clock, along: world.caravan.along - along };
  };
  const one = run(1);
  const eight = run(8);
  expect(eight.hours / one.hours).toBeCloseTo(8, 6);
  expect(eight.along / one.along).toBeCloseTo(8, 3);
});

test('the sim budget grows with the speed step so a fast frame is not cut short', () => {
  const metres = 200 * METERS_PER_WORLD_TILE;
  const slow = new WorldState();
  slow.data = plains();
  const clipped = slow.advanceTravel(metres, paceMps(false), 1);
  const wide = new WorldState();
  wide.data = plains();
  const free = wide.advanceTravel(metres, paceMps(false), 8);
  expect(free).toBeGreaterThan(clipped);
  expect(free / clipped).toBeCloseTo(8, 6);
});
