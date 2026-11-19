import { expect, test } from 'vitest';
import { ConvoyDriver } from '../../src/app/convoy-driver';
import { CARAVAN_TILES_PER_UNIT, createCaravan, setRoute } from '../../src/core/sim/caravan';
import { CONVOY_GONE_M, convoyRoom, tileToLocal } from '../../src/core/sim/convoy';
import { onFootPaceMps } from '../../src/core/sim/map-pace';
import { WorldState } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import { Biome, DEFAULT_WORLD_SETTINGS, METERS_PER_WORLD_TILE } from '../../src/core/world/models';

/** A real seeded continent, as a New game makes it, routed to Saltgate the way a map click does. */
function newGameRouted(): WorldState {
  const world = new WorldState();
  world.beginGeneratedWorld();
  const node = world.data!.nodes.find((n) => n.name === 'Saltgate')!;
  const res = world.routeCaravanTo({ x: node.cx, y: node.cy, name: node.name, placeId: node.id });
  expect(res.ok).toBe(true);
  // A new route waits for the leader's Roll out; these tests are about a rolling caravan.
  world.setCaravanHalted(false);
  return world;
}

/** The map walk under "time moves only when I move": the hero steps off and the caravan rolls with the clock. */
function walkOnMap(world: WorldState, dx: number, dy: number, steps: number): void {
  world.leaveCaravan();
  const pace = onFootPaceMps(1.25, false);
  for (let i = 0; i < steps; i++) {
    world.moveHero(dx, dy);
    world.advanceTravel(Math.hypot(dx, dy) * METERS_PER_WORLD_TILE, pace, 1);
  }
}

function flatWorld(): WorldState {
  const size = 160;
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
  const tiles = 100 * CARAVAN_TILES_PER_UNIT;
  world.caravan = setRoute(
    createCaravan(10, 80.5),
    [
      { x: 10, y: 80.5 },
      { x: 10 + tiles, y: 80.5 },
    ],
    [{ x: 10 + tiles, y: 80.5, name: 'Far', placeId: null }],
  );
  world.rejoinCaravan();
  return world;
}

function rollSeconds(driver: ConvoyDriver, seconds: number): void {
  for (let i = 0; i < seconds * 30; i++) driver.step(1 / 30);
}

test('a new game zoomed in at the start town rolls the one wagon through town (was a parked static wagon)', () => {
  const world = newGameRouted();
  expect(world.settlementAt(world.caravan.x, world.caravan.y)).not.toBeNull();
  // A wild convoy window is never cut inside a settlement...
  expect(world.buildConvoyHandoff()).toBeNull();
  // ...but the zoom-in still drives the caravan: the town, with the route through it.
  const plan = world.zoomInPlan();
  expect(plan.handoff?.convoy).toBeTruthy();
  expect(plan.entry.convoyMode).toBe('walk');
  const driver = new ConvoyDriver(() => world, plan.handoff!.convoy!);
  const a = driver.frame();
  expect(a.gone).toBe(false);
  expect(convoyRoom(a, plan.handoff!.convoy!.bounds)).toBeGreaterThan(0);
  rollSeconds(driver, 10);
  const b = driver.frame();
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(5);
  expect(b.speed).toBeGreaterThan(0);
}, 60_000);

test('walking on the map then zooming in still rolls the caravan; the hero lands on foot, not pulled', () => {
  const world = newGameRouted();
  walkOnMap(world, 0.05, 0, 40);
  expect(world.heroAboard).toBe(false);
  expect(world.caravan.along).toBeGreaterThan(0);
  const plan = world.zoomInPlan();
  expect(plan.handoff?.convoy).toBeTruthy();
  expect(plan.entry.convoyMode).toBe('free');
  const driver = new ConvoyDriver(() => world, plan.handoff!.convoy!);
  const a = driver.frame();
  rollSeconds(driver, 10);
  const b = driver.frame();
  expect(a.gone).toBe(false);
  expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(5);
}, 60_000);

test('on foot in the wilds the zone is cut at the hero, who lands where they stood', () => {
  const world = flatWorld();
  world.leaveCaravan();
  world.moveHero(3, 1);
  const plan = world.zoomInPlan();
  const convoy = plan.handoff!.convoy!;
  expect(plan.entry.convoyMode).toBe('free');
  const hero = tileToLocal(convoy.frame, world.hero.x, world.hero.y);
  expect(plan.entry.pos!.x).toBeCloseTo(hero.x, 5);
  expect(plan.entry.pos!.z).toBeCloseTo(hero.z, 5);
  const driver = new ConvoyDriver(() => world, convoy);
  // The caravan is 25 m off and in the zone: the wagon is there and rolls.
  expect(driver.frame().gone).toBe(false);
  const x0 = driver.frame().x;
  rollSeconds(driver, 5);
  expect(driver.frame().x).toBeGreaterThan(x0 + 2);
});

