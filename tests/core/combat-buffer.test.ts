import { expect, test } from 'vitest';
import { AttackBuffer } from '../../src/core/combat/buffer';

function buffer(holdThresholdMs = 300, windowMs = 450): AttackBuffer {
  return new AttackBuffer({ holdThresholdMs, windowMs });
}

test('a release before the hold threshold is a tap', () => {
  const attacks = buffer();
  expect(attacks.update(0, { x: true, y: false })).toEqual([]);
  expect(attacks.update(299, { x: false, y: false })).toEqual([
    { button: 'x', kind: 'tap', atMs: 299 },
  ]);
});

test('holding past the threshold releases one heavy and a later release does not tap', () => {
  const attacks = buffer();
  attacks.update(0, { x: true, y: false });
  expect(attacks.update(300, { x: true, y: false })).toEqual([
    { button: 'x', kind: 'hold', atMs: 300 },
  ]);
  expect(attacks.update(480, { x: true, y: false })).toEqual([]);
  expect(attacks.update(500, { x: false, y: false })).toEqual([]);
});

test('the hold threshold is tunable', () => {
  const attacks = buffer(500);
  attacks.update(0, { x: false, y: true });
  expect(attacks.update(499, { x: false, y: true })).toEqual([]);
  expect(attacks.update(500, { x: false, y: true })).toEqual([
    { button: 'y', kind: 'hold', atMs: 500 },
  ]);
});

test('x and y are tracked independently', () => {
  const attacks = buffer();
  attacks.update(0, { x: true, y: true });
  const released = attacks.update(100, { x: false, y: true });
  expect(released).toEqual([{ button: 'x', kind: 'tap', atMs: 100 }]);
  expect(attacks.update(300, { x: false, y: true })).toEqual([
    { button: 'y', kind: 'hold', atMs: 300 },
  ]);
});

test('committed attacks leave the buffer when the window expires', () => {
  const attacks = buffer(300, 450);
  attacks.update(0, { x: true, y: false });
  const [tap] = attacks.update(40, { x: false, y: false });
  expect(tap).toBeDefined();
  expect(attacks.pending(40 + 449).map((edge) => edge.kind)).toEqual(['tap']);
  expect(attacks.pending(40 + 450)).toEqual([]);
});

test('consume drops an attack from the pending window', () => {
  const attacks = buffer();
  attacks.update(0, { x: true, y: false });
  const [tap] = attacks.update(50, { x: false, y: false });
  if (!tap) throw new Error('expected a tap');
  attacks.consume(tap);
  expect(attacks.pending(80)).toEqual([]);
});
