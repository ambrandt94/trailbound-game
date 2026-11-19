import { expect, test, vi } from 'vitest';
import { ConvoyDriver } from '../../src/app/convoy-driver';
import { leaderToggleHalt } from '../../src/app/leader-halt';
import { travelHudFor } from '../../src/app/travel-hud';
import {
  caravanStatus,
  haltLabel,
  mapWaitsForHero,
  onFootPaceMps,
} from '../../src/core/sim/map-pace';
import type { CaravanEvent } from '../../src/core/sim/caravan';
import { createCaravan } from '../../src/core/sim/caravan';
import { WorldState } from '../../src/core/state/world-state';

const META = { gameVersion: 't', cfPin: { repo: 'x', ref: 'y' } as never };

/** A real New game (seed 7741): Ashfen to Jadewild runs straight through Ironmarch. */
vi.setConfig({ testTimeout: 120_000 });

let base: WorldState | null = null;
let START: {
  hero: WorldState['hero'];
  caravan: { x: number; y: number; todayDay: number };
  town: WorldState['town'];
};
function newGame(): WorldState {
  const world = new WorldState();
  if (!base) {
    world.beginGeneratedWorld();
    base = world;
    START = {
      hero: { ...world.hero },
      caravan: { x: world.caravan.x, y: world.caravan.y, todayDay: world.caravan.todayDay },
      town: { ...world.town },
    };
    return world;
  }
  // The same seeded continent; only the generation cost is shared. Everything a
  // New game sets up on top of it (start spot, caravan, clock) is reset here.
  world.seed = base.seed;
  world.data = base.data;
  world.hero = { ...START.hero };
  world.caravan = createCaravan(START.caravan.x, START.caravan.y);
  world.caravan.todayDay = START.caravan.todayDay;
  world.heroAboard = true;
  world.town = { ...START.town };
  return world;
}

function route(world: WorldState, name: string): string {
  const node = world.data!.nodes.find((n) => n.name === name)!;
  const res = world.routeCaravanTo({ x: node.cx, y: node.cy, name: node.name, placeId: node.id });
  expect(res.ok).toBe(true);
  return res.message;
}

function host(world: WorldState) {
  const toasts: string[] = [];
  return { world, toasts, toast: (m: string) => void toasts.push(m) };
}

/** Roll the one wagon the way 3D does until it is inside `until` or the route ends. */
function drive(
  world: WorldState,
  until: (w: WorldState) => boolean,
  events: CaravanEvent[] = [],
  maxSteps = 100000,
): number {
  const plan = world.zoomInPlan();
  const driver = new ConvoyDriver(() => world, plan.handoff!.convoy!);
  let steps = 0;
  while (steps++ < maxSteps && world.caravan.route.length && !until(world)) {
    events.push(...driver.step(0.5));
  }
  return steps;
}

test('a new route leaves an idle caravan halted until the leader says Roll out', () => {
  const world = newGame();
  const message = route(world, 'Saltgate');
  expect(world.caravan.halted).toBe(true);
  expect(message).toMatch(/Halted/);
  // The wagon does not move on the map clock or in 3D while halted.
  const along = world.caravan.along;
  world.advanceTravel(500, onFootPaceMps(1.25), 1);
  world.rollConvoy(50);
  expect(world.caravan.along).toBe(along);
  expect(leaderToggleHalt(host(world))).toBe(true);
  expect(world.caravan.halted).toBe(false);
  world.rollConvoy(5);
  expect(world.caravan.along).toBeGreaterThan(along);
});

test('a new route keeps a rolling caravan rolling, and a halted one halted', () => {
  const world = newGame();
  route(world, 'Saltgate');
  world.setCaravanHalted(false);
  expect(route(world, 'Jadewild')).toMatch(/Still rolling/);
  expect(world.caravan.halted).toBe(false);
  world.setCaravanHalted(true);
  route(world, 'Saltgate');
  expect(world.caravan.halted).toBe(true);
  // A waypoint appended to a route does not touch the leader's command.
  world.setCaravanHalted(false);
  const node = world.data!.nodes.find((n) => n.name === 'Ironmarch')!;
  world.routeCaravanTo({ x: node.cx, y: node.cy, name: node.name, placeId: node.id }, true);
  expect(world.caravan.halted).toBe(false);
});

