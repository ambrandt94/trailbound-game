import { expect, test } from 'vitest';
import {
  CARAVAN_METERS_PER_UNIT,
  CARAVAN_TILES_PER_UNIT,
  createCaravan,
  setRoute,
} from '../../src/core/sim/caravan';
import {
  CONVOY_GONE_M,
  CONVOY_HOP_SHIFT_M,
  CONVOY_MPS,
  CONVOY_STREAM_RECUT,
  convoyLeftZone,
  zoneHopCentre,
  convoyClockHours,
  convoyRollMetres,
  metresToTiles,
} from '../../src/core/sim/convoy';
import {
  DEFAULT_ON_FOOT_SPEED,
  ON_FOOT_MAX,
  ON_FOOT_MIN,
  areaClockHours,
  formatOnFootSpeed,
  normalizeOnFootSpeed,
  onFootPaceMps,
  wagonMapPaceMps,
} from '../../src/core/sim/map-pace';
import { HOURS_PER_TU, areaHoursPerRealSec } from '../../src/core/sim/time';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/state/settings';
import { WorldState } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import {
  Biome,
  DEFAULT_WORLD_SETTINGS,
  GAME_HOURS_PER_REAL_SEC,
  GAME_SECONDS_PER_REAL_SEC,
  METERS_PER_WORLD_TILE,
  walkTilesPerSec,
  type WorldData,
} from '../../src/core/world/models';

const AREA_RATE = areaHoursPerRealSec(GAME_HOURS_PER_REAL_SEC);

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

function rollingWorld(): WorldState {
  const world = new WorldState();
  world.data = plains();
  world.seed = 9;
  const tiles = 20 * CARAVAN_TILES_PER_UNIT;
  world.caravan = setRoute(
    createCaravan(2, 20.5),
    [
      { x: 2, y: 20.5 },
      { x: 2 + tiles, y: 20.5 },
    ],
    [{ x: 2 + tiles, y: 20.5, name: 'Far', placeId: null }],
  );
  world.areaHold = true;
  return world;
}

test('3D clock runs with zero input, ignoring the map setting', () => {
  // The pure 3D clock takes no input and no timeOnlyWhenMoving.
  const hours = areaClockHours({
    paused: false,
    dt: 1,
    roadHours: null,
    areaHoursPerRealSec: AREA_RATE,
  });
  expect(hours).toBeCloseTo(AREA_RATE, 10);
  expect(hours).toBeGreaterThan(0);
  expect(DEFAULT_SETTINGS.timeOnlyWhenMoving).toBe(true);
});

test('3D clock while the wagon rolls pays by road; halted it still runs at the area rate', () => {
  const road = convoyClockHours(0.5, 1);
  expect(
    areaClockHours({ paused: false, dt: 1 / 60, roadHours: road, areaHoursPerRealSec: AREA_RATE }),
  ).toBe(road);
  // Halted at camp: no road rolled, the area clock keeps going.
  expect(
    areaClockHours({ paused: false, dt: 2, roadHours: null, areaHoursPerRealSec: AREA_RATE }),
  ).toBeCloseTo(2 * AREA_RATE, 10);
});

test('paused stops the 3D clock and the wagon', () => {
  expect(
    areaClockHours({ paused: true, dt: 1, roadHours: null, areaHoursPerRealSec: AREA_RATE }),
  ).toBe(0);
  expect(
    areaClockHours({ paused: true, dt: 1, roadHours: 0.1, areaHoursPerRealSec: AREA_RATE }),
  ).toBe(0);
  expect(convoyRollMetres({ rolling: true, paused: true, speedMod: 1, dt: 1 })).toBe(0);
  expect(
    areaClockHours({ paused: false, dt: 0, roadHours: null, areaHoursPerRealSec: AREA_RATE }),
  ).toBe(0);
});

test('the wagon rolls at 1x pace with no input, and not when halted or routeless', () => {
  expect(convoyRollMetres({ rolling: true, paused: false, speedMod: 1, dt: 2 })).toBeCloseTo(
    2 * CONVOY_MPS,
    10,
  );
  expect(convoyRollMetres({ rolling: false, paused: false, speedMod: 1, dt: 2 })).toBe(0);
});

test('a world with a rolling route advances by the wagon metres and the 3D clock, step after step', () => {
  const world = rollingWorld();
  const clock0 = world.clockHours;
  const along0 = world.caravan.along;
  for (let i = 0; i < 30 * 60; i++) {
    const dt = 1 / 60;
    const metres = convoyRollMetres({ rolling: true, paused: false, speedMod: 1, dt });
    const units = world.rollConvoy(metresToTiles(metres));
    const road = units > 0 ? convoyClockHours(units, 1) : null;
    const h = areaClockHours({
      paused: false,
      dt,
      roadHours: road,
      areaHoursPerRealSec: AREA_RATE,
    });
    world.advanceClock(1, h);
  }
  expect((world.caravan.along - along0) * METERS_PER_WORLD_TILE).toBeCloseTo(30 * CONVOY_MPS, 1);
  expect(world.clockHours - clock0).toBeCloseTo(
    convoyClockHours((30 * CONVOY_MPS) / CARAVAN_METERS_PER_UNIT, 1),
    4,
  );
});

