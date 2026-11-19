import { expect, test } from 'vitest';
import { formatEta } from '../../src/app/travel-hud';

test('the ETA arrival counts TU left in the day, like the day-cycle HUD', () => {
  // 38 TU from 12.4 TU after dawn: 50.4 into the day, so 49.6 left, shown as 50.
  expect(formatEta(38, 1, 12.4, false)).toBe('≈ 38 TU · Day 1, 50 TU left');
  // Crossing dawn lands on the next day.
  expect(formatEta(38, 1, 80, false)).toBe('≈ 38 TU · Day 2, 82 TU left');
  expect(formatEta(30, 3, 70, false)).toBe('≈ 30 TU · Day 4, 100 TU left');
});

test('a halted caravan says it waits', () => {
  expect(formatEta(10, 1, 20, true)).toBe('≈ 10 TU · Day 1, 70 TU left once rolling');
});

test('whole-TU arrival: 12 TU into day 2 leaves 88', () => {
  expect(formatEta(12, 1, 100, false)).toBe('≈ 12 TU · Day 2, 88 TU left');
});
