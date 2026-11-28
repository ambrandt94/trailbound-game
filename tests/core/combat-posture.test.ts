import { expect, test } from 'vitest';
import {
  DEFAULT_POSTURE,
  QUATERNIUS_BAKED,
  bakedLean,
  approachPosture,
  blendWithPlant,
  chainPitch,
  crouchBend,
  plantEnvelope,
  resolvePosture,
  type LocoBlend,
  type PostureTuning,
} from '../../src/core/combat/posture';

const RUN: LocoBlend = { idle: 0, walk: 0, run: 1 };
const IDLE: LocoBlend = { idle: 1, walk: 0, run: 0 };
const WALK: LocoBlend = { idle: 0, walk: 1, run: 0 };

function solve(
  patch: Partial<Omit<Parameters<typeof resolvePosture>[0], 'tuning'>> & {
    tuning?: Partial<PostureTuning>;
  } = {},
) {
  const tuning = { ...DEFAULT_POSTURE, ...patch.tuning };
  return resolvePosture({
    gait: 'sprint',
    plant: 0,
    speed: 7,
    yawRate: 0,
    blend: RUN,
    clips: [],
    ...patch,
    tuning,
  });
}

test('sprint chest pitch stays inside the cap when the run clip is already hunched', () => {
  const baked = bakedLean(RUN);
  const bakedChest = chainPitch(baked).chest;
  expect(bakedChest).toBeGreaterThan(DEFAULT_POSTURE.maxSprintLean);
  const pose = solve();
  const world = chainPitch(baked, pose.pitch);
  expect(world.chest).toBeCloseTo(DEFAULT_POSTURE.maxSprintLean, 5);
  expect(Math.abs(pose.pitch.hips)).toBeLessThanOrEqual(4);
  expect(Math.abs(pose.pitch.chest)).toBeGreaterThan(Math.abs(pose.pitch.spine));
  expect(Math.abs(pose.pitch.spine)).toBeGreaterThan(Math.abs(pose.pitch.hips));
  expect(world.head).toBeCloseTo(0, 4);
});

test('raising the sprint cap stops pulling the torso past the clip', () => {
  const baked = bakedLean(RUN);
  const pose = solve({ tuning: { maxSprintLean: 80 } });
  expect(pose.pitch).toEqual({ hips: 0, spine: 0, chest: 0, neck: 0, head: 0 });
  expect(chainPitch(baked, pose.pitch).chest).toBeCloseTo(chainPitch(baked).chest, 5);
});

test('walk and jog keep the clip pose', () => {
  for (const gait of ['walk', 'run'] as const) {
    const blend = gait === 'walk' ? WALK : RUN;
    const pose = solve({ gait, blend, speed: gait === 'walk' ? 1.6 : 4.2 });
    expect(pose.pitch).toEqual({ hips: 0, spine: 0, chest: 0, neck: 0, head: 0 });
    expect(chainPitch(bakedLean(blend), pose.pitch).chest).toBeCloseTo(
      chainPitch(bakedLean(blend)).chest,
      5,
    );
  }
});

test('a blended idle and run still lands on the sprint cap', () => {
  const blend: LocoBlend = { idle: 0.5, walk: 0, run: 0.5 };
  const pose = solve({ blend });
  expect(chainPitch(bakedLean(blend), pose.pitch).chest).toBeCloseTo(
    DEFAULT_POSTURE.maxSprintLean,
    5,
  );
  const idleChest = chainPitch(QUATERNIUS_BAKED.idle).chest;
  const runChest = chainPitch(QUATERNIUS_BAKED.run).chest;
  expect(chainPitch(bakedLean(blend)).chest).toBeCloseTo((idleChest + runChest) / 2, 5);
});

test('head stabilization can be eased off', () => {
  const baked = bakedLean(RUN);
  const loose = solve({ tuning: { headStabilization: 0 } });
  const world = chainPitch(baked, loose.pitch);
  expect(world.chest).toBeCloseTo(DEFAULT_POSTURE.maxSprintLean, 5);
  expect(loose.pitch.neck).toBeCloseTo(0, 5);
  expect(loose.pitch.head).toBeCloseTo(0, 5);
  expect(world.head).toBeCloseTo(world.chest + baked.neck + baked.head, 4);
  const half = solve({ tuning: { headStabilization: 0.5 } });
  const mid = chainPitch(baked, half.pitch);
  expect(mid.head).toBeCloseTo((world.chest + baked.neck + baked.head) * 0.5, 3);
});

test('a skid plant is a short spine lean and a crouch, then it is over', () => {
  expect(DEFAULT_POSTURE.skidDuration).toBeGreaterThanOrEqual(0.2);
  expect(DEFAULT_POSTURE.skidDuration).toBeLessThanOrEqual(0.35);
  expect(plantEnvelope(0, DEFAULT_POSTURE.skidDuration)).toBe(0);
  expect(plantEnvelope(DEFAULT_POSTURE.skidDuration * 0.3, DEFAULT_POSTURE.skidDuration)).toBe(1);
  expect(plantEnvelope(DEFAULT_POSTURE.skidDuration, DEFAULT_POSTURE.skidDuration)).toBe(0);
  expect(plantEnvelope(1, DEFAULT_POSTURE.skidDuration)).toBe(0);

  const pose = solve({ gait: 'skid', plant: 1, blend: IDLE, speed: 2 });
  const world = chainPitch(bakedLean(IDLE), pose.pitch);
  expect(world.chest).toBeCloseTo(-DEFAULT_POSTURE.skidLean, 5);
  expect(Math.abs(pose.pitch.hips)).toBeLessThanOrEqual(4);
  expect(Math.abs(pose.pitch.chest)).toBeGreaterThan(0);
  expect(pose.crouch).toBeCloseTo(DEFAULT_POSTURE.skidCrouch, 5);
  expect(pose.strideScale).toBeCloseTo(0, 5);
  expect(pose.roll.hips).toBe(0);

  const early = solve({ gait: 'stop', plant: 0, blend: RUN, speed: 6 });
  expect(early.pitch.spine).toBe(0);
  expect(early.crouch).toBe(0);
  expect(early.strideScale).toBe(1);
});