test('no auto-stop: the wagon rolls through the intermediate town to the destination', () => {
  const world = newGame();
  route(world, 'Jadewild');
  world.setCaravanHalted(false);
  const events: CaravanEvent[] = [];
  const seen = new Set<string>();
  const plan = world.zoomInPlan();
  const driver = new ConvoyDriver(() => world, plan.handoff!.convoy!);
  let stalled = 0;
  for (let i = 0; i < 100000 && world.caravan.route.length; i++) {
    const before = world.caravan.along;
    events.push(...driver.step(0.5));
    const here = world.settlementAt(world.caravan.x, world.caravan.y);
    if (here) seen.add(here.name);
    if (world.caravan.route.length && world.caravan.along === before) stalled++;
    expect(world.caravan.halted).toBe(false);
  }
  expect(seen.has('Ironmarch')).toBe(true);
  expect(stalled).toBe(0);
  // Only arrival is reported; arriving ends the route.
  expect(events).toEqual([{ type: 'arrived', name: 'Jadewild' }]);
  expect(world.caravan.route).toEqual([]);
  expect(world.caravan.halted).toBe(false);
});

test('no auto-stop on the map clock either (the hero walks, the wagon rolls through town)', () => {
  const world = newGame();
  route(world, 'Jadewild');
  world.setCaravanHalted(false);
  world.leaveCaravan();
  const pace = onFootPaceMps(1.25);
  let inTown = false;
  for (let i = 0; i < 60000 && world.caravan.route.length; i++) {
    world.advanceTravel(40, pace, 1);
    if (world.settlementAt(world.caravan.x, world.caravan.y)?.name === 'Ironmarch') inTown = true;
    expect(world.caravan.halted).toBe(false);
  }
  expect(inTown).toBe(true);
  expect(world.caravan.route).toEqual([]);
  expect(world.takeCaravanEvents()).toEqual([{ type: 'arrived', name: 'Jadewild' }]);
});

test('Halt and Roll out work the same in a 3D town and in the 3D wilds', () => {
  const world = newGame();
  route(world, 'Jadewild');
  world.setCaravanHalted(false);
  const h = host(world);
  // In the start town (Ashfen): halt, stand still, roll out.
  expect(world.settlementAt(world.caravan.x, world.caravan.y)?.name).toBe('Ashfen');
  const town = world.zoomInPlan();
  expect(town.handoff?.convoy).toBeTruthy();
  const townDriver = new ConvoyDriver(() => world, town.handoff!.convoy!);
  leaderToggleHalt(h);
  expect(world.caravan.halted).toBe(true);
  const a = world.caravan.along;
  for (let i = 0; i < 50; i++) townDriver.step(1 / 10);
  expect(world.caravan.along).toBe(a);
  expect(townDriver.frame().speed).toBe(0);
  leaderToggleHalt(h);
  for (let i = 0; i < 50; i++) townDriver.step(1 / 10);
  expect(world.caravan.along).toBeGreaterThan(a);
  expect(townDriver.frame().speed).toBeGreaterThan(0);
  expect(h.toasts).toEqual(['Halted. Press H to roll out.', 'Rolling out.']);
  // Out in the wilds, past the town: the same command, the same answer.
  drive(world, (w) => w.settlementAt(w.caravan.x, w.caravan.y) === null && w.caravan.along > 60);
  expect(world.settlementAt(world.caravan.x, world.caravan.y)).toBeNull();
  const wild = world.zoomInPlan();
  const wildDriver = new ConvoyDriver(() => world, wild.handoff!.convoy!);
  leaderToggleHalt(h);
  expect(world.caravan.halted).toBe(true);
  const b = world.caravan.along;
  for (let i = 0; i < 50; i++) wildDriver.step(1 / 10);
  expect(world.caravan.along).toBe(b);
  leaderToggleHalt(h);
  for (let i = 0; i < 50; i++) wildDriver.step(1 / 10);
  expect(world.caravan.along).toBeGreaterThan(b);
});

