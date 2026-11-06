import { expect, test } from 'vitest';
import { DEFAULT_AREA_LOOK } from '../../src/core/state/area-look';
import {
  forgeClip,
  locomotionSample,
  LOCO_FADE_SEC,
  WALK_REF_MPS,
} from '../../src/render/area/locomotion';
import {
  motorParamsFromLook,
  restBody,
  stepMotor,
  takeSimSteps,
  type MotorBody,
  type MotorWorld,
} from '../../src/render/area/motor';

const flat = (y = 0): MotorWorld => ({
  groundY: () => y,
  clampXZ: (_x, _z, nx, nz) => ({ x: nx, z: nz }),
  blocks: [],
});

function hold(
  body: MotorBody,
  world: MotorWorld,
  seconds: number,
  input: {
    ix?: number;
    iz?: number;
    sprint?: boolean;
    sneak?: boolean;
    jump?: boolean;
  },
) {
  const params = { ...motorParamsFromLook(DEFAULT_AREA_LOOK), camYaw: 0 };
  const steps = Math.round(seconds * 120);
  for (let i = 0; i < steps; i++) {
    stepMotor(
      body,
      {
        ix: input.ix ?? 0,
        iz: input.iz ?? 0,
        jumpPressed: i === 0 && !!input.jump,
        dodgePressed: false,
        sneak: !!input.sneak,
        sprint: !!input.sprint,
      },
      params,
      world,
      1 / 120,
    );
  }
  return body;
}

test('run speed settles on the controller default and sprint and sneak scale it', () => {
  const running = hold(restBody(), flat(), 0.6, { ix: 1 });
  expect(Math.hypot(running.vx, running.vz)).toBeCloseTo(DEFAULT_AREA_LOOK.maxSpeed, 1);
  expect(running.st).toBe('run');
  const sprint = hold(restBody(), flat(), 0.6, { ix: 1, sprint: true });
  expect(Math.hypot(sprint.vx, sprint.vz)).toBeCloseTo(DEFAULT_AREA_LOOK.maxSpeed * 1.6, 1);
  expect(sprint.st).toBe('sprint');
  const sneak = hold(restBody(), flat(), 0.6, { ix: 1, sneak: true });
  expect(Math.hypot(sneak.vx, sneak.vz)).toBeCloseTo(DEFAULT_AREA_LOOK.maxSpeed * 0.45, 1);
  expect(sneak.st).toBe('sneak');
});

test('braking stops a runner sooner than acceleration reaches full speed', () => {
  const params = motorParamsFromLook(DEFAULT_AREA_LOOK);
  const body = restBody();
  let reach = 0;
  for (let i = 0; i < 120; i++) {
    stepMotor(
      body,
      { ix: 1, iz: 0, jumpPressed: false, dodgePressed: false, sneak: false, sprint: false },
      params,
      flat(),
      1 / 120,
    );
    reach += 1;
    if (Math.hypot(body.vx, body.vz) > params.maxSpeed - 0.05) break;
  }
  let stop = 0;
  for (let i = 0; i < 120; i++) {
    stepMotor(
      body,
      { ix: 0, iz: 0, jumpPressed: false, dodgePressed: false, sneak: false, sprint: false },
      params,
      flat(),
      1 / 120,
    );
    stop += 1;
    if (Math.hypot(body.vx, body.vz) < 0.05) break;
  }
  expect(stop).toBeLessThan(reach);
  expect(body.st).toBe('idle');
});

test('turning is capped at the turn rate', () => {
  const params = { ...motorParamsFromLook(DEFAULT_AREA_LOOK), camYaw: 0 };
  const body = restBody({ yaw: 0 });
  const before = body.yaw;
  stepMotor(
    body,
    { ix: 1, iz: 0, jumpPressed: false, dodgePressed: false, sneak: false, sprint: false },
    params,
    flat(),
    1 / 120,
  );
  expect(Math.abs(body.yaw - before)).toBeLessThanOrEqual(params.turn / 120 + 1e-6);
});

