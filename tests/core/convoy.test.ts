import { expect, test } from 'vitest';
import { GROUND, decodeB64U8 } from '../../src/core/area/build-area';
import { cutConvoyWindow, resolveConvoyArea } from '../../src/core/area/area-window';
import {
  CARAVAN_TILES_PER_UNIT,
  advanceCaravan,
  advanceCaravanTiles,
  createCaravan,
  mapClockRuns,
  setRoute,
  type CaravanStepEnv,
} from '../../src/core/sim/caravan';
import {
  BENCH_REACH_M,
  CONVOY_BENCH,
  CONVOY_RECUT_EDGE_M,
  CONVOY_SIDE_M,
  FOLLOW_RUN_MPS,
  FOLLOW_SPRINT_MPS,
  LEASH_HINT_M,
  LEASH_PULL_M,
  areaYawToMap,
  convoyBench,
  convoyClockMps,
  convoyMps,
  convoyNeedsRecut,
  convoySlot,
  followVelocity,
  leashState,
  localToTile,
  mapYawToArea,
  metresToTiles,
  nextConvoyMode,
  stickFor,
  tileToLocal,
  type ConvoyModeInput,
} from '../../src/core/sim/convoy';
import { WorldState } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import { Biome, DEFAULT_WORLD_SETTINGS, type WorldData } from '../../src/core/world/models';

const even: CaravanStepEnv = { day: 0, speedAt: () => 1, settlementAt: () => null };

function straight(units: number, from = { x: 0, y: 0 }) {
  const tiles = units * CARAVAN_TILES_PER_UNIT;
  return setRoute(
    createCaravan(from.x, from.y),
    [from, { x: from.x + tiles, y: from.y }],
    [{ x: from.x + tiles, y: from.y, name: 'Far', placeId: null }],
    null,
  );
}

function plains(seed: number, size = 48): WorldData {
  const n = size * size;
  const biomes = new Uint8Array(n).fill(Biome.Plains);
  return {
    seed,
    width: size,
    height: size,
    settings: { ...DEFAULT_WORLD_SETTINGS, worldScale: 1 },
    biomes,
    heightM: new Float32Array(n).fill(40),
    heights: new Float32Array(n).fill(metersToNormalized(40)),
    paths: new Uint8Array(n),
    nodes: [],
    pois: [],
    features: [],
  };
}

test('the map clock runs only while the caravan rolls or the hero walks', () => {
  const idle = createCaravan(0, 0);
  expect(mapClockRuns(idle, false)).toBe(false);
  expect(mapClockRuns(idle, true)).toBe(true);
  const rolling = straight(10);
  expect(mapClockRuns(rolling, false)).toBe(true);
  expect(mapClockRuns({ ...rolling, halted: true }, false)).toBe(false);
  expect(mapClockRuns({ ...rolling, halted: true }, true)).toBe(true);
  expect(mapClockRuns({ ...rolling, along: rolling.length }, false)).toBe(false);
});

test('rolling by tiles matches rolling by clock and stops at the end', () => {
  const byClock = advanceCaravan(straight(20), 3, even);
  const byTiles = advanceCaravanTiles(straight(20), 3 * CARAVAN_TILES_PER_UNIT, even);
  expect(byTiles.units).toBeCloseTo(byClock.units, 6);
  expect(byTiles.caravan.x).toBeCloseTo(byClock.caravan.x, 6);
  const past = advanceCaravanTiles(straight(2), 999, even);
  expect(past.caravan.along).toBeCloseTo(past.caravan.length, 6);
  expect(past.events.some((event) => event.type === 'arrived')).toBe(true);
  expect(advanceCaravanTiles(straight(2), -1, even).units).toBe(0);
  expect(advanceCaravanTiles({ ...straight(2), halted: true }, 4, even).units).toBe(0);
});

test('convoy pace: a walking ox in 3D, with the clock-true pace on hand', () => {
  expect(convoyMps(1)).toBeCloseTo(1.3, 6);
  expect(convoyMps(0.8)).toBeCloseTo(1.04, 6);
  expect(convoyMps(Number.NaN)).toBeCloseTo(1.3, 6);
  expect(convoyClockMps(1)).toBeGreaterThan(5.5);
  expect(convoyClockMps(1)).toBeLessThan(6.2);
  expect(metresToTiles(32)).toBeCloseTo(4, 6);
});

