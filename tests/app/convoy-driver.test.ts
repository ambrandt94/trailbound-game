import { expect, test } from 'vitest';
import { ConvoyDriver } from '../../src/app/convoy-driver';
import { CARAVAN_TILES_PER_UNIT, createCaravan, setRoute } from '../../src/core/sim/caravan';
import { CONVOY_MPS, CONVOY_RECUT_EDGE_M, convoyRoom } from '../../src/core/sim/convoy';
import { HOURS_PER_TU } from '../../src/core/sim/time';
import { WorldState } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import { Biome, DEFAULT_WORLD_SETTINGS, METERS_PER_WORLD_TILE } from '../../src/core/world/models';

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
    null,
  );
  return world;
}

test('the wagon rolls at the convoy pace and the clock is paid by road', () => {
  const world = flatWorld();
  const handoff = world.buildConvoyHandoff()!;
  const driver = new ConvoyDriver(() => world, handoff.convoy!);
  const speedMod = world.caravanSpeedAt();
  const start = world.caravan.along;
  let hours = 0;
  for (let i = 0; i < 60; i++) {
    driver.step(1 / 60);
    hours += driver.clockHours() ?? 0;
  }
  const metres = (world.caravan.along - start) * METERS_PER_WORLD_TILE;
  expect(metres).toBeCloseTo(CONVOY_MPS * speedMod, 3);
  expect(driver.frame().speed).toBeCloseTo(CONVOY_MPS * speedMod, 3);
  const units = metres / (CARAVAN_TILES_PER_UNIT * METERS_PER_WORLD_TILE);
  expect(hours).toBeCloseTo((units / speedMod) * HOURS_PER_TU, 6);
  // A halted wagon does not roll and does not charge by road.
  world.setCaravanHalted(true);
  driver.step(1);
  expect(driver.frame().speed).toBe(0);
  expect(driver.clockHours()).toBeNull();
});

test('the next window is cut early, fits the wagon at the swap, and the swap lands on the line', () => {
  const world = flatWorld();
  const first = world.buildConvoyHandoff()!;
  const driver = new ConvoyDriver(() => world, first.convoy!);
  let prepared: ReturnType<typeof world.buildConvoyHandoff> = null;
  let swapRoom = 0;
  let steps = 0;
  const dt = 1 / 30;
  for (; steps < 30 * 60; steps++) {
    driver.step(dt);
    const action = driver.recutAction(prepared !== null, false);
    if (action === 'prepare') {
      expect(prepared).toBeNull();
      prepared = world.buildConvoyHandoff(driver.recutCentre().x, driver.recutCentre().y, false);
      // Cutting ahead does not touch the current place.
      expect(world.town?.id).toBe(first.convoy!.town.id);
    }
    if (action === 'swap') {
      swapRoom = driver.room();
      break;
    }
  }
  expect(prepared?.convoy).toBeTruthy();
  expect(steps).toBeLessThan(30 * 60);
  // The swap fires as the wagon crosses the line, not before.
  expect(swapRoom).toBeLessThan(CONVOY_RECUT_EDGE_M);
  expect(swapRoom).toBeGreaterThan(CONVOY_RECUT_EDGE_M - CONVOY_MPS * 1.2 * dt - 0.5);
  // The window cut ahead holds the wagon with room to spare.
  expect(driver.fits(prepared!.convoy!)).toBe(true);
  const fresh = new ConvoyDriver(() => world, prepared!.convoy!);
  expect(fresh.room()).toBeGreaterThan(CONVOY_RECUT_EDGE_M + 2);
  // And the new window does not ask for another cut right away.
  expect(fresh.recutAction(false, false)).toBe('none');
  expect(convoyRoom(fresh.frame(), prepared!.convoy!.bounds)).toBeGreaterThan(18);
});

test('a new route throws the cached crossing away', () => {
  const world = flatWorld();
  const first = world.buildConvoyHandoff()!;
  const driver = new ConvoyDriver(() => world, first.convoy!);
  const a = driver.recutCentre();
  world.caravan = setRoute(
    createCaravan(10, 40.5),
    [
      { x: 10, y: 40.5 },
      { x: 10, y: 40.5 + 60 * CARAVAN_TILES_PER_UNIT },
    ],
    [{ x: 10, y: 40.5 + 60 * CARAVAN_TILES_PER_UNIT, name: 'South', placeId: null }],
    null,
  );
  const b = driver.recutCentre();
  expect(Math.abs(b.y - a.y)).toBeGreaterThan(5);
});
