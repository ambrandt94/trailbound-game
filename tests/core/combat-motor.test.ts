import { expect, test } from 'vitest';
import { cameraWish } from '../../src/core/combat/space';
import { weaponById } from '../../src/core/combat/registry';
import {
  DEFAULT_MOTOR,
  dodgeDirection,
  dodgeEase,
  dodgeKind,
  relativeMove,
  stepMotor,
  type MotorBody,
} from '../../src/core/combat/motor';
import { createFight, IDLE_INPUT } from '../../src/core/combat/fight';

const SPEED = weaponById('fists').moveSpeed;

const rest: MotorBody = { vx: 0, vz: 0, yaw: Math.PI, skid: 0, startT: 0 };

function hold(
  body: MotorBody,
  wishX: number,
  wishZ: number,
  seconds: number,
  locked = false,
  sprint = false,
  facing = body.yaw,
  speed = SPEED,
) {
  let cursor = body;
  const dt = 1 / 60;
  let left = seconds;
  let last = stepMotor(cursor, wishX, wishZ, dt, speed, locked, sprint, facing, DEFAULT_MOTOR);
  while (left > 0) {
    const step = Math.min(dt, left);
    last = stepMotor(cursor, wishX, wishZ, step, speed, locked, sprint, facing, DEFAULT_MOTOR);
    cursor = last;
    left -= step;
  }
  return last;
}

test('camera wish at several yaws is the unlocked and locked world direction', () => {
  const cases = [
    { yaw: 0, ix: 0, iz: 1, x: 0, z: -1 },
    { yaw: 0, ix: 1, iz: 0, x: 1, z: 0 },
    { yaw: 90, ix: 0, iz: 1, x: -1, z: 0 },
    { yaw: 180, ix: 0, iz: 1, x: 0, z: 1 },
    { yaw: 225, ix: 1, iz: 0, x: -Math.SQRT1_2, z: Math.SQRT1_2 },
  ];
  for (const sample of cases) {
    const wish = cameraWish(sample.ix, sample.iz, sample.yaw);
    expect(wish.x).toBeCloseTo(sample.x, 5);
    expect(wish.z).toBeCloseTo(sample.z, 5);
    const settled = hold(rest, wish.x, wish.z, 1.2);
    const speed = Math.hypot(settled.vx, settled.vz);
    expect(settled.vx / speed).toBeCloseTo(wish.x, 2);
    expect(settled.vz / speed).toBeCloseTo(wish.z, 2);
    const locked = hold(rest, wish.x, wish.z, 1.2, true, false, Math.PI);
    const lockedSpeed = Math.hypot(locked.vx, locked.vz);
    expect(locked.vx / lockedSpeed).toBeCloseTo(wish.x, 2);
    expect(locked.vz / lockedSpeed).toBeCloseTo(wish.z, 2);
    expect(lockedSpeed).toBeLessThan(speed * 0.75);
  }
});

test('analog magnitude and diagonals survive the motor', () => {
  const full = hold(rest, 0, -1, 1);
  const half = hold(rest, 0, -0.5, 1);
  expect(Math.hypot(half.vx, half.vz)).toBeCloseTo(Math.hypot(full.vx, full.vz) * 0.5, 1);
  const diagonal = cameraWish(0.6, 0.8, 40);
  const moved = hold(rest, diagonal.x, diagonal.z, 1);
  const mag = Math.hypot(diagonal.x, diagonal.z);
  const speed = Math.hypot(moved.vx, moved.vz);
  expect(moved.vx / speed).toBeCloseTo(diagonal.x / mag, 2);
  expect(moved.vz / speed).toBeCloseTo(diagonal.z / mag, 2);
});

