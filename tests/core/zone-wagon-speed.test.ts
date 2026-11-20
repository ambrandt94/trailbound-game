import { expect, test, vi } from 'vitest';
import { ConvoyDriver } from '../../src/app/convoy-driver';
import { CARAVAN_TILES_PER_UNIT, createCaravan, setRoute } from '../../src/core/sim/caravan';
import {
  AUTO_JOG_MPS,
  CONVOY_MPS,
  convoyClockHours,
  convoyMps,
  convoyRollMetres,
  followCap,
  FOLLOW_CATCHUP_MPS,
  FOLLOW_RUN_MPS,
  FOLLOW_SPRINT_MPS,
  LEASH_HINT_M,
} from '../../src/core/sim/convoy';
import {
  DEFAULT_ZONE_WAGON_SPEED,
  ZONE_WAGON_MAX,
  ZONE_WAGON_MIN,
  ZONE_WAGON_STEP,
  formatZoneWagonSpeed,
  normalizeMapSpeed,
  normalizeZoneWagonSpeed,
} from '../../src/core/sim/map-pace';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/state/settings';
import { WorldState } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import { Biome, DEFAULT_WORLD_SETTINGS, METERS_PER_WORLD_TILE } from '../../src/core/world/models';

vi.setConfig({ testTimeout: 60_000 });

