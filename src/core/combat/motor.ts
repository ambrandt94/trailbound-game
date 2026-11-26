/**
 * Dojo planar motor. Wish vectors are already camera-relative world axes
 * (`cameraWish`): +z south, +x east, magnitude is the stick (clamped to 1).
 * Locked movement uses that same wish. It does not orbit the target.
 * The body yaw while locked is owned by the lock turn, not by this motor.
 */

export const MOVE_DEADZONE = 0.08;

export interface MotorTuning {
  /** Unlocked acceleration, metres per second squared. */
  accel: number;
  /** Unlocked coast down when the stick is released. */
  decel: number;
  /** Extra brake while skidding or reversing. */
  brake: number;
  /** Unlocked facing turn, radians per second. */
  turnRate: number;
  /** Sprint top speed as a multiple of the weapon's move speed. */
  sprintMul: number;
  /** Acceleration while sprinting. Lower than `accel` so sprint carries. */
  sprintAccel: number;
  /** Locked acceleration. Higher than free running: the stance is snappy. */
  lockedAccel: number;
  /** Locked top speed as a fraction of the weapon's move speed. */
  lockedSpeed: number;
  /** Dodge travel, metres. A short reposition, not a leap. */
  evadeDistance: number;
  /** Dodge length, seconds. */
  evadeDuration: number;
  /** Recovery after a dodge before another can start. */
  evadeCooldown: number;
  /** Damage ignore at the start of a dodge. 0 disables it. */
  evadeIFrames: number;
  /** Base skid length. Scaled up when speed is above a normal run. */
  skidTime: number;
}

export const DEFAULT_MOTOR: MotorTuning = {
  accel: 14,
  decel: 18,
  brake: 32,
  turnRate: 7.5,
  sprintMul: 1.62,
  sprintAccel: 11,
  lockedAccel: 36,
  lockedSpeed: 0.58,
  evadeDistance: 1.9,
  evadeDuration: 0.2,
  evadeCooldown: 0.48,
  evadeIFrames: 0.12,
  skidTime: 0.14,
};

export type Gait =
  'idle' | 'start' | 'walk' | 'run' | 'sprint' | 'stop' | 'skid' | 'guard' | 'strafe' | 'backpedal';

export type RelativeMove = 'idle' | 'forward' | 'back' | 'left' | 'right';

export type DodgeKind = 'forward' | 'back' | 'left' | 'right';

export interface MotorBody {
  vx: number;
  vz: number;
  yaw: number;
  /** Seconds of brake still to play. */
  skid: number;
  /** Seconds the current press has been building from rest. */
  startT: number;
}

export interface MotorStep {
  vx: number;
  vz: number;
  yaw: number;
  skid: number;
  startT: number;
  /** Metres travelled this step. */
  dx: number;
  dz: number;
  speed: number;
  gait: Gait;
  /** -1 left, +1 right, 0 otherwise. */
  strafeSide: -1 | 0 | 1;
}

export function wrapAngle(angle: number): number {
  let next = angle;
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
}

export function facingForward(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** Character right on the ground. Facing +Z, right is +X. */
export function facingRight(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) };
}

/**
 * Stick wish relative to a facing yaw. 0 is the way the body looks
 * (toward the lock). Positive yaw delta is the body's right.
 */
export function relativeMove(wishX: number, wishZ: number, facingYaw: number): RelativeMove {
  const mag = Math.hypot(wishX, wishZ);
  if (!(mag >= MOVE_DEADZONE)) return 'idle';
  const delta = wrapAngle(Math.atan2(wishX, wishZ) - facingYaw);
  const abs = Math.abs(delta);
  if (abs <= Math.PI / 4) return 'forward';
  if (abs >= (3 * Math.PI) / 4) return 'back';
  return delta > 0 ? 'right' : 'left';
}

/** No stick is a backstep. Everything else follows `relativeMove`. */
export function dodgeKind(wishX: number, wishZ: number, facingYaw: number): DodgeKind {
  const rel = relativeMove(wishX, wishZ, facingYaw);
  if (rel === 'idle' || rel === 'back') return 'back';
  if (rel === 'forward') return 'forward';
  return rel;
}

export function dodgeDirection(kind: DodgeKind, facingYaw: number): { x: number; z: number } {
  const forward = facingForward(facingYaw);
  const right = facingRight(facingYaw);
  if (kind === 'forward') return forward;
  if (kind === 'back') return { x: -forward.x, z: -forward.z };
  if (kind === 'right') return right;
  return { x: -right.x, z: -right.z };
}

