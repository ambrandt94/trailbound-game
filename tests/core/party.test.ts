import { expect, test } from 'vitest';
import {
  EAT_MORALE,
  EAT_TU,
  HUNT_FOOD,
  HUNT_TU,
  OVERNIGHT_FOOD,
  START_RAW_FOOD,
  applyOvernight,
  applyWagonAction,
  createParty,
  formatPartyReadout,
  normalizeParty,
  sleepHours,
  wagonMenuRows,
} from '../../src/core/sim/party';
import { START_HOUR } from '../../src/core/sim/clock';

test('a new party starts stocked, with a wagon, and not hungry', () => {
  const party = createParty();
  expect(party.hasWagon).toBe(true);
  expect(party.rawFood).toBe(START_RAW_FOOD);
  expect(party.meals).toBe(0);
  expect(party.morale).toBe(0);
  expect(party.hungry).toBe(false);
  expect(normalizeParty(null)).toEqual(party);
  expect(normalizeParty({ rawFood: -3, meals: 2.2, hungry: true }).rawFood).toBe(0);
});

test('hunting, cooking, and eating spend the draft TU and move food', () => {
  const start = createParty();
  const hunt = applyWagonAction(start, 'hunt', 20);
  expect(hunt.tu).toBe(HUNT_TU);
  expect(hunt.party.rawFood).toBe(START_RAW_FOOD + HUNT_FOOD);
  expect(hunt.message).toContain(String(HUNT_FOOD));

  const empty = applyWagonAction({ ...start, rawFood: 0 }, 'cook', 20);
  expect(empty.tu).toBe(0);
  expect(empty.message).toBe('No food to cook.');
  expect(empty.party.rawFood).toBe(0);

  const cooked = applyWagonAction(start, 'cook', 20);
  expect(cooked.tu).toBe(10);
  expect(cooked.party.rawFood).toBe(START_RAW_FOOD - 1);
  expect(cooked.party.meals).toBe(1);

  const noMeal = applyWagonAction(start, 'eat', 20);
  expect(noMeal.message).toBe('No meal ready.');
  expect(noMeal.tu).toBe(0);

  const hungry = { ...cooked.party, hungry: true, morale: -10 };
  const ate = applyWagonAction(hungry, 'eat', 20);
  expect(ate.tu).toBe(EAT_TU);
  expect(ate.party.meals).toBe(0);
  expect(ate.party.hungry).toBe(false);
  expect(ate.party.morale).toBe(-10 + EAT_MORALE);
});

test('after TU 90 the wagon offers only Sleep, and Sleep skips to dawn', () => {
  expect(wagonMenuRows(40).map((row) => row.id)).toEqual(['hunt', 'cook', 'eat']);
  expect(wagonMenuRows(90).map((row) => row.id)).toEqual(['sleep']);
  expect(wagonMenuRows(99).map((row) => row.label)).toEqual(['Sleep']);
  const refused = applyWagonAction(createParty(), 'hunt', 95);
  expect(refused.tu).toBe(0);
  expect(refused.message).toBe('Not now.');
  const rest = applyWagonAction(createParty(), 'sleep', 95);
  expect(rest.sleep).toBe(true);
  expect(rest.tu).toBe(0);
  expect(sleepHours(21.6)).toBeCloseTo(2.4, 5);
});

test('overnight eats ten food and hunger costs morale once', () => {
  const fed = applyOvernight(createParty());
  expect(fed.rawFood).toBe(START_RAW_FOOD - OVERNIGHT_FOOD);
  expect(fed.hungry).toBe(false);
  const starving = applyOvernight({ ...createParty(), rawFood: 4, morale: 3 });
  expect(starving.rawFood).toBe(0);
  expect(starving.hungry).toBe(true);
  expect(starving.morale).toBe(3 - 10);
  const again = applyOvernight(starving);
  expect(again.morale).toBe(starving.morale);
  expect(again.hungry).toBe(true);
});

test('the readout names TU, food, meals, morale, and Hungry', () => {
  const line = formatPartyReadout(START_HOUR, createParty());
  expect(line).toContain('TU 33');
  expect(line).toContain(`food ${START_RAW_FOOD}`);
  expect(line).toContain('meals 0');
  expect(line).not.toContain('Hungry');
  const hungry = formatPartyReadout(START_HOUR, { ...createParty(), hungry: true });
  expect(hungry).toContain('Hungry');
});