test('jump, coyote time, slopes, and building collision', () => {
  const params = motorParamsFromLook(DEFAULT_AREA_LOOK);
  const jumper = restBody();
  stepMotor(
    jumper,
    { ix: 0, iz: 0, jumpPressed: true, dodgePressed: false, sneak: false, sprint: false },
    params,
    flat(),
    1 / 120,
  );
  expect(jumper.vy).toBeCloseTo(Math.sqrt(2 * params.grav * params.jumpH) - params.grav / 120);
  expect(jumper.st).toBe('jump');
  expect(jumper.g).toBe(false);

  const ledge: MotorWorld = {
    groundY: (x) => (x > 1 ? -3 : 0),
    clampXZ: (_x, _z, nx, nz) => ({ x: nx, z: nz }),
    blocks: [],
  };
  const coyote = restBody({ x: 0.95, vx: 8, g: true });
  stepMotor(
    coyote,
    { ix: 1, iz: 0, jumpPressed: false, dodgePressed: false, sneak: false, sprint: false },
    params,
    ledge,
    1 / 120,
  );
  expect(coyote.g).toBe(false);
  stepMotor(
    coyote,
    { ix: 0, iz: 0, jumpPressed: true, dodgePressed: false, sneak: false, sprint: false },
    params,
    ledge,
    1 / 120,
  );
  expect(coyote.vy).toBeGreaterThan(1);
  expect(coyote.st).toBe('jump');

  const slope: MotorWorld = {
    groundY: (x) => x * 0.25,
    clampXZ: (_x, _z, nx, nz) => ({ x: nx, z: nz }),
    blocks: [],
  };
  const up = hold(restBody({ x: 1, y: 0.25 }), slope, 0.4, { ix: 1 });
  expect(up.g).toBe(true);
  expect(up.y).toBeCloseTo(up.x * 0.25, 2);
  const down = hold(restBody({ x: 4, y: 1 }), slope, 0.35, { ix: -1 });
  expect(down.g).toBe(true);
  expect(down.y).toBeCloseTo(down.x * 0.25, 2);

  const wall: MotorWorld = {
    groundY: () => 0,
    clampXZ: (_x, _z, nx, nz) => ({ x: nx, z: nz }),
    blocks: [{ x: 0, z: 0, w: 1, d: 1, h: 2 }],
  };
  const blocked = hold(restBody({ x: 2, y: 0 }), wall, 1.2, { ix: -1 });
  expect(blocked.x).toBeGreaterThanOrEqual(0.8 - 1e-3);
});

test('simulation slices follow the time-scale slider', () => {
  expect(takeSimSteps(0, 1 / 120, 1).steps).toBe(1);
  expect(takeSimSteps(0, 1 / 120, 0.1).steps).toBe(0);
  const doubled = takeSimSteps(0, 1 / 120, 2);
  expect(doubled.steps).toBe(2);
  expect(doubled.acc).toBe(0);
});

test('locomotion crossfades and locks the feet to speed', () => {
  const idle = locomotionSample({ state: 'idle', speed: 0, scale: 1, clips: ['Idle', 'Walk'] });
  expect(idle.clip).toBe('Idle');
  expect(idle.fade).toBe(LOCO_FADE_SEC);
  const walk = locomotionSample({ state: 'run', speed: 1.4, scale: 1, clips: ['Idle', 'Walk'] });
  expect(walk.clip).toBe('Walk');
  expect(walk.timeScale).toBeCloseTo(1.4 / WALK_REF_MPS);
  expect(forgeClip(walk, 'Idle')).toBe('Walk');
  const sprint = locomotionSample({
    state: 'sprint',
    speed: 8,
    scale: 1,
    clips: ['Idle', 'Walk', 'Run'],
  });
  expect(sprint.clip).toBe('Run');
  expect(sprint.timeScale).toBeCloseTo(1.28);
  const held = locomotionSample({
    state: 'jump',
    speed: 3,
    scale: 1,
    clips: ['Idle', 'Walk', 'Run'],
  });
  expect(held.clip).toBeNull();
  expect(forgeClip(held, 'Walk')).toBe('Walk');
  const ff3 = locomotionSample({
    state: 'run',
    speed: 2,
    scale: 1,
    clips: ['Idle', 'Walk', 'Run'],
    durations: { Walk: 0.4, Run: 0.233 },
    strides: { Walk: 1.07, Run: 1.98 },
    gaitRate: 0.5,
  });
  expect(ff3.clip).toBe('Walk');
  expect(ff3.timeScale).toBeCloseTo((2 * 0.4) / 1.07);
  const fast = locomotionSample({
    state: 'sprint',
    speed: 5,
    scale: 1,
    clips: ['Idle', 'Walk', 'Run'],
    durations: { Walk: 0.4, Run: 0.233 },
    strides: { Walk: 1.07, Run: 1.98 },
    gaitRate: 0.5,
  });
  expect(fast.clip).toBe('Run');
  expect(fast.timeScale).toBeCloseTo((5 * 0.233) / 1.98);
  const cheer = locomotionSample({
    state: 'emote',
    speed: 0,
    scale: 1,
    clips: ['Idle', 'Walk', 'Cheer'],
  });
  expect(cheer.clip).toBe('Cheer');
});
