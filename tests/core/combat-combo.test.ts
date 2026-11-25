import { expect, test } from 'vitest';
import { createComboResolver, type ComboStep } from '../../src/core/combat/combo';
import { weaponById, weapons } from '../../src/core/combat';

const tap = (button: ComboStep['button']): ComboStep => ({ button, kind: 'tap' });
const hold = (button: ComboStep['button']): ComboStep => ({ button, kind: 'hold' });

test('every weapon has three enders and one heavy hold in the middle of a string', () => {
  expect(weapons().map((style) => style.id)).toEqual([
    'fists',
    'axe',
    'hammer',
    'daggers',
    'sword-shield',
  ]);
  for (const style of weapons()) {
    const enders = style.combos.filter((combo) => combo.ender);
    expect(enders.length, style.id).toBeGreaterThanOrEqual(3);
    const ids = new Set(enders.map((combo) => combo.moveId));
    expect(ids.size, style.id).toBe(enders.length);
    expect(
      enders.some((combo) =>
        combo.sequence.some(
          (step, index) => step.kind === 'hold' && index < combo.sequence.length - 1,
        ),
      ),
      style.id,
    ).toBe(true);
    for (const combo of style.combos) {
      expect(
        style.moves.some((move) => move.id === combo.moveId),
        combo.moveId,
      ).toBe(true);
    }
    for (const step of style.combos.flatMap((combo) => combo.sequence)) {
      const neutral = style.combos.find(
        (combo) =>
          !combo.ender &&
          combo.sequence.length === 1 &&
          combo.sequence[0]?.button === step.button &&
          combo.sequence[0]?.kind === step.kind,
      );
      expect(neutral, `${style.id} ${step.button} ${step.kind}`).toBeDefined();
    }
  }
});

test('the five styles do not share a speed, a counter window, or an ender', () => {
  const speeds = weapons().map((style) => style.moveSpeed);
  const windows = weapons().map((style) => style.counterWindowMs);
  expect(new Set(speeds).size).toBe(speeds.length);
  expect(new Set(windows).size).toBe(windows.length);
  expect(weaponById('hammer').counterWindowMs).toBeLessThan(weaponById('fists').counterWindowMs);
  expect(weaponById('sword-shield').counterWindowMs).toBeGreaterThan(
    weaponById('hammer').counterWindowMs,
  );
  expect(weaponById('sword-shield').counterWindowMs).toBe(
    Math.max(...weapons().map((style) => style.counterWindowMs)),
  );
  const jab = weaponById('fists').moves.find((move) => move.id === 'jab');
  const nick = weaponById('daggers').moves.find((move) => move.id === 'nick');
  const swing = weaponById('hammer').moves.find((move) => move.id === 'swing');
  expect(jab && nick && swing).toBeTruthy();
  expect(nick!.startup).toBeLessThan(jab!.startup);
  expect(swing!.startup).toBeGreaterThan(jab!.startup);
  expect(nick!.damage).toBeLessThan(jab!.damage);
  expect(swing!.knockback).toBeGreaterThan(jab!.knockback);
  expect(weaponById('hammer').moves.some((move) => move.aoe)).toBe(true);
  expect(weaponById('daggers').moves.find((move) => move.id === 'nick')?.hits).toBeGreaterThan(1);
});

test('fists chain taps into a flurry and a heavy hold in the middle into rising', () => {
  const fists = createComboResolver(weaponById('fists'));
  expect(fists.push(tap('x')).moveId).toBe('jab');
  expect(fists.push(tap('x')).moveId).toBe('jab');
  expect(fists.push(tap('x'))).toMatchObject({ moveId: 'flurry', ender: true, chain: [] });

  const rising = createComboResolver(weaponById('fists'));
  expect(rising.push(tap('x')).moveId).toBe('jab');
  expect(rising.push(hold('x')).moveId).toBe('cross');
  expect(rising.push(tap('y'))).toMatchObject({ moveId: 'rising', ender: true });
});

test('a broken string falls back to the latest neutral', () => {
  const fists = createComboResolver(weaponById('fists'));
  fists.push(tap('x'));
  fists.push(hold('x'));
  expect(fists.push(tap('x')).moveId).toBe('jab');
});

test('each weapon resolves its mid-string heavy ender', () => {
  const routes: Record<string, { steps: ComboStep[]; moveId: string }> = {
    fists: { steps: [tap('x'), hold('x'), tap('y')], moveId: 'rising' },
    axe: { steps: [tap('x'), hold('y'), tap('x')], moveId: 'rive' },
    hammer: { steps: [tap('x'), hold('x'), tap('y')], moveId: 'crater' },
    daggers: { steps: [tap('x'), hold('y'), tap('x')], moveId: 'venom' },
    'sword-shield': { steps: [tap('x'), hold('y'), tap('x')], moveId: 'riposte-line' },
  };
  for (const style of weapons()) {
    const route = routes[style.id];
    expect(route, style.id).toBeDefined();
    const resolver = createComboResolver(style);
    let last = '';
    for (const step of route!.steps) last = resolver.push(step).moveId;
    expect(last, style.id).toBe(route!.moveId);
  }
});