function flatWorld(): WorldState {
  const size = 96;
  const n = size * size;
  const world = new WorldState();
  world.seed = 4411;
  world.data = {
    seed: 4411,
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
  const tiles = 60 * CARAVAN_TILES_PER_UNIT;
  world.caravan = setRoute(
    createCaravan(10, 40.5),
    [
      { x: 10, y: 40.5 },
      { x: 10 + tiles, y: 40.5 },
    ],
    [{ x: 10 + tiles, y: 40.5, name: 'Far', placeId: null }],
  );
  return world;
}

test('zone wagon speed: default 2.5 m/s, 1.0-6.0 in 0.25 steps, junk falls back', () => {
  expect(DEFAULT_ZONE_WAGON_SPEED).toBe(2.5);
  expect(DEFAULT_ZONE_WAGON_SPEED).toBe(CONVOY_MPS);
  expect(DEFAULT_SETTINGS.zoneWagonSpeed).toBe(2.5);
  expect(ZONE_WAGON_MIN).toBe(1);
  expect(ZONE_WAGON_MAX).toBe(6);
  expect(ZONE_WAGON_STEP).toBe(0.25);
  expect(normalizeZoneWagonSpeed(0.2)).toBe(1);
  expect(normalizeZoneWagonSpeed(40)).toBe(6);
  expect(normalizeZoneWagonSpeed('3.5')).toBe(3.5);
  expect(normalizeZoneWagonSpeed(3.3)).toBe(3.25);
  expect(normalizeZoneWagonSpeed(3.4)).toBe(3.5);
  expect(normalizeZoneWagonSpeed('fast')).toBe(2.5);
  expect(normalizeZoneWagonSpeed('')).toBe(2.5);
  expect(normalizeZoneWagonSpeed(Number.NaN)).toBe(2.5);
  expect(normalizeZoneWagonSpeed(Number.POSITIVE_INFINITY)).toBe(2.5);
  expect(normalizeZoneWagonSpeed(undefined)).toBe(2.5);
  expect(normalizeZoneWagonSpeed(null)).toBe(2.5);
  expect(formatZoneWagonSpeed(2.5)).toBe('2.50 m/s (1.00x)');
  expect(formatZoneWagonSpeed(5)).toBe('5.00 m/s (2.00x)');
  expect(formatZoneWagonSpeed(1)).toBe('1.00 m/s (0.40x)');
});

test('zone wagon speed settings: old saves get the default, saves round-trip', () => {
  // A save from before the setting has no key at all.
  const old = normalizeSettings({ master: 50, mapSpeed: 4, onFootSpeed: 1.5 });
  expect(old.zoneWagonSpeed).toBe(2.5);
  expect(old.mapSpeed).toBe(4);
  expect(normalizeSettings({}).zoneWagonSpeed).toBe(2.5);
  expect(normalizeSettings(null).zoneWagonSpeed).toBe(2.5);
  expect(normalizeSettings({ zoneWagonSpeed: 4.25 }).zoneWagonSpeed).toBe(4.25);
  expect(normalizeSettings({ zoneWagonSpeed: 99 }).zoneWagonSpeed).toBe(6);
  expect(normalizeSettings({ zoneWagonSpeed: -3 }).zoneWagonSpeed).toBe(1);
  expect(normalizeSettings({ zoneWagonSpeed: 'x' }).zoneWagonSpeed).toBe(2.5);
  const saved = normalizeSettings({ zoneWagonSpeed: 3.75, mapSpeed: 8 });
  expect(normalizeSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
});

test('the zone and map speed settings are independent', () => {
  const a = normalizeSettings({ mapSpeed: 8 });
  expect(a.zoneWagonSpeed).toBe(2.5);
  const b = normalizeSettings({ ...a, zoneWagonSpeed: 5 });
  expect(b.mapSpeed).toBe(8);
  expect(b.zoneWagonSpeed).toBe(5);
  // The map speed normalises on its own, and the zone pace never reads it.
  expect(normalizeMapSpeed(8)).toBe(8);
  expect(convoyRollMetres({ rolling: true, paused: false, speedMod: 1, dt: 1 })).toBeCloseTo(
    CONVOY_MPS,
    9,
  );
});

test('convoyMps and convoyRollMetres use the zone speed, with terrain on top', () => {
  expect(convoyMps(1, 4)).toBeCloseTo(4, 9);
  expect(convoyMps(1.1, 4)).toBeCloseTo(4.4, 9);
  expect(convoyMps(0.5, 6)).toBeCloseTo(3, 9);
  // No base given, or a bad one: the default.
  expect(convoyMps(1)).toBeCloseTo(CONVOY_MPS, 9);
  expect(convoyMps(1, Number.NaN)).toBeCloseTo(CONVOY_MPS, 9);
  expect(convoyMps(1, 0)).toBeCloseTo(CONVOY_MPS, 9);
  const base = { rolling: true, paused: false, speedMod: 1, dt: 0.5 };
  expect(convoyRollMetres({ ...base, baseMps: 4 })).toBeCloseTo(2, 9);
  expect(convoyRollMetres({ ...base, baseMps: 1 })).toBeCloseTo(0.5, 9);
  expect(convoyRollMetres({ ...base, baseMps: 6, speedMod: 0.9 })).toBeCloseTo(2.7, 9);
  expect(convoyRollMetres(base)).toBeCloseTo(CONVOY_MPS * 0.5, 9);
  expect(convoyRollMetres({ ...base, baseMps: 4, paused: true })).toBe(0);
  expect(convoyRollMetres({ ...base, baseMps: 4, rolling: false })).toBe(0);
});

test('the driver reads the zone speed live, and the clock still pays by distance', () => {
  const world = flatWorld();
  const handoff = world.buildConvoyHandoff()!;
  let setting = 2.5;
  const driver = new ConvoyDriver(
    () => world,
    handoff.convoy!,
    false,
    () => setting,
  );
  const speedMod = world.caravanSpeedAt();
  const run = (seconds: number) => {
    const start = world.caravan.along;
    let hours = 0;
    for (let i = 0; i < seconds * 60; i++) {
      driver.step(1 / 60);
      hours += driver.clockHours() ?? 0;
    }
    return { metres: (world.caravan.along - start) * METERS_PER_WORLD_TILE, hours };
  };
  const slow = run(2);
  expect(slow.metres).toBeCloseTo(2.5 * speedMod * 2, 3);
  expect(driver.frame().speed).toBeCloseTo(2.5 * speedMod, 3);
  // Move the slider mid-trip: the very next step uses it, no rebuild.
  setting = 5;
  const fast = run(2);
  expect(fast.metres).toBeCloseTo(5 * speedMod * 2, 3);
  expect(driver.frame().speed).toBeCloseTo(5 * speedMod, 3);
  setting = 1;
  expect(run(2).metres).toBeCloseTo(1 * speedMod * 2, 3);
  // Same road costs the same TU whatever the speed.
  expect(fast.hours / fast.metres).toBeCloseTo(slow.hours / slow.metres, 9);
  const units = fast.metres / (CARAVAN_TILES_PER_UNIT * METERS_PER_WORLD_TILE);
  expect(fast.hours).toBeCloseTo(convoyClockHours(units, speedMod), 6);
});

test('the hero keeps up at any zone speed: the follow cap rises with the wagon', () => {
  // Default pace: a walk beside it, under the jog line, with catch-up room.
  expect(CONVOY_MPS * 1.1).toBeLessThan(AUTO_JOG_MPS);
  expect(followCap(CONVOY_MPS, 5)).toBeLessThan(AUTO_JOG_MPS + FOLLOW_CATCHUP_MPS);
  expect(followCap(CONVOY_MPS, 5)).toBeGreaterThanOrEqual(FOLLOW_RUN_MPS);
  // Slider max (6 m/s, 6.6 on a good road): the cap stays above the wagon, and the sprint above the cap.
  const top = 6 * 1.1;
  expect(followCap(top, 5)).toBeGreaterThan(top);
  expect(followCap(top, LEASH_HINT_M + 1)).toBeGreaterThan(followCap(top, 5));
  expect(followCap(0, LEASH_HINT_M + 1)).toBe(FOLLOW_SPRINT_MPS);
  expect(followCap(Number.NaN, 1)).toBe(FOLLOW_RUN_MPS);
});