test('on-foot speed: default 1.25, clamped to 1.0-2.0, snapped to 0.05', () => {
  expect(DEFAULT_ON_FOOT_SPEED).toBe(1.25);
  expect(DEFAULT_SETTINGS.onFootSpeed).toBe(1.25);
  expect(normalizeSettings({}).onFootSpeed).toBe(1.25);
  expect(normalizeOnFootSpeed(0.5)).toBe(ON_FOOT_MIN);
  expect(normalizeOnFootSpeed(9)).toBe(ON_FOOT_MAX);
  expect(normalizeOnFootSpeed('1.5')).toBe(1.5);
  expect(normalizeOnFootSpeed(1.33)).toBe(1.35);
  expect(normalizeOnFootSpeed(1.62)).toBe(1.6);
  expect(normalizeOnFootSpeed('fast')).toBe(1.25);
  expect(normalizeOnFootSpeed(NaN)).toBe(1.25);
  expect(normalizeOnFootSpeed(undefined)).toBe(1.25);
  expect(normalizeSettings({ onFootSpeed: 1.8 }).onFootSpeed).toBe(1.8);
  expect(normalizeSettings({ onFootSpeed: 7 }).onFootSpeed).toBe(2);
  expect(formatOnFootSpeed(1.25)).toBe('1.25x');
  const saved = normalizeSettings({ onFootSpeed: 1.4 });
  expect(normalizeSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
});

test('on-foot pace is the wagon map pace times the multiplier; sprint doubles it', () => {
  const wagon = (CARAVAN_METERS_PER_UNIT * 1) / (HOURS_PER_TU * 3600);
  expect(wagonMapPaceMps()).toBeCloseTo(wagon, 12);
  expect(onFootPaceMps(1.25)).toBeCloseTo(wagon * 1.25, 12);
  expect(onFootPaceMps(1)).toBeCloseTo(wagon, 12);
  expect(onFootPaceMps(99)).toBeCloseTo(wagon * 2, 12);
  expect(onFootPaceMps(1.25, true)).toBeCloseTo(wagon * 2.5, 12);
});

test('walking at the default pace outruns the rolling caravan by about 1.25x, not 37x', () => {
  const world = rollingWorld();
  world.areaHold = false;
  const pace = onFootPaceMps(DEFAULT_ON_FOOT_SPEED);
  const tilesPerSec = walkTilesPerSec(pace, 0.05, pace);
  expect(tilesPerSec).toBeCloseTo((pace * GAME_SECONDS_PER_REAL_SEC) / METERS_PER_WORLD_TILE, 8);
  const along = world.caravan.along;
  // Frame by frame, as the map does: each frame walks 1/60 s of the on-screen pace.
  const stepM = (tilesPerSec / 60) * METERS_PER_WORLD_TILE;
  let walked = 0;
  for (let i = 0; i < 120; i++) {
    world.advanceTravel(stepM, pace);
    walked += stepM;
  }
  const rolled = (world.caravan.along - along) * METERS_PER_WORLD_TILE;
  // Hero covers 'walked' metres while the wagon covers walked / 1.25.
  expect(walked / rolled).toBeCloseTo(DEFAULT_ON_FOOT_SPEED, 1);
});

test('the zoom slowdown is measured against the on-foot pace, so a slow walker is not slowed twice', () => {
  const pace = onFootPaceMps(1.25);
  expect(walkTilesPerSec(pace, 0.05, pace)).toBeGreaterThan(0);
  // At street zoom the screen speed holds near MAP_WALK_SCREEN_PX/(scale*TILE) or the walk, whichever is slower.
  const far = walkTilesPerSec(pace, 0.05, pace);
  const near = walkTilesPerSec(pace, 3.6, pace);
  expect(near).toBeLessThanOrEqual(far);
  expect(walkTilesPerSec(0, 1)).toBe(0);
});

test('the wagon has left the zone only once it is well past the playable edge', () => {
  expect(convoyLeftZone(10)).toBe(false);
  expect(convoyLeftZone(0)).toBe(false);
  expect(convoyLeftZone(-CONVOY_GONE_M)).toBe(false);
  expect(convoyLeftZone(-CONVOY_GONE_M - 0.1)).toBe(true);
  // Streaming ahead is off: the zone-exit model is the default.
  expect(CONVOY_STREAM_RECUT).toBe(false);
});

test('a zone hop centres the new zone toward the wagon, never more than 34 m from the exit', () => {
  const exit = { x: 100, y: 100 };
  const near = zoneHopCentre(exit, { x: 100 + metresToTiles(20), y: 100 });
  expect(near.x).toBeCloseTo(100 + metresToTiles(10), 8);
  expect(near.y).toBeCloseTo(100, 8);
  const far = zoneHopCentre(exit, { x: 100, y: 100 - metresToTiles(300) });
  expect(far.x).toBeCloseTo(100, 8);
  expect(far.y).toBeCloseTo(100 - metresToTiles(CONVOY_HOP_SHIFT_M), 8);
  expect(zoneHopCentre(exit, exit)).toEqual(exit);
});
