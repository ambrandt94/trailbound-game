import { expect, test } from 'vitest';
import {
  CARAVAN_TILES_PER_UNIT,
  MOUNTAIN_SPEED,
  advanceCaravan,
  appendRoute,
  caravanSave,
  caravanSpeedMod,
  createCaravan,
  etaTu,
  loadCaravan,
  setRoute,
  splitRoute,
  type CaravanStepEnv,
} from '../../src/core/sim/caravan';
import {
  createParty,
  halfActivityTu,
  missTu,
  wagonMenuRows,
  wagonRefusal,
} from '../../src/core/sim/party';
import { WorldState } from '../../src/core/state/world-state';

const even: CaravanStepEnv = { day: 0, speedAt: () => 1, settlementAt: () => null };

function straight(units: number) {
  const tiles = units * CARAVAN_TILES_PER_UNIT;
  return setRoute(
    createCaravan(0, 0),
    [
      { x: 0, y: 0 },
      { x: tiles, y: 0 },
    ],
    [{ x: tiles, y: 0, name: 'Far', placeId: null }],
    null,
  );
}

test('the caravan rolls one unit per TU at an even mood', () => {
  const caravan = straight(100);
  const step = advanceCaravan(caravan, 10, even);
  expect(step.units).toBeCloseTo(10, 6);
  expect(step.caravan.x).toBeCloseTo(10 * CARAVAN_TILES_PER_UNIT, 6);
  expect(step.caravan.todayUnits).toBeCloseTo(10, 6);
  expect(etaTu(step.caravan, 1)).toBeCloseTo(90, 6);
});

test('speedMod follows Fable: mood 0.9 to 1.1, mountains 0.8, wagon hook', () => {
  expect(caravanSpeedMod({ morale: 0, inMountains: false })).toBeCloseTo(1, 6);
  expect(caravanSpeedMod({ morale: -100, inMountains: false })).toBeCloseTo(0.9, 6);
  expect(caravanSpeedMod({ morale: 100, inMountains: false })).toBeCloseTo(1.1, 6);
  expect(caravanSpeedMod({ morale: 0, inMountains: true })).toBeCloseTo(MOUNTAIN_SPEED, 6);
  expect(caravanSpeedMod({ morale: 0, inMountains: false, wagonFactor: 0.85 })).toBeCloseTo(
    0.85,
    6,
  );
  const slow = advanceCaravan(straight(100), 10, { ...even, speedAt: () => 0.8 });
  expect(slow.units).toBeCloseTo(8, 6);
});

test('a halted caravan or one without a route does not move', () => {
  const halted = { ...straight(50), halted: true };
  expect(advanceCaravan(halted, 20, even).units).toBe(0);
  expect(advanceCaravan(createCaravan(3, 4), 20, even).caravan.x).toBe(3);
});

test('the caravan stops at the destination and clears the route', () => {
  const step = advanceCaravan(straight(5), 20, even);
  expect(step.units).toBeCloseTo(5, 6);
  expect(step.events).toEqual([{ type: 'arrived', name: 'Far' }]);
  expect(step.caravan.route).toEqual([]);
  expect(step.caravan.x).toBeCloseTo(5 * CARAVAN_TILES_PER_UNIT, 6);
});

test('the caravan halts on entering a settlement that is not the destination', () => {
  const town = { id: 'mid', name: 'Midway' };
  const env: CaravanStepEnv = {
    ...even,
    settlementAt: (x) => (x >= 20 && x <= 28 ? town : null),
  };
  const step = advanceCaravan(straight(100), 50, env);
  expect(step.caravan.halted).toBe(true);
  expect(step.events).toEqual([{ type: 'stopped', name: 'Midway' }]);
  expect(step.caravan.x).toBeGreaterThanOrEqual(20);
  expect(step.caravan.x).toBeLessThan(22);
  // Resume rolls through the same town without halting again.
  const resumed = advanceCaravan({ ...step.caravan, halted: false }, 20, env);
  expect(resumed.caravan.halted).toBe(false);
  expect(resumed.caravan.x).toBeGreaterThan(28);
});

test('distance today resets on a new day', () => {
  const first = advanceCaravan(straight(100), 10, even).caravan;
  const next = advanceCaravan(first, 5, { ...even, day: 1 }).caravan;
  expect(next.todayDay).toBe(1);
  expect(next.todayUnits).toBeCloseTo(5, 6);
});