test('halt and roll out on the map: the same command, and the pace setting stays separate', () => {
  const world = newGame();
  route(world, 'Saltgate');
  const h = host(world);
  const hud = () =>
    travelHudFor(world, {
      clockPaused: !world.mapClockRuns(false, true),
      view: 'map',
      convoy: null,
    });
  // Halted by default: the chip says Halted, and idle time is not the reason.
  expect(caravanStatus(hud())).toBe('Halted');
  expect(mapWaitsForHero(hud())).toBe(false);
  expect(haltLabel(hud().halted)).toBe('Roll out');
  leaderToggleHalt(h);
  // Rolling, with "time moves only when I move" and the hero idle: still Rolling, and the
  // readout says time waits for the hero (a separate note).
  expect(caravanStatus(hud())).toBe('Rolling');
  expect(mapWaitsForHero(hud())).toBe(true);
  expect(haltLabel(hud().halted)).toBe('Halt');
  const along = world.caravan.along;
  expect(world.stepMapIdle(1, 1, 1, true)).toBe(false);
  expect(world.caravan.along).toBe(along);
  // The hero walks: the rolling caravan moves with the clock.
  world.leaveCaravan();
  world.advanceTravel(300, onFootPaceMps(1.25), 1);
  const rolled = world.caravan.along;
  expect(rolled).toBeGreaterThan(along);
  // Halt: walking no longer moves it, and the clock still runs for the walk.
  leaderToggleHalt(h);
  expect(caravanStatus(hud())).toBe('Halted');
  const hours = world.clockHours;
  world.advanceTravel(300, onFootPaceMps(1.25), 1);
  expect(world.clockHours).toBeGreaterThan(hours);
  expect(world.caravan.along).toBe(rolled);
  // Time off (the setting) keeps an idle map running a rolling caravan; a halted one never.
  expect(world.stepMapIdle(1, 1, 1, false)).toBe(false);
  leaderToggleHalt(h);
  expect(world.stepMapIdle(1, 1, 1, false)).toBe(true);
});

test('no route and passenger: the command says why and changes nothing', () => {
  const world = newGame();
  const h = host(world);
  expect(leaderToggleHalt(h)).toBe(false);
  expect(h.toasts.at(-1)).toMatch(/No route/);
  expect(world.caravan.halted).toBe(false);
  route(world, 'Saltgate');
  world.caravan = { ...world.caravan, role: 'passenger' };
  expect(leaderToggleHalt(h)).toBe(false);
  expect(h.toasts.at(-1)).toBe('The leader decides when to stop.');
  expect(world.caravan.halted).toBe(true);
});

test('the leader state survives zooming in and out, and save and load', () => {
  const world = newGame();
  route(world, 'Jadewild');
  const h = host(world);
  // Halted: zoom in, the zone leans down the road, nothing starts the wagon, zoom out.
  const plan = world.zoomInPlan();
  expect(world.convoyAhead()).not.toBeNull();
  const driver = new ConvoyDriver(() => world, plan.handoff!.convoy!);
  for (let i = 0; i < 100; i++) driver.step(1 / 10);
  expect(world.caravan.halted).toBe(true);
  expect(world.caravan.along).toBe(0);
  world.leaveConvoy({ x: world.caravan.x, y: world.caravan.y, yaw: 0 }, true);
  expect(world.caravan.halted).toBe(true);
  // Save and load while halted.
  const saved = JSON.parse(JSON.stringify(world.toPacked(META)));
  const loaded = new WorldState();
  loaded.beginGeneratedWorld(saved.worldSeed, { keepHero: true });
  loaded.load(saved);
  expect(loaded.caravan.halted).toBe(true);
  expect(loaded.caravan.route.length).toBeGreaterThan(0);
  // Roll out in 3D, zoom out mid-road, save, load: still rolling, and it keeps rolling in the next zoom-in.
  leaderToggleHalt(h);
  const next = world.zoomInPlan();
  const d2 = new ConvoyDriver(() => world, next.handoff!.convoy!);
  for (let i = 0; i < 100; i++) d2.step(1 / 10);
  const mid = world.caravan.along;
  expect(mid).toBeGreaterThan(0);
  world.leaveConvoy({ x: world.caravan.x, y: world.caravan.y, yaw: 0 }, true);
  expect(world.caravan.halted).toBe(false);
  const saved2 = JSON.parse(JSON.stringify(world.toPacked(META)));
  const again = new WorldState();
  again.beginGeneratedWorld(saved2.worldSeed, { keepHero: true });
  again.load(saved2);
  expect(again.caravan.halted).toBe(false);
  const plan3 = again.zoomInPlan();
  const d3 = new ConvoyDriver(() => again, plan3.handoff!.convoy!);
  for (let i = 0; i < 50; i++) d3.step(1 / 10);
  expect(again.caravan.along).toBeGreaterThan(mid);
});

test('arriving at the final destination ends the route; the next route waits for Roll out', () => {
  const world = newGame();
  route(world, 'Saltgate');
  world.setCaravanHalted(false);
  const events: CaravanEvent[] = [];
  const steps = drive(world, () => false, events);
  expect(steps).toBeLessThan(100000);
  expect(world.caravan.route).toEqual([]);
  expect(events).toEqual([{ type: 'arrived', name: 'Saltgate' }]);
  expect(
    caravanStatus(travelHudFor(world, { clockPaused: false, view: 'area', convoy: null })),
  ).toBe('No route');
  // Arriving is not a town halting the leader; the next trip starts halted.
  route(world, 'Ashfen');
  expect(world.caravan.halted).toBe(true);
});
