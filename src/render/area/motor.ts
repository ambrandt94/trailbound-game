import type { AreaLook } from '../../core/state/area-look';

/** Downhill glue. Uphill already snaps because the body is below the new ground. */
export const STEP_SNAP = 0.45;

export interface MotorBlock {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y0?: number;
}

export interface MotorBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  g: boolean;
  ct: number;
  bt: number;
  st: string;
  t: number;
  lt: number;
  dc: number;
  dodge: number;
  sm: number;
  ddx: number;
  ddz: number;
  sx: number;
  sy: number;
  vsx: number;
  vsy: number;
  ph: number;
  emT: number;
  yl: boolean;
  lock: boolean;
  carry: { k?: string } | null;
  mount: object | null;
}

export interface MotorInput {
  ix: number;
  iz: number;
  jumpPressed: boolean;
  dodgePressed: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface MotorParams {
  maxSpeed: number;
  sprintMult: number;
  sneakMult: number;
  horseMult: number;
  accel: number;
  decel: number;
  turn: number;
  airCtl: number;
  jumpH: number;
  grav: number;
  fall: number;
  coyote: number;
  buffer: number;
  dodgeSpeed: number;
  dodgeTime: number;
  dodgeCd: number;
  stretch: number;
  camYaw: number;
  radius: number;
  stepSnap: number;
}

export interface MotorWorld {
  groundY(x: number, z: number, y: number): number;
  clampXZ(fromX: number, fromZ: number, toX: number, toZ: number): { x: number; z: number };
  blocks: readonly MotorBlock[];
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function motorParamsFromLook(look: AreaLook, radius = 0.3): MotorParams {
  return {
    maxSpeed: look.maxSpeed,
    sprintMult: look.sprintMult,
    sneakMult: look.sneakMult,
    horseMult: look.horseMult,
    accel: look.accel,
    decel: look.decel,
    turn: look.turn,
    airCtl: look.airCtl,
    jumpH: look.jumpH,
    grav: look.grav,
    fall: look.fall,
    coyote: look.coyote,
    buffer: look.buffer,
    dodgeSpeed: look.dodgeSpeed,
    dodgeTime: look.dodgeTime,
    dodgeCd: look.dodgeCd,
    stretch: 0.5,
    camYaw: look.camYaw,
    radius,
    stepSnap: STEP_SNAP,
  };
}

/**
 * One simulation tick of the controller motor.
 * Speeds, coyote, jump buffer, and step collision match the original step().
 * A short downhill snap keeps the body on slopes the original left in the air.
 */
export function stepMotor(
  body: MotorBody,
  input: MotorInput,
  params: MotorParams,
  world: MotorWorld,
  dt: number,
): void {
  const ix = clamp(input.ix, -1, 1);
  const iz = clamp(input.iz, -1, 1);
  const th = (params.camYaw * Math.PI) / 180;
  let mx = Math.cos(th) * ix - Math.sin(th) * iz;
  let mz = -Math.sin(th) * ix - Math.cos(th) * iz;
  let mag = Math.hypot(mx, mz);
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
    mag = 1;
  }
  if (body.emT > 0 || body.lock) {
    mx = 0;
    mz = 0;
    mag = 0;
  }
  if (input.jumpPressed) body.bt = params.buffer;
  body.bt -= dt;
  body.ct = body.g ? params.coyote : body.ct - dt;
  body.lt -= dt;
  body.dc -= dt;
  body.t += dt;
  const blocked = !!body.carry || !!body.mount;
  if (
    input.dodgePressed &&
    body.dc <= 0 &&
    body.dodge <= 0 &&
    !blocked &&
    body.emT <= 0 &&
    !body.lock
  ) {
    body.dodge = params.dodgeTime;
    body.dc = params.dodgeTime + params.dodgeCd;
    const dx = mag > 0.1 ? mx / mag : Math.sin(body.yaw);
    const dz = mag > 0.1 ? mz / mag : Math.cos(body.yaw);
    body.ddx = dx;
    body.ddz = dz;
    body.yaw = Math.atan2(dx, dz);
    body.lt = 0;
  }
  if (body.dodge > 0) {
    body.dodge -= dt;
    const k = Math.max(0, body.dodge / params.dodgeTime);
    body.vx = body.ddx * params.dodgeSpeed * (0.3 + 0.7 * k);
    body.vz = body.ddz * params.dodgeSpeed * (0.3 + 0.7 * k);
  } else {
    const sm = body.mount
      ? params.horseMult * (input.sprint ? 1.2 : 1)
      : body.carry
        ? body.carry.k === 'crate'
          ? 0.65
          : 0.8
        : input.sneak
          ? params.sneakMult
          : input.sprint
            ? params.sprintMult
            : 1;
    body.sm = sm;
    const ctl = body.g ? 1 : params.airCtl;
    const tx = mx * params.maxSpeed * sm;
    const tz = mz * params.maxSpeed * sm;
    const dx = tx - body.vx;
    const dz = tz - body.vz;
    const len = Math.hypot(dx, dz);
    const a = (mag > 0.05 ? params.accel : params.decel) * ctl * dt;
    if (len <= a) {
      body.vx = tx;
      body.vz = tz;
    } else {
      body.vx += (dx / len) * a;
      body.vz += (dz / len) * a;
    }
    if (mag > 0.15) {
      const ty = Math.atan2(mx, mz);
      const d = ((ty - body.yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const m = params.turn * dt;
      body.yaw += clamp(d, -m, m);
    }
  }
  if (body.bt > 0 && body.ct > 0 && body.dodge <= 0 && !blocked && body.emT <= 0 && !body.lock) {
    body.vy = Math.sqrt(2 * params.grav * params.jumpH);
    body.bt = 0;
    body.ct = 0;
    body.g = false;
    body.lt = 0;
    body.sy = 1 + 0.3 * params.stretch;
    body.sx = 1 - 0.2 * params.stretch;
  }
  body.vy = Math.max(body.vy - params.grav * (body.vy < 0 ? params.fall : 1) * dt, -40);
  const moved = world.clampXZ(body.x, body.z, body.x + body.vx * dt, body.z + body.vz * dt);
  body.x = moved.x;
  body.z = moved.z;
  for (const block of world.blocks) {
    if (block.h > body.y + 0.3 && !(block.y0 != null && body.y < block.y0 - 0.25)) {
      const cx = clamp(body.x, block.x - block.w / 2, block.x + block.w / 2);
      const cz = clamp(body.z, block.z - block.d / 2, block.z + block.d / 2);
      const dx = body.x - cx;
      const dz = body.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist < params.radius) {
        if (dist > 1e-4) {
          body.x = cx + (dx / dist) * params.radius;
          body.z = cz + (dz / dist) * params.radius;
        } else body.x += params.radius;
      }
    }
  }
  const was = body.g;
  body.y += body.vy * dt;
  const gh = world.groundY(body.x, body.z, body.y);
  body.g = false;
  if (body.y <= gh && body.vy <= 0) {
    const v0 = body.vy;
    body.y = gh;
    body.vy = 0;
    body.g = true;
    if (!was && v0 < -6) {
      const k = clamp(-v0 / 20, 0.2, 1);
      body.lt = 0.05 + 0.1 * k;
      body.sy = 1 - 0.4 * k * params.stretch;
      body.sx = 1 + 0.3 * k * params.stretch;
    }
  } else if (
    was &&
    body.vy <= 0 &&
    body.dodge <= 0 &&
    body.y > gh &&
    body.y - gh <= params.stepSnap
  ) {
    body.y = gh;
    body.vy = 0;
    body.g = true;
  }
  const ty = body.g ? 1 : 1 + clamp(Math.abs(body.vy) / 40, 0, 0.2) * params.stretch;
  const tx2 = body.g ? 1 : 1 - clamp(Math.abs(body.vy) / 80, 0, 0.1) * params.stretch;
  body.vsy += ((ty - body.sy) * 500 - body.vsy * 22) * dt;
  body.sy += body.vsy * dt;
  body.vsx += ((tx2 - body.sx) * 500 - body.vsx * 22) * dt;
  body.sx += body.vsx * dt;
  const spd = Math.hypot(body.vx, body.vz);
  let ns: string;
  if (body.emT > 0) ns = body.yl ? 'yell' : 'emote';
  else if (body.dodge > 0) ns = 'dodge';
  else if (body.mount) ns = spd > 0.4 ? 'ride' : 'idle';
  else if (body.carry && body.g) ns = 'carry';
  else if (body.g) {
    ns =
      body.lt > 0 && mag < 0.1
        ? 'land'
        : spd > 0.4
          ? body.sm < 1
            ? 'sneak'
            : body.sm > 1
              ? 'sprint'
              : 'run'
          : 'idle';
  } else ns = body.vy > 0 ? 'jump' : 'fall';
  if (ns !== body.st) {
    body.st = ns;
    body.t = 0;
  }
  body.ph += spd * dt * 1.9;
}

/** Fixed 120 Hz slices. `slow` matches the original time-scale slider. */
export function takeSimSteps(
  acc: number,
  dt: number,
  slow: number,
  step = 1 / 120,
  cap = 4,
): { acc: number; steps: number } {
  const rate = Number.isFinite(slow) ? slow : 1;
  let next = acc + Math.max(0, dt) * rate;
  let steps = 0;
  while (next >= step - 1e-8 && steps < cap) {
    next -= step;
    steps += 1;
  }
  if (next < 1e-8) next = 0;
  return { acc: next, steps };
}

export function restBody(partial: Partial<MotorBody> = {}): MotorBody {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: Math.PI,
    g: true,
    ct: 0,
    bt: 0,
    st: 'idle',
    t: 0,
    lt: 0,
    dc: 0,
    dodge: 0,
    sm: 1,
    ddx: 0,
    ddz: 1,
    sx: 1,
    sy: 1,
    vsx: 0,
    vsy: 0,
    ph: 0,
    emT: 0,
    yl: false,
    lock: false,
    carry: null,
    mount: null,
    ...partial,
  };
}
