import { expect, test } from 'vitest';
import {
  COOK_TU,
  EAT_MORALE,
  EAT_TU,
  HUNT_FOOD,
  HUNT_TU,
  WASH_MORALE,
  WASH_TU,
  createParty,
  halfActivityTu,
  normalizeParty,
  resolveMinigame,
  wagonMenuRows,
  wagonPlayResult,
  wagonRefusal,
} from '../../src/core/sim/party';
import { START_HOUR } from '../../src/core/sim/clock';
import { hoursForTu } from '../../src/core/sim/time';
import { WorldState } from '../../src/core/state/world-state';

test('older party saves migrate dishes and coins to zero', () => {
  const party = normalizeParty({ rawFood: 4, meals: 1, morale: 2, hungry: true, hasWagon: true });
  expect(party.dirtyDishes).toBe(0);
  expect(party.coins).toBe(0);
  expect(party.rawFood).toBe(4);
  expect(party.hungry).toBe(true);
});

test('the wagon lists hunting, cooking, eating, and washing as separate rows', () => {
  expect(wagonMenuRows(40).map((row) => row.id)).toEqual(['hunt', 'cook', 'eat', 'wash']);
  expect(wagonMenuRows(40).map((row) => row.label)).toEqual([
    'Go hunting',
    'Cook meal',
    'Eat',
    'Wash dishes',
  ]);
  expect(wagonMenuRows(90).map((row) => row.id)).toEqual(['sleep']);
  expect(EAT_TU + WASH_TU).toBe(6);
  expect(halfActivityTu('hunt')).toBe(Math.round(HUNT_TU / 2));
  expect(halfActivityTu('cook')).toBe(Math.round(COOK_TU / 2));
  expect(halfActivityTu('eat')).toBe(Math.round(EAT_TU / 2));
  expect(halfActivityTu('wash')).toBe(Math.round(WASH_TU / 2));
});

test('cooking, eating, and washing stay closed when the stores are empty', () => {
  const party = createParty();
  expect(wagonRefusal(party, 'hunt', 20)).toBeNull();
  expect(wagonRefusal({ ...party, rawFood: 0 }, 'cook', 20)).toBe('No food to cook.');
  expect(wagonRefusal(party, 'eat', 20)).toBe('No meal ready.');
  expect(wagonRefusal(party, 'wash', 20)).toBe('No dishes to wash.');
  expect(wagonRefusal(party, 'hunt', 95)).toBe('Not now.');
});

test('a successful hunt can scale the food and still spends the full TU', () => {
  const full = resolveMinigame(createParty(), wagonPlayResult('hunt', { ok: true }));
  expect(full.tu).toBe(HUNT_TU);
  expect(full.party.rawFood).toBe(createParty().rawFood + HUNT_FOOD);
  expect(full.lines).toContain(`TU +${HUNT_TU}`);
  expect(full.lines).toContain(`food +${HUNT_FOOD}`);

  const half = resolveMinigame(
    createParty(),
    wagonPlayResult('hunt', { ok: true, foodScale: 0.5 }),
  );
  expect(half.tu).toBe(HUNT_TU);
  expect(half.party.rawFood).toBe(createParty().rawFood + Math.round(HUNT_FOOD * 0.5));
});

test('failing or quitting a wagon game spends half the TU and keeps the stores', () => {
  const start = { ...createParty(), meals: 2, dirtyDishes: 3, coins: 4, hungry: true };
  for (const id of ['hunt', 'cook', 'eat', 'wash'] as const) {
    const failed = resolveMinigame(start, wagonPlayResult(id, { ok: false, message: 'Miss.' }));
    expect(failed.party).toEqual(start);
    expect(failed.tu).toBe(halfActivityTu(id));
    expect(failed.lines).toContain(`TU +${halfActivityTu(id)}`);
    expect(failed.lines).toContain('food +0');
    expect(failed.message).toBe('Miss.');
  }
});

test('cooking, eating, and washing move only their own stores', () => {
  const start = { ...createParty(), meals: 1, hungry: true, morale: -4, dirtyDishes: 2 };
  const cooked = resolveMinigame(start, wagonPlayResult('cook', { ok: true }));
  expect(cooked.tu).toBe(COOK_TU);
  expect(cooked.party.rawFood).toBe(start.rawFood - 1);
  expect(cooked.party.meals).toBe(2);
  expect(cooked.party.dirtyDishes).toBe(2);

  const ate = resolveMinigame(cooked.party, wagonPlayResult('eat', { ok: true }));
  expect(ate.tu).toBe(EAT_TU);
  expect(ate.party.meals).toBe(1);
  expect(ate.party.hungry).toBe(false);
  expect(ate.party.morale).toBe(-4 + EAT_MORALE);
  expect(ate.party.dirtyDishes).toBe(3);
  expect(ate.lines).toContain('Hungry cleared');

  const washed = resolveMinigame(ate.party, wagonPlayResult('wash', { ok: true }));
  expect(washed.tu).toBe(WASH_TU);
  expect(washed.party.dirtyDishes).toBe(0);
  expect(washed.party.morale).toBe(ate.party.morale + WASH_MORALE);
  expect(washed.party.meals).toBe(1);
});

test('coins and a non-wagon miss do not spend time', () => {
  const paid = resolveMinigame(createParty(), {
    ok: true,
    message: 'Caught one.',
    coins: 8,
  });
  expect(paid.tu).toBe(0);
  expect(paid.party.coins).toBe(8);
  expect(paid.lines).toContain('coins +8');

  const missed = resolveMinigame(paid.party, { ok: false, message: 'It got away.', coins: 8 });
  expect(missed.tu).toBe(0);
  expect(missed.party.coins).toBe(8);
});

test('WorldState.applyMinigameResult moves the clock, the party, and the purse together', () => {
  const world = new WorldState();
  world.clockHours = START_HOUR;
  const before = world.clockHours;
  const applied = world.applyMinigameResult(wagonPlayResult('hunt', { ok: true, foodScale: 0.25 }));
  expect(world.party.rawFood).toBe(createParty().rawFood + Math.round(HUNT_FOOD * 0.25));
  expect(world.clockHours).toBeCloseTo(before + hoursForTu(HUNT_TU), 5);
  expect(applied.lines.join(' ')).toContain('TU');
  const packed = world.toPacked({
    gameVersion: '0',
    cfPin: { version: '0', generatorVersion: '0' },
  });
  expect(packed.party?.dirtyDishes).toBe(0);
  expect(packed.party?.coins).toBe(0);
  expect(packed.party?.rawFood).toBe(world.party.rawFood);

  const quit = new WorldState();
  quit.party = { ...createParty(), rawFood: 3, meals: 1 };
  quit.applyMinigameResult(wagonPlayResult('cook', { ok: false }));
  expect(quit.party.rawFood).toBe(3);
  expect(quit.party.meals).toBe(1);
  expect(quit.clockHours).toBeCloseTo(START_HOUR + hoursForTu(halfActivityTu('cook')), 5);
});
