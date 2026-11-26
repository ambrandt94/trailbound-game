import { expect, test } from 'vitest';
import {
  LOCK_HOLD_MS,
  LockGestureBuffer,
  applyLockTap,
  clockwiseSweep,
  retargetLock,
  type LockBody,
  type LockFoe,
} from '../../src/core/combat/lock';
import { createFight, IDLE_INPUT } from '../../src/core/combat/fight';

const body: LockBody = { x: 0, z: 0, yaw: 0 };
const foes: LockFoe[] = [
  { id: 'a', x: 0, z: 3 },
  { id: 'b', x: -1, z: 0 },
  { id: 'c', x: 1, z: 0 },
];

test('a release before the lock threshold is a tap, and a hold does not also tap', () => {
  const buffer = new LockGestureBuffer(LOCK_HOLD_MS);
  expect(buffer.update(0, true)).toBeNull();
  expect(buffer.update(249, false)).toBe('tap');

  const held = new LockGestureBuffer(LOCK_HOLD_MS);
  held.update(0, true);
  expect(held.update(249, true)).toBeNull();
  expect(held.update(250, true)).toBe('hold');
  expect(held.update(400, true)).toBeNull();
  expect(held.update(420, false)).toBeNull();
});

test('the lock hold threshold is tunable', () => {
  const buffer = new LockGestureBuffer(400);
  buffer.update(0, true);
  expect(buffer.update(399, true)).toBeNull();
  expect(buffer.update(400, true)).toBe('hold');
});

test('the first tap locks the nearest foe, and one foe unlocks on the next tap', () => {
  expect(applyLockTap(null, body, foes)).toBe('b');
  expect(applyLockTap('b', body, [foes[1]!])).toBeNull();
});

test('further taps cycle clockwise and never unlock while several foes live', () => {
  expect(clockwiseSweep(body, foes[1]!)).toBeLessThan(clockwiseSweep(body, foes[2]!));
  expect(clockwiseSweep(body, foes[2]!)).toBeLessThan(clockwiseSweep(body, foes[0]!));
  expect(applyLockTap('b', body, foes)).toBe('c');
  expect(applyLockTap('c', body, foes)).toBe('a');
  expect(applyLockTap('a', body, foes)).toBe('b');
});

test('a hold clears the lock, including when several foes would have cycled', () => {
  const fight = createFight({
    enemyCount: 3,
    aggression: 0,
    attackRate: 0,
    lockHoldMs: 250,
  });
  fight.teleport('player', 0, 0);
  fight.teleport('enemy-0', 0, 3);
  fight.teleport('enemy-1', -1, 0);
  fight.teleport('enemy-2', 1, 0);
  fight.step(1 / 60, { ...IDLE_INPUT, lockDown: true });
  fight.step(1 / 60, IDLE_INPUT);
  expect(fight.snapshot().lockId).toBe('enemy-1');

  let time = 0;
  while (time < 0.32) {
    fight.step(1 / 60, { ...IDLE_INPUT, lockDown: true });
    time += 1 / 60;
  }
  expect(fight.snapshot().lockId).toBeNull();
  fight.step(1 / 60, IDLE_INPUT);
  expect(fight.snapshot().lockId).toBeNull();
});

test('a dead or despawned lock retargets the nearest survivor, and the last foe unlocks', () => {
  expect(retargetLock('b', body, foes)).toBe('b');
  expect(retargetLock('b', body, [foes[0]!, foes[2]!])).toBe('c');
  expect(retargetLock('b', body, [])).toBeNull();
  expect(retargetLock(null, body, foes)).toBeNull();

  const fight = createFight({ enemyCount: 2, aggression: 0, attackRate: 0, respawnSec: 30 });
  fight.teleport('player', 0, 0);
  fight.teleport('enemy-0', 4, 0);
  fight.teleport('enemy-1', 1, 0);
  fight.step(1 / 60, { ...IDLE_INPUT, lockDown: true });
  fight.step(1 / 60, IDLE_INPUT);
  expect(fight.snapshot().lockId).toBe('enemy-1');
  fight.setTuning({ enemyCount: 1 });
  expect(fight.snapshot().lockId).toBe('enemy-0');

  const last = createFight({ enemyCount: 1, aggression: 0, attackRate: 0, respawnSec: 30 });
  last.teleport('player', 0, 0);
  last.teleport('enemy-0', 0.8, 0);
  last.step(1 / 60, { ...IDLE_INPUT, lockDown: true });
  last.step(1 / 60, IDLE_INPUT);
  let guard = 0;
  while ((last.snapshot().enemies[0]?.hp ?? 0) > 0 && guard < 20) {
    last.teleport('enemy-0', 0.8, 0);
    last.step(0.05, { ...IDLE_INPUT, xDown: true });
    last.step(0.45, IDLE_INPUT);
    guard += 1;
  }
  expect(last.snapshot().enemies[0]?.hp).toBe(0);
  expect(last.snapshot().lockId).toBeNull();
});

test('while locked the body turns toward the foe and raw strafe does not orbit', () => {
  const fight = createFight({ enemyCount: 1, aggression: 0, attackRate: 0, lockTurnRate: 6 });
  fight.teleport('player', 0, 0);
  fight.teleport('enemy-0', 3, 0);
  fight.step(1 / 60, { ...IDLE_INPUT, lockDown: true });
  fight.step(1 / 60, IDLE_INPUT);
  const start = fight.snapshot().player;
  fight.step(0.05, { ...IDLE_INPUT, strafe: 1, forward: 1 });
  const moved = fight.snapshot().player;
  const targetYaw = Math.atan2(3, 0);
  expect(Math.abs(moved.yaw - targetYaw)).toBeGreaterThan(0.2);
  expect(Math.abs(moved.yaw - start.yaw)).toBeGreaterThan(0.05);
  expect(Math.abs(moved.yaw - start.yaw)).toBeLessThan(0.5);
  expect(Math.hypot(moved.x - start.x, moved.z - start.z)).toBeLessThan(0.02);
  expect(fight.snapshot().enemies[0]?.locked).toBe(true);
});