test('tile and local metres round-trip, and yaw maps between map and area', () => {
  const frame = { innerOrigin: { x: 96, y: 160 }, metersPerTile: 1 };
  const local = tileToLocal(frame, 14, 22);
  expect(local).toEqual({ x: 14 * 8 - 96, z: 22 * 8 - 160 });
  const back = localToTile(frame, local.x, local.z);
  expect(back.x).toBeCloseTo(14, 9);
  expect(back.y).toBeCloseTo(22, 9);
  // Map yaw 0 faces north (−y); in the area that is −z, facing (sin, cos).
  const north = mapYawToArea(0);
  expect(Math.sin(north)).toBeCloseTo(0, 9);
  expect(Math.cos(north)).toBeCloseTo(-1, 9);
  // Map yaw π/2 faces east (+x) on both.
  expect(Math.sin(mapYawToArea(Math.PI / 2))).toBeCloseTo(1, 9);
  expect(areaYawToMap(mapYawToArea(0.7))).toBeCloseTo(0.7, 9);
});

test('the walking slot sits on the wagon left, the bench up front', () => {
  // Facing +z (yaw 0): left is +x.
  const wagon = { x: 10, z: 20, yaw: 0, speed: 1.3 };
  const slot = convoySlot(wagon);
  expect(slot.x).toBeCloseTo(10 + CONVOY_SIDE_M, 6);
  expect(slot.z).toBeGreaterThan(20);
  // Facing +x (yaw π/2): left is −z.
  const east = convoySlot({ ...wagon, yaw: Math.PI / 2 });
  expect(east.z).toBeCloseTo(20 - CONVOY_SIDE_M, 6);
  const bench = convoyBench(wagon, 3);
  expect(bench.y).toBeCloseTo(3 + CONVOY_BENCH.y, 6);
  expect(bench.z).toBeCloseTo(20 + CONVOY_BENCH.z, 6);
  expect(bench.yaw).toBe(0);
});

test('follow keeps pace on the slot, catches up at a run, sprints past the leash', () => {
  const wagon = { x: 0, z: 0, yaw: 0, speed: 1.3 };
  const slot = convoySlot(wagon);
  const on = followVelocity(slot, wagon);
  expect(on.vx).toBeCloseTo(0, 6);
  expect(on.vz).toBeCloseTo(1.3, 6);
  const parked = followVelocity(slot, { ...wagon, speed: 0 });
  expect(Math.hypot(parked.vx, parked.vz)).toBe(0);
  const behind = followVelocity({ x: slot.x, z: slot.z - 10 }, wagon);
  expect(Math.hypot(behind.vx, behind.vz)).toBeCloseTo(FOLLOW_RUN_MPS, 6);
  const far = followVelocity({ x: slot.x, z: slot.z - 60 }, wagon);
  expect(Math.hypot(far.vx, far.vz)).toBeCloseTo(FOLLOW_SPRINT_MPS, 6);
  expect(far.vz).toBeGreaterThan(0);
});

test('stickFor is the inverse of the motor camera mapping', () => {
  for (const cam of [0, 37, 180, 271]) {
    const stick = stickFor(0.6, -0.8, cam);
    const th = (cam * Math.PI) / 180;
    const mx = Math.cos(th) * stick.ix - Math.sin(th) * stick.iz;
    const mz = -Math.sin(th) * stick.ix - Math.cos(th) * stick.iz;
    expect(mx).toBeCloseTo(0.6, 6);
    expect(mz).toBeCloseTo(-0.8, 6);
    expect(stick.speed).toBeCloseTo(1, 6);
  }
  expect(stickFor(0.01, 0, 0).speed).toBe(0);
});

test('leash: hint past 30 m, pull past 40 m only without input', () => {
  expect(leashState(LEASH_HINT_M - 1, false)).toBe('ok');
  expect(leashState(LEASH_HINT_M + 1, false)).toBe('hint');
  expect(leashState(LEASH_PULL_M + 1, true)).toBe('hint');
  expect(leashState(LEASH_PULL_M + 1, false)).toBe('pull');
});