/** Ease-out so the dodge is quick and settles. `t` is 0..1. */
export function dodgeEase(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

function clampWish(x: number, z: number): { x: number; z: number; mag: number } {
  let mag = Math.hypot(x, z);
  if (!(mag >= MOVE_DEADZONE)) return { x: 0, z: 0, mag: 0 };
  if (mag > 1) {
    x /= mag;
    z /= mag;
    mag = 1;
  }
  return { x, z, mag };
}

function turnToward(yaw: number, target: number, max: number): number {
  const delta = wrapAngle(target - yaw);
  if (Math.abs(delta) <= max) return target;
  return yaw + Math.sign(delta) * max;
}

/**
 * One planar step. `speed` is the weapon's free top speed.
 * `facingYaw` is the locked body's current facing, used only to name the gait.
 */
export function stepMotor(
  body: MotorBody,
  wishX: number,
  wishZ: number,
  dt: number,
  speed: number,
  locked: boolean,
  sprint: boolean,
  facingYaw: number,
  tune: MotorTuning,
): MotorStep {
  const step = Math.max(0, dt);
  const wish = clampWish(wishX, wishZ);
  const sprinting = !locked && sprint && wish.mag > 0;
  const top = Math.max(0, speed) * (locked ? tune.lockedSpeed : sprinting ? tune.sprintMul : 1);
  const tx = wish.x * top;
  const tz = wish.z * top;
  let vx = body.vx;
  let vz = body.vz;
  let skid = body.skid;
  const prev = Math.hypot(vx, vz);
  const reversing =
    wish.mag > 0.2 && prev > 0.7 && vx * wish.x + vz * wish.z < -0.25 * prev * wish.mag;
  const hardStop = wish.mag === 0 && prev > Math.max(1.4, top * 0.55);
  if ((reversing || hardStop) && skid <= 0) {
    const base = Math.max(0.5, speed * (locked ? tune.lockedSpeed : 1));
    skid = tune.skidTime * Math.max(1, prev / base);
  }
  const braking = skid > 0;
  if (braking) skid = Math.max(0, skid - step);
  const rate = braking
    ? tune.brake
    : locked
      ? tune.lockedAccel
      : sprinting
        ? tune.sprintAccel
        : tune.accel;
  const targetX = braking ? 0 : tx;
  const targetZ = braking ? 0 : tz;
  const dxv = targetX - vx;
  const dzv = targetZ - vz;
  const gap = Math.hypot(dxv, dzv);
  const allow = Math.max(0, rate) * step;
  if (gap <= allow || gap < 1e-8) {
    vx = targetX;
    vz = targetZ;
  } else {
    vx += (dxv / gap) * allow;
    vz += (dzv / gap) * allow;
  }
  if (braking && Math.hypot(vx, vz) < 0.2) {
    vx = 0;
    vz = 0;
    skid = 0;
  }
  let yaw = body.yaw;
  if (!locked && wish.mag > 0) {
    yaw = turnToward(yaw, Math.atan2(wish.x, wish.z), Math.max(0, tune.turnRate) * step);
  } else if (!locked && Math.hypot(vx, vz) > 0.35) {
    yaw = turnToward(yaw, Math.atan2(vx, vz), Math.max(0, tune.turnRate) * step);
  }
  const nextSpeed = Math.hypot(vx, vz);
  let startT = body.startT;
  if (wish.mag === 0) startT = 0;
  else if (nextSpeed < Math.max(0.8, top * 0.45)) startT += step;
  else startT = Math.max(startT, 1);
  const rel = relativeMove(wish.x, wish.z, facingYaw);
  let gait: Gait;
  let strafeSide: -1 | 0 | 1 = 0;
  if (locked) {
    if (wish.mag === 0 && nextSpeed < 0.3) gait = 'guard';
    else if (rel === 'back') gait = 'backpedal';
    else if (rel === 'left' || rel === 'right') {
      gait = 'strafe';
      strafeSide = rel === 'right' ? 1 : -1;
    } else gait = nextSpeed >= Math.min(top, 2.4) && top > 2.4 ? 'run' : 'walk';
  } else if (skid > 0 && nextSpeed > 0.35) gait = 'skid';
  else if (wish.mag === 0) gait = nextSpeed > 0.3 ? 'stop' : 'idle';
  else if (startT < 0.22 && nextSpeed < top * 0.7) gait = 'start';
  else if (sprinting && nextSpeed > speed * 0.85) gait = 'sprint';
  else if (nextSpeed >= Math.min(3.05, Math.max(2.2, top * 0.72))) gait = 'run';
  else gait = 'walk';
  return {
    vx,
    vz,
    yaw,
    skid,
    startT,
    dx: vx * step,
    dz: vz * step,
    speed: nextSpeed,
    gait,
    strafeSide,
  };
}
