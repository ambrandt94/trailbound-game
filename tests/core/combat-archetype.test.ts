import { expect, test } from 'vitest';
import { weapons } from '../../src/core/combat';
import { archetypeFor, WEAPON_ARCHETYPES } from '../../src/core/combat/archetype';
import {
  attackClipTime,
  chargeImpact,
  chargeLevel,
  CLIP_STRIKE,
  moveStrikePhase,
} from '../../src/core/combat/charge';

test('each weapon button is one archetype', () => {
  expect(WEAPON_ARCHETYPES.fists).toEqual({ x: 'thrust', y: 'bash', counter: 'bash' });
  expect(WEAPON_ARCHETYPES.axe).toEqual({
    x: 'vertical',
    y: 'horizontal',
    counter: 'horizontal',
  });
  expect(WEAPON_ARCHETYPES.hammer).toEqual({ x: 'vertical', y: 'bash', counter: 'bash' });
  expect(WEAPON_ARCHETYPES.daggers).toEqual({
    x: 'thrust',
    y: 'horizontal',
    counter: 'thrust',
  });
  expect(WEAPON_ARCHETYPES['sword-shield']).toEqual({
    x: 'horizontal',
    y: 'bash',
    counter: 'bash',
  });
  for (const style of weapons()) {
    for (const move of style.moves) {
      const button = move.button === 'counter' ? 'counter' : move.button;
      expect(archetypeFor(style.id, button)).toBe(WEAPON_ARCHETYPES[style.id]?.[button]);
    }
  }
});

test('charge stays a tap until the threshold, then a heavy, then a full charge', () => {
  expect(chargeLevel(200, 300, 'tap')).toBe(1);
  expect(chargeLevel(500, 300, 'tap')).toBe(1);
  expect(chargeLevel(300, 300, 'hold')).toBe(2);
  expect(chargeLevel(599, 300, 'hold')).toBe(2);
  expect(chargeLevel(600, 300, 'hold')).toBe(3);
  expect(chargeImpact(1)).toBe(1);
  expect(chargeImpact(2)).toBe(1);
  expect(chargeImpact(3)).toBeGreaterThan(1);
});

test('every move strike maps onto the same clip strike, and charge only delays the wind-up', () => {
  for (const style of weapons()) {
    for (const move of style.moves) {
      const strike = moveStrikePhase(move);
      expect(strike).toBeGreaterThan(0.08);
      expect(strike).toBeLessThan(0.92);
      expect(attackClipTime(strike, strike, 1)).toBeCloseTo(CLIP_STRIKE, 5);
      expect(attackClipTime(strike, strike, 3)).toBeCloseTo(CLIP_STRIKE, 5);
      const mid = strike * 0.45;
      expect(attackClipTime(mid, strike, 3)).toBeLessThan(attackClipTime(mid, strike, 1));
    }
  }
});