test('a caravan that is not in the zone yet is away, not "rolled on", and shows when it arrives', () => {
  const world = flatWorld();
  world.leaveCaravan();
  // Scout well ahead down the road: the zone is cut there, the wagon is still behind it.
  world.moveHero(40, 0);
  const plan = world.zoomInPlan();
  const driver = new ConvoyDriver(() => world, plan.handoff!.convoy!);
  const f0 = driver.frame();
  expect(f0.gone).toBe(true);
  expect(f0.away).toBe(true);
  expect(driver.takeLeftNotice()).toBe(false);
  expect(driver.followable).toBe(false);
  let arrived = -1;
  for (let i = 0; i < 30 * 600 && arrived < 0; i++) {
    driver.step(1 / 30);
    if (!driver.frame().gone) arrived = i;
  }
  expect(arrived).toBeGreaterThan(0);
  expect(driver.frame().away).toBe(false);
  expect(driver.followable).toBe(true);
  // It rolls on through and leaves: then it is "rolled on", once.
  for (let i = 0; i < 30 * 900 && !driver.frame().gone; i++) driver.step(1 / 30);
  const out = driver.frame();
  expect(out.gone).toBe(true);
  expect(out.away).toBe(false);
  expect(convoyRoom(out, plan.handoff!.convoy!.bounds)).toBeLessThan(-CONVOY_GONE_M);
  expect(driver.takeLeftNotice()).toBe(true);
  expect(driver.takeLeftNotice()).toBe(false);
});

test('riding, the zone leans down the road and the wagon starts beside the hero', () => {
  const world = flatWorld();
  const plan = world.zoomInPlan();
  expect(plan.entry).toEqual({ convoyMode: 'walk' });
  const convoy = plan.handoff!.convoy!;
  const at = tileToLocal(convoy.frame, world.caravan.x, world.caravan.y);
  // East-bound: most of the zone lies ahead (east) of the wagon.
  expect(convoy.bounds.maxX - at.x).toBeGreaterThan(2 * (at.x - convoy.bounds.minX));
});

test('halted, the wagon stands still in the zone and rolls again on resume', () => {
  const world = flatWorld();
  world.setCaravanHalted(true);
  const plan = world.zoomInPlan();
  const driver = new ConvoyDriver(() => world, plan.handoff!.convoy!);
  const a = driver.frame();
  rollSeconds(driver, 5);
  expect(driver.frame().x).toBeCloseTo(a.x, 6);
  expect(driver.frame().gone).toBe(false);
  world.setCaravanHalted(false);
  rollSeconds(driver, 5);
  expect(driver.frame().x).toBeGreaterThan(a.x + 2);
});

test('no route and on foot: the wagons park where the caravan is, not beside the hero', () => {
  const world = flatWorld();
  world.caravan = createCaravan(10, 80.5);
  world.leaveCaravan();
  world.moveHero(4, 0);
  const plan = world.zoomInPlan();
  expect(plan.handoff?.convoy).toBeUndefined();
  const exp = plan.handoff!.areaExport;
  const want = tileToLocal(
    { innerOrigin: exp.area.innerOrigin, metersPerTile: exp.units.metersPerTile },
    10,
    80.5,
  );
  expect(plan.entry.wagon).toEqual(want);
});

test('an older save (no heroAboard flag, hero beside the wagons) zooms into a rolling convoy', () => {
  const world = newGameRouted();
  walkOnMap(world, 0.05, 0, 10);
  const packed = world.toPacked({ gameVersion: 'old', cfPin: { repo: 'x', ref: 'y' } as never });
  const caravan = { ...(packed.caravan as unknown as Record<string, unknown>) };
  delete caravan.heroAboard;
  delete caravan.todayDay;
  delete caravan.todayUnits;
  const loaded = new WorldState();
  loaded.beginGeneratedWorld(packed.worldSeed, { keepHero: true });
  loaded.load({ ...packed, caravan: caravan as never });
  const plan = loaded.zoomInPlan();
  expect(plan.handoff?.convoy).toBeTruthy();
  const driver = new ConvoyDriver(() => loaded, plan.handoff!.convoy!);
  const a = driver.frame();
  rollSeconds(driver, 8);
  expect(Math.hypot(driver.frame().x - a.x, driver.frame().z - a.z)).toBeGreaterThan(4);
}, 60_000);
