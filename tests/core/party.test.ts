import { expect, test } from 'vitest';
import {
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

test('play rows refuse empty stores and do not spend TU by themselves', () => {
  const start = createParty();
  const hunt = applyWagonAction(start, 'hunt', 20);
  expect(hunt.tu).toBe(0);
  expect(hunt.party.rawFood).toBe(START_RAW_FOOD);
  expect(hunt.message).toBe('Step up to it.');

  const empty = applyWagonAction({ ...start, rawFood: 0 }, 'cook', 20);
  expect(empty.tu).toBe(0);
  expect(empty.message).toBe('No food to cook.');
  expect(empty.party.rawFood).toBe(0);

  const noMeal = applyWagonAction(start, 'eat', 20);
  expect(noMeal.message).toBe('No meal ready.');
  expect(noMeal.tu).toBe(0);

  const noDishes = applyWagonAction(start, 'wash', 20);
  expect(noDishes.message).toBe('No dishes to wash.');
  expect(noDishes.tu).toBe(0);
});

test('after TU 90 the wagon offers only Sleep, and Sleep skips to dawn', () => {
  expect(wagonMenuRows(40).map((row) => row.id)).toEqual(['hunt', 'cook', 'eat', 'wash']);
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