test('convoy modes: walk until input, bench toggles, free re-latches or is pulled back', () => {
  const base: ConvoyModeInput = {
    mode: 'walk',
    hasInput: false,
    dist: 3,
    slotDist: 0.3,
    idleSec: 0,
    bench: false,
    rejoin: false,
  };
  expect(nextConvoyMode(base)).toBe('walk');
  expect(nextConvoyMode({ ...base, hasInput: true })).toBe('free');
  expect(nextConvoyMode({ ...base, bench: true })).toBe('bench');
  expect(nextConvoyMode({ ...base, mode: 'bench', bench: true })).toBe('walk');
  expect(nextConvoyMode({ ...base, mode: 'bench' })).toBe('bench');
  expect(nextConvoyMode({ ...base, mode: 'bench', hasInput: true })).toBe('free');
  const free = { ...base, mode: 'free' as const, dist: 20, slotDist: 18 };
  expect(nextConvoyMode(free)).toBe('free');
  expect(nextConvoyMode({ ...free, rejoin: true })).toBe('walk');
  // Too far to climb aboard: the bench key walks the hero back first.
  expect(nextConvoyMode({ ...free, bench: true })).toBe('walk');
  expect(nextConvoyMode({ ...free, dist: BENCH_REACH_M, bench: true })).toBe('bench');
  expect(nextConvoyMode({ ...free, dist: LEASH_PULL_M + 1 })).toBe('walk');
  expect(nextConvoyMode({ ...free, dist: LEASH_PULL_M + 1, hasInput: true })).toBe('free');
  expect(nextConvoyMode({ ...free, slotDist: 1, idleSec: 1 })).toBe('walk');
  expect(nextConvoyMode({ ...free, slotDist: 1, idleSec: 0.2 })).toBe('free');
});

test('a re-cut is due near the playable edge', () => {
  const bounds = { minX: 32, maxX: 128, minZ: 32, maxZ: 128 };
  expect(convoyNeedsRecut({ x: 80, z: 80 }, bounds)).toBe(false);
  expect(convoyNeedsRecut({ x: 128 - CONVOY_RECUT_EDGE_M + 1, z: 80 }, bounds)).toBe(true);
  expect(convoyNeedsRecut({ x: 80, z: 32 + CONVOY_RECUT_EDGE_M - 1 }, bounds)).toBe(true);
});

test('convoy windows centre on the wagon, not the snapped grid', () => {
  const world = plains(5);
  const a = cutConvoyWindow(world, 20.3, 20.6);
  expect(a.x0).toBe(14);
  expect(a.y0).toBe(15);
  expect(a.x1 - a.x0).toBe(12);
  expect(a.id).toBe('convoy-14-15');
  const edge = cutConvoyWindow(world, 1, 47);
  expect(edge.x0).toBe(0);
  expect(edge.y1).toBe(48);
  expect(resolveConvoyArea(world, 20.3, 20.6)?.cacheKey).toBe('convoy:14:15');
  const wet = plains(5);
  for (let i = 0; i < wet.biomes.length; i++) {
    wet.biomes[i] = Biome.Water;
    wet.heightM[i] = -80;
    wet.heights[i] = metersToNormalized(-80);
  }
  expect(resolveConvoyArea(wet, 20, 20)).toBeNull();
});

test('a convoy handoff paints the route as a dirt track with the wagon inside', () => {
  const world = new WorldState();
  world.data = plains(4411);
  world.seed = 4411;
  world.caravan = straight(6, { x: 8, y: 20.5 });
  world.caravan = { ...world.caravan, along: 12, x: 20, y: 20.5 };
  const handoff = world.buildConvoyHandoff();
  expect(handoff?.convoy).toBeTruthy();
  if (!handoff?.convoy) return;
  const { frame, bounds } = handoff.convoy;
  const wagon = tileToLocal(frame, 20, 20.5);
  expect(wagon.x).toBeGreaterThan(bounds.minX + 30);
  expect(wagon.x).toBeLessThan(bounds.maxX - 30);
  expect(bounds.maxX - bounds.minX).toBeCloseTo(96, 6);
  const grid = handoff.areaExport.grid;
  const ground = decodeB64U8(handoff.areaExport.layers.ground.data);
  const cell = (x: number, z: number) =>
    ground[Math.floor(x / frame.metersPerTile) + Math.floor(z / frame.metersPerTile) * grid.w];
  expect(cell(wagon.x, wagon.z)).toBe(GROUND.dirt);
  expect(cell(wagon.x + 20, wagon.z)).toBe(GROUND.dirt);
  expect(cell(wagon.x, wagon.z + 12)).toBe(GROUND.grass);
  expect(handoff.areaExport.area.settlement).toBeUndefined();
  // Without a route there is no convoy: today's area at the hero stands.
  world.caravan = createCaravan(20, 20.5);
  expect(world.buildConvoyHandoff()).toBeNull();
});