test('re-acceleration uses a small forward lean under the sprint cap', () => {
  const pose = solve({ gait: 'start', blend: IDLE, speed: 1 });
  const world = chainPitch(bakedLean(IDLE), pose.pitch);
  expect(world.chest).toBeGreaterThan(0);
  expect(world.chest).toBeLessThanOrEqual(DEFAULT_POSTURE.maxSprintLean);
  expect(world.chest).toBeCloseTo(8, 5);
  expect(world.head).toBeCloseTo(0, 4);
});

test('turn bank stays inside the cap and scales with speed times turn rate', () => {
  const still = solve({ gait: 'run', speed: 0, yawRate: 4 });
  expect(still.roll.spine + still.roll.chest).toBeCloseTo(0, 5);
  const straight = solve({ gait: 'sprint', speed: 8, yawRate: 0 });
  expect(straight.roll.spine + straight.roll.chest).toBeCloseTo(0, 5);

  const hard = solve({ gait: 'run', speed: 8, yawRate: 4, blend: RUN });
  const hardRoll = hard.roll.spine + hard.roll.chest;
  expect(hardRoll).toBeCloseTo(-DEFAULT_POSTURE.bankMax, 5);
  expect(hard.roll.hips).toBe(0);
  expect(Math.abs(hard.roll.chest)).toBeGreaterThan(Math.abs(hard.roll.spine));

  const gentle = solve({ gait: 'run', speed: 3, yawRate: 1, blend: RUN });
  const gentleRoll = gentle.roll.spine + gentle.roll.chest;
  expect(gentleRoll).toBeLessThan(0);
  expect(Math.abs(gentleRoll)).toBeLessThan(DEFAULT_POSTURE.bankMax);
  expect(Math.abs(gentleRoll)).toBeCloseTo(DEFAULT_POSTURE.bankMax * (3 / 18), 5);

  const left = solve({ gait: 'run', speed: 8, yawRate: -4, blend: RUN });
  expect(left.roll.spine + left.roll.chest).toBeCloseTo(DEFAULT_POSTURE.bankMax, 5);
});

test('bank eases out during a plant and the head can stay level', () => {
  const planted = solve({ gait: 'skid', plant: 1, speed: 8, yawRate: 4, blend: IDLE });
  expect(planted.roll.spine + planted.roll.chest).toBeCloseTo(0, 5);
  const banking = solve({
    gait: 'sprint',
    speed: 8,
    yawRate: 4,
    tuning: { headStabilization: 1 },
  });
  const roll = banking.roll.spine + banking.roll.chest + banking.roll.neck + banking.roll.head;
  expect(roll).toBeCloseTo(0, 4);
});

test('a replacement clip suppresses the procedural lean', () => {
  const pose = solve({ clips: ['Sprint'], plant: 1, gait: 'sprint', yawRate: 3, speed: 8 });
  expect(pose.replaced).toBe(true);
  expect(pose.pitch).toEqual({ hips: 0, spine: 0, chest: 0, neck: 0, head: 0 });
  expect(pose.roll).toEqual({ hips: 0, spine: 0, chest: 0, neck: 0, head: 0 });
  expect(pose.crouch).toBe(0);
  const skid = solve({ clips: ['Skid'], gait: 'skid', plant: 1, blend: IDLE });
  expect(skid.replaced).toBe(true);
  expect(skid.strideScale).toBeCloseTo(0, 5);
  expect(solve({ clips: ['Stop'], gait: 'walk' }).replaced).toBe(false);
});

test('posture eases in and stride scale does not lag', () => {
  const from = solve({ gait: 'run', blend: RUN, speed: 4 });
  const to = solve({ gait: 'sprint', blend: RUN, speed: 7 });
  const mid = approachPosture(from, to, 0.001);
  expect(Math.abs(mid.pitch.chest)).toBeGreaterThan(0);
  expect(Math.abs(mid.pitch.chest)).toBeLessThan(Math.abs(to.pitch.chest));
  const settled = approachPosture(from, to, 2);
  expect(settled.pitch.chest).toBeCloseTo(to.pitch.chest, 3);
  const planted = solve({ gait: 'skid', plant: 1, blend: IDLE, speed: 2 });
  expect(approachPosture(from, planted, 0.001).strideScale).toBeCloseTo(0, 5);
});

test('the plant blend goes to idle and the crouch bends the knee forward', () => {
  const mixed = blendWithPlant(RUN, 1);
  expect(mixed).toEqual({ idle: 1, walk: 0, run: 0 });
  const half = blendWithPlant({ idle: 0.2, walk: 0.5, run: 0.3 }, 0.5);
  expect(half.idle + half.walk + half.run).toBeCloseTo(1, 5);
  expect(half.idle).toBeGreaterThan(0.2);
  const bend = crouchBend(0.04);
  expect(bend.thigh).toBeLessThan(0);
  expect(bend.shin).toBeGreaterThan(0);
  expect(crouchBend(0)).toEqual({ thigh: 0, shin: 0 });
});