test('free running accelerates, skids on reverse and on a sprint stop, and turns slowly', () => {
  const early = hold(rest, 0, -1, 0.08);
  expect(early.gait).toBe('start');
  expect(early.speed).toBeGreaterThan(0.4);
  expect(early.speed).toBeLessThan(SPEED * 0.5);
  const running = hold(rest, 0, -1, 0.9);
  expect(running.gait === 'run' || running.gait === 'walk').toBe(true);
  const reversed = stepMotor(
    running,
    0,
    1,
    1 / 60,
    SPEED,
    false,
    false,
    running.yaw,
    DEFAULT_MOTOR,
  );
  expect(reversed.gait).toBe('skid');
  expect(reversed.speed).toBeLessThan(running.speed);
  const sprint = hold(rest, 0, -1, 1.4, false, true);
  expect(sprint.gait).toBe('sprint');
  expect(sprint.speed).toBeGreaterThan(SPEED * 1.2);
  const released = hold(sprint, 0, 0, 0.05, false, false, sprint.yaw);
  expect(released.gait).toBe('skid');
  expect(released.skid).toBeGreaterThan(0.05);
  const yaw0 = stepMotor(rest, 1, 0, 0.05, SPEED, false, false, Math.PI, DEFAULT_MOTOR);
  expect(Math.abs(yaw0.yaw - Math.PI)).toBeGreaterThan(0.05);
  expect(Math.abs(yaw0.yaw - Math.PI)).toBeLessThan(DEFAULT_MOTOR.turnRate * 0.05 + 0.02);
});

test('locked stance is slower at the top and quicker off the line', () => {
  const dt = 0.12;
  const free = hold(rest, 0, -1, dt);
  const locked = hold(rest, 0, -1, dt, true);
  expect(locked.speed).toBeGreaterThan(free.speed);
  const freeTop = hold(rest, 0, -1, 1.2);
  const lockedTop = hold(rest, 0, -1, 1.2, true);
  expect(lockedTop.speed).toBeLessThan(freeTop.speed * 0.75);
  expect(lockedTop.speed).toBeCloseTo(SPEED * DEFAULT_MOTOR.lockedSpeed, 1);
});

test('locked gait follows the facing, and a dodge is a short hop that way', () => {
  const facing = Math.PI;
  expect(relativeMove(0, -1, facing)).toBe('forward');
  expect(relativeMove(0, 1, facing)).toBe('back');
  expect(relativeMove(1, 0, facing)).toBe('left');
  expect(relativeMove(-1, 0, facing)).toBe('right');
  expect(dodgeKind(0, 0, facing)).toBe('back');
  expect(dodgeKind(0, -1, facing)).toBe('forward');
  const side = dodgeDirection('left', facing);
  expect(side.x).toBeCloseTo(1, 5);
  expect(side.z).toBeCloseTo(0, 5);
  const back = dodgeDirection('back', facing);
  expect(back.z).toBeCloseTo(1, 5);
  expect(dodgeEase(1) - dodgeEase(0)).toBeCloseTo(1, 5);
  const forwardLock = hold(rest, 0, -1, 0.4, true, false, facing);
  expect(forwardLock.gait === 'walk' || forwardLock.gait === 'run').toBe(true);
  const strafe = hold(rest, 1, 0, 0.4, true, false, facing);
  expect(strafe.gait).toBe('strafe');
  expect(strafe.strafeSide).toBe(-1);
  const backpedal = hold(rest, 0, 1, 0.4, true, false, facing);
  expect(backpedal.gait).toBe('backpedal');
  const guard = hold({ ...strafe, vx: 0, vz: 0 }, 0, 0, 0.3, true, false, facing);
  expect(guard.gait).toBe('guard');
});

function lockOn(enemy: { x: number; z: number }) {
  const fight = createFight({
    enemyCount: 1,
    aggression: 0,
    attackRate: 0,
    lockTurnRate: 8,
  });
  fight.teleport('player', 0, 0);
  fight.teleport('enemy-0', enemy.x, enemy.z);
  fight.step(1 / 60, { ...IDLE_INPUT, lockDown: true });
  fight.step(1 / 60, IDLE_INPUT);
  return fight;
}