test('split puts the travelled part behind the caravan and the rest ahead', () => {
  const caravan = appendRoute(
    straight(10),
    [
      { x: 40, y: 0 },
      { x: 40, y: 20 },
    ],
    { x: 40, y: 20, name: 'Corner', placeId: null },
  );
  const moved = advanceCaravan(caravan, 5, even).caravan;
  const split = splitRoute(moved);
  expect(split.done.slice(-2)).toEqual([moved.x, moved.y]);
  expect(split.rest.slice(0, 2)).toEqual([moved.x, moved.y]);
  expect(split.rest.slice(-2)).toEqual([40, 20]);
  expect(moved.targets.map((t) => t.name)).toEqual(['Far', 'Corner']);
});

test('a miss or quit costs half the activity, rounded half up', () => {
  expect(missTu(45)).toBe(23);
  expect(missTu(30)).toBe(15);
  expect(missTu(9)).toBe(5);
  expect(missTu(15)).toBe(8);
  expect(missTu(5)).toBe(3);
  expect(halfActivityTu('hunt')).toBe(23);
  expect(halfActivityTu('cook')).toBe(15);
  expect(halfActivityTu('eat')).toBe(5);
  expect(halfActivityTu('wash')).toBe(5);
});

test('caravan state survives save and load', () => {
  const rolled = advanceCaravan(straight(100), 12.5, even).caravan;
  const saved = JSON.parse(JSON.stringify(caravanSave({ ...rolled, role: 'solo' }, false)));
  const loaded = loadCaravan(saved, { x: 0, y: 0 });
  expect(loaded.heroAboard).toBe(false);
  expect(loaded.caravan.role).toBe('solo');
  expect(loaded.caravan.x).toBeCloseTo(rolled.x, 6);
  expect(loaded.caravan.along).toBeCloseTo(rolled.along, 6);
  expect(loaded.caravan.length).toBeCloseTo(rolled.length, 6);
  expect(loaded.caravan.route).toEqual(rolled.route);
  expect(loaded.caravan.targets).toEqual(rolled.targets);
  expect(loaded.caravan.todayUnits).toBeCloseTo(12.5, 6);
  // Older saves have no caravan: it starts on the hero and the hero rides.
  const fresh = loadCaravan(undefined, { x: 7, y: 9 });
  expect(fresh.caravan.x).toBe(7);
  expect(fresh.caravan.y).toBe(9);
  expect(fresh.heroAboard).toBe(true);
});

test('the world packs the caravan and restores it on load', () => {
  const world = new WorldState();
  world.caravan = advanceCaravan(straight(100), 20, even).caravan;
  world.hero = { x: world.caravan.x, y: world.caravan.y, yaw: 0 };
  const packed = world.toPacked({
    gameVersion: '0',
    cfPin: { version: '0', generatorVersion: '0' },
  });
  expect(packed.caravan?.route.length).toBe(4);
  const loaded = new WorldState();
  loaded.load(packed);
  expect(loaded.caravan.along).toBeCloseTo(world.caravan.along, 6);
  expect(loaded.heroAboard).toBe(true);
});

test('the clock rolls the caravan, sleep does not, and a 3D area holds it', () => {
  const world = new WorldState();
  world.caravan = straight(300);
  world.clockHours = 8;
  world.party.morale = 0;
  world.advanceClock(1 / (8 / 60)); // one game hour
  const perHour = 100 / 24;
  expect(world.caravan.along / CARAVAN_TILES_PER_UNIT).toBeCloseTo(perHour, 3);
  expect(world.hero.x).toBeCloseTo(world.caravan.x, 6);
  const before = world.caravan.along;
  world.areaHold = true;
  world.advanceClock(1 / (8 / 60));
  expect(world.caravan.along).toBe(before);
  world.areaHold = false;
  world.clockHours = 95 * 0.24; // TU 95, sleep only
  world.useWagon('sleep');
  expect(world.caravan.along).toBe(before);
});

test('a passenger cannot change the route', () => {
  const world = new WorldState();
  world.caravan = { ...straight(10), role: 'passenger', leaderId: 'npc-1' };
  expect(world.clearCaravanRoute()).toBe(false);
  expect(world.setCaravanHalted(true)).toBe(false);
  expect(world.caravan.route.length).toBe(4);
});

test('late in the day a chore that would run past midnight is shown but refused', () => {
  const rows = wagonMenuRows(70);
  expect(rows.map((row) => row.id)).toEqual(['hunt', 'cook', 'eat', 'wash', 'sleep']);
  expect(rows.find((row) => row.id === 'hunt')?.disabled).toBe(true);
  expect(rows.find((row) => row.id === 'cook')?.disabled).toBeUndefined();
  expect(wagonRefusal(createParty(), 'hunt', 70)).toBe('Not enough day left.');
  expect(wagonRefusal(createParty(), 'sleep', 70)).toBeNull();
  expect(wagonMenuRows(40).find((row) => row.id === 'hunt')?.detail).toContain('45 TU');
});