test('while locked the fight follows the camera wish, not the target', () => {
  const foes = [
    { x: 4, z: 0.2 },
    { x: -3, z: 3 },
    { x: 0.4, z: 4 },
  ];
  const samples = [
    { yaw: 0, ix: 0, iz: 1 },
    { yaw: 0, ix: 1, iz: 0 },
    { yaw: 35, ix: Math.SQRT1_2, iz: Math.SQRT1_2 },
    { yaw: 90, ix: 0, iz: 1 },
    { yaw: 200, ix: -0.4, iz: 0.7 },
  ];
  for (const sample of samples) {
    const wish = cameraWish(sample.ix, sample.iz, sample.yaw);
    const ends = foes.map((foe) => {
      const fight = lockOn(foe);
      let guard = 0;
      while (guard < 40) {
        fight.teleport('enemy-0', foe.x, foe.z);
        fight.step(1 / 60, {
          ...IDLE_INPUT,
          moveX: wish.x,
          moveZ: wish.z,
          strafe: sample.ix,
          forward: sample.iz,
        });
        guard += 1;
      }
      return fight.snapshot().player;
    });
    expect(ends[0]!.speed).toBeGreaterThan(0.6);
    for (const player of ends) {
      expect(player.speed).toBeGreaterThan(0.6);
      expect(player.speed).toBeCloseTo(ends[0]!.speed, 1);
      expect(player.x).toBeCloseTo(ends[0]!.x, 1);
      expect(player.z).toBeCloseTo(ends[0]!.z, 1);
    }
    const toward = Math.hypot(wish.x, wish.z) || 1;
    const travel = Math.hypot(ends[0]!.x, ends[0]!.z) || 1;
    expect(ends[0]!.x / travel).toBeCloseTo(wish.x / toward, 1);
    expect(ends[0]!.z / travel).toBeCloseTo(wish.z / toward, 1);
  }
});

test('a locked dodge is short, faces the target, and will not chain', () => {
  const fight = lockOn({ x: 0, z: -3 });
  const before = fight.snapshot().player;
  fight.step(0.05, { ...IDLE_INPUT, shiftDown: true });
  let left = 0.35;
  while (left > 0) {
    fight.step(0.05, IDLE_INPUT);
    left -= 0.05;
  }
  const hopped = fight.snapshot().player;
  const travelled = Math.hypot(hopped.x - before.x, hopped.z - before.z);
  expect(travelled).toBeGreaterThan(1.4);
  expect(travelled).toBeLessThan(2.2);
  expect(hopped.z).toBeGreaterThan(0.8);
  expect(hopped.evade).toBeNull();
  const yawToFoe = Math.atan2(0 - hopped.x, -3 - hopped.z);
  const yawDelta = Math.atan2(Math.sin(hopped.yaw - yawToFoe), Math.cos(hopped.yaw - yawToFoe));
  expect(Math.abs(yawDelta)).toBeLessThan(0.35);
  const again = hopped;
  fight.step(0.05, { ...IDLE_INPUT, shiftDown: true });
  fight.step(0.3, IDLE_INPUT);
  const blocked = fight.snapshot().player;
  expect(Math.hypot(blocked.x - again.x, blocked.z - again.z)).toBeLessThan(0.2);

  const side = lockOn({ x: 0, z: -3 });
  const origin = side.snapshot().player;
  side.step(0.05, { ...IDLE_INPUT, moveX: 1, moveZ: 0, shiftDown: true });
  side.step(0.3, { ...IDLE_INPUT, moveX: 1, moveZ: 0 });
  const slid = side.snapshot().player;
  expect(slid.x - origin.x).toBeGreaterThan(1.2);
  expect(Math.abs(slid.z - origin.z)).toBeLessThan(0.6);
});

test('dodge distance and i-frames follow the dojo tunables', () => {
  const fight = createFight({
    enemyCount: 1,
    aggression: 0,
    attackRate: 0,
    script: [{ at: 0.05, enemy: 0 }],
    motor: { ...DEFAULT_MOTOR, evadeDistance: 0, evadeIFrames: 0.2, evadeDuration: 0.16 },
  });
  fight.teleport('player', 0, 0);
  fight.teleport('enemy-0', 0, -1);
  fight.step(1 / 60, { ...IDLE_INPUT, lockDown: true });
  fight.step(1 / 60, IDLE_INPUT);
  let time = 0;
  while (time < 0.6) {
    fight.step(1 / 60, IDLE_INPUT);
    time += 1 / 60;
  }
  fight.step(1 / 60, { ...IDLE_INPUT, shiftDown: true });
  expect(fight.snapshot().player.iframe).toBe(true);
  while (time < 0.95) {
    fight.step(1 / 60, IDLE_INPUT);
    time += 1 / 60;
  }
  expect(fight.snapshot().player.hp).toBe(100);
  expect(Math.hypot(fight.snapshot().player.x, fight.snapshot().player.z)).toBeLessThan(0.15);
});
