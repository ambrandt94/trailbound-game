/**
 * Procedural locomotion posture for the dojo. Placeholder until a private
 * pack supplies Start, Stop, Skid, or Sprint. Those clips load only through
 * VITE_CF_PRIVATE_ANIM_URL and are never committed.
 *
 * Angles are degrees. Pitch is positive forward. Roll is positive when the
 * character's right side lifts.
 */

import type { Gait } from './motor';

/** Local X pitch of the Quaternius CC0 clips in the 2.2.1 humanoid, averaged over the cycle. */
export const QUATERNIUS_BAKED = {
  idle: { hips: -4.8, spine: 0, chest: 21.3, neck: -10.6, head: 7.4 },
  walk: { hips: -0.1, spine: 0, chest: 18.1, neck: -9.1, head: 5.6 },
  run: { hips: 22.6, spine: 0, chest: 31.9, neck: -14.7, head: -14.9 },
} as const;

export interface BakedLean {
  hips: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
}

export interface PostureTuning {
  /** Ceiling on sprint chest pitch, degrees from vertical. */
  maxSprintLean: number;
  /** Peak backward chest pitch during a plant. Positive degrees. */
  skidLean: number;
  /** Hip drop at the peak of a plant, metres. */
  skidCrouch: number;
  /** Plant length, seconds. */
  skidDuration: number;
  /** Inward roll ceiling, degrees. */
  bankMax: number;
  /** 0 leaves the head on the clip. 1 keeps the eyes level. */
  headStabilization: number;
}

export const DEFAULT_POSTURE: PostureTuning = {
  maxSprintLean: 12,
  skidLean: 10,
  skidCrouch: 0.05,
  skidDuration: 0.28,
  bankMax: 6.5,
  headStabilization: 1,
};

/** Names a private pack can register to take a gait away from this solver. */
export const POSTURE_CLIP_NAMES: Record<'sprint' | 'start' | 'stop' | 'skid', readonly string[]> = {
  sprint: ['Sprint'],
  start: ['Start'],
  stop: ['Stop'],
  skid: ['Skid'],
};

/** Thigh and shin lengths on cf-humanoid-29, metres in skeleton space. */
export const CROUCH_LEG = { thigh: 0.14, shin: 0.13 };

const HIP_SHARE = 0.12;
const HIP_LIMIT = 4;
const SPINE_SHARE = 0.38;
const CHEST_SHARE = 0.62;
/** (m/s) * (rad/s) that saturates the bank cap. */
const BANK_FULL = 18;

export interface LocoBlend {
  idle: number;
  walk: number;
  run: number;
}

export interface PostureInput {
  gait: Gait;
  /** 0..1 plant amount from `plantEnvelope`. */
  plant: number;
  speed: number;
  /** Radians per second. Positive turns to the character's right. */
  yawRate: number;
  blend: LocoBlend;
  /** Clip names currently on the body. */
  clips: readonly string[];
  tuning: PostureTuning;
}

export interface BoneAngles {
  hips: number;
  spine: number;
  chest: number;
  neck: number;
  head: number;
}

export interface PosturePose {
  /** Additive local pitch, degrees. */
  pitch: BoneAngles;
  /** Additive local roll, degrees. Hips stay 0 so the feet are not banked. */
  roll: BoneAngles;
  /** World-space hip drop, metres. */
  crouch: number;
  /** Multiplier on the locomotion mixer rate. 0 plants the cycle. */
  strideScale: number;
  /** True when a replacement clip owns this gait. */
  replaced: boolean;
}

const ZERO_BONES: BoneAngles = { hips: 0, spine: 0, chest: 0, neck: 0, head: 0 };

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function slotFor(gait: Gait): keyof typeof POSTURE_CLIP_NAMES | null {
  if (gait === 'sprint' || gait === 'start' || gait === 'stop' || gait === 'skid') return gait;
  return null;
}

export function postureClipName(clips: readonly string[], gait: Gait): string | null {
  const slot = slotFor(gait);
  if (!slot) return null;
  const have = new Set(clips);
  return POSTURE_CLIP_NAMES[slot].find((name) => have.has(name)) ?? null;
}

export function bakedLean(blend: LocoBlend): BakedLean {
  const idle = Math.max(0, blend.idle);
  const walk = Math.max(0, blend.walk);
  const run = Math.max(0, blend.run);
  const sum = idle + walk + run;
  if (!(sum > 0)) return { ...QUATERNIUS_BAKED.idle };
  const mix = (key: keyof BakedLean) =>
    (QUATERNIUS_BAKED.idle[key] * idle +
      QUATERNIUS_BAKED.walk[key] * walk +
      QUATERNIUS_BAKED.run[key] * run) /
    sum;
  return {
    hips: mix('hips'),
    spine: mix('spine'),
    chest: mix('chest'),
    neck: mix('neck'),
    head: mix('head'),
  };
}

/** Shift the locomotion blend toward Idle while a plant is in progress. */
export function blendWithPlant(blend: LocoBlend, plant: number): LocoBlend {
  const p = clamp(plant, 0, 1);
  return {
    idle: blend.idle + (1 - blend.idle) * p,
    walk: blend.walk * (1 - p),
    run: blend.run * (1 - p),
  };
}

export function chainPitch(
  local: BakedLean,
  add: BoneAngles = ZERO_BONES,
): {
  chest: number;
  head: number;
} {
  const chest = local.hips + add.hips + local.spine + add.spine + local.chest + add.chest;
  const head = chest + local.neck + add.neck + local.head + add.head;
  return { chest, head };
}

/** 0 at the ends, 1 through the middle. `duration` is the whole plant. */
export function plantEnvelope(elapsed: number, duration: number): number {
  if (!(duration > 0) || !(elapsed > 0)) return 0;
  const u = elapsed / duration;
  if (u >= 1) return 0;
  if (u < 0.2) return smooth(u / 0.2);
  if (u < 0.45) return 1;
  return 1 - smooth((u - 0.45) / 0.55);
}

function smooth(t: number): number {
  const s = clamp(t, 0, 1);
  return s * s * (3 - 2 * s);
}

/**
 * Knee and thigh pitch that keeps the foot on the ground after a hip drop.
 * `drop` is metres in skeleton space. Angles are degrees of local +X.
 */
export function crouchBend(drop: number): { thigh: number; shin: number } {
  const a = CROUCH_LEG.thigh;
  const b = CROUCH_LEG.shin;
  const d = clamp(drop, 0, (a + b) * 0.45);
  if (d === 0) return { thigh: 0, shin: 0 };
  const c = a + b - d;
  const hip = Math.acos(clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1));
  const knee = Math.acos(clamp((a * a + b * b - c * c) / (2 * a * b), -1, 1));
  // Pelvis rest is 180° around X, so a negative thigh pitch and a positive shin
  // pitch fold the knee toward +Z (the way the body faces) instead of backward.
  return { thigh: (-hip * 180) / Math.PI, shin: ((Math.PI - knee) * 180) / Math.PI };
}

function distributePitch(baked: BakedLean, targetChest: number, headStab: number): BoneAngles {
  const bakedChest = baked.hips + baked.spine + baked.chest;
  const delta = targetChest - bakedChest;
  const hips = clamp(delta * HIP_SHARE, -HIP_LIMIT, HIP_LIMIT);
  const remain = delta - hips;
  const spine = remain * SPINE_SHARE;
  const chest = remain * CHEST_SHARE;
  const worldChest = bakedChest + hips + spine + chest;
  const bakedHead = worldChest + baked.neck + baked.head;
  const headTarget = bakedHead * (1 - clamp(headStab, 0, 1));
  const headDelta = headTarget - bakedHead;
  return {
    hips,
    spine,
    chest,
    neck: headDelta * 0.45,
    head: headDelta * 0.55,
  };
}

function distributeBank(amount: number, headStab: number): BoneAngles {
  const spine = amount * 0.4;
  const chest = amount * 0.6;
  const counter = -(spine + chest) * clamp(headStab, 0, 1);
  return { hips: 0, spine, chest, neck: counter * 0.45, head: counter * 0.55 };
}

function mixAngle(current: BoneAngles, target: BoneAngles, t: number): BoneAngles {
  const mix = (from: number, to: number) => from + (to - from) * t;
  return {
    hips: mix(current.hips, target.hips),
    spine: mix(current.spine, target.spine),
    chest: mix(current.chest, target.chest),
    neck: mix(current.neck, target.neck),
    head: mix(current.head, target.head),
  };
}

/** Ease a pose toward the next one. Stride scale is applied immediately so the feet do not skate. */
export function approachPosture(
  current: PosturePose,
  target: PosturePose,
  dt: number,
  seconds = 0.12,
): PosturePose {
  const t = seconds > 0 ? 1 - Math.exp(-Math.max(0, dt) / seconds) : 1;
  return {
    pitch: mixAngle(current.pitch, target.pitch, t),
    roll: mixAngle(current.roll, target.roll, t),
    crouch: current.crouch + (target.crouch - current.crouch) * t,
    strideScale: target.strideScale,
    replaced: target.replaced,
  };
}

export function resolvePosture(input: PostureInput): PosturePose {
  const tuning = input.tuning;
  const plant = clamp(input.plant, 0, 1);
  const replaced = postureClipName(input.clips, input.gait) !== null;
  const braking = input.gait === 'skid' || input.gait === 'stop';
  const strideScale = braking ? 1 - plant : 1;
  if (replaced) {
    return {
      pitch: { ...ZERO_BONES },
      roll: { ...ZERO_BONES },
      crouch: 0,
      strideScale,
      replaced: true,
    };
  }
  const baked = bakedLean(input.blend);
  const bakedChest = baked.hips + baked.spine + baked.chest;
  let target = bakedChest;
  let crouch = 0;
  let poseGait = false;
  if (input.gait === 'sprint') {
    target = Math.min(bakedChest, tuning.maxSprintLean);
    poseGait = target !== bakedChest;
  } else if (input.gait === 'start') {
    target = Math.min(tuning.maxSprintLean, 8);
    poseGait = true;
  } else if (braking) {
    target = bakedChest * (1 - plant) + -Math.abs(tuning.skidLean) * plant;
    crouch = Math.max(0, tuning.skidCrouch) * plant;
    poseGait = plant > 0;
  }
  const pitch = poseGait
    ? distributePitch(baked, target, tuning.headStabilization)
    : { ...ZERO_BONES };
  const product = Math.max(0, input.speed) * input.yawRate;
  const bankMax = Math.max(0, tuning.bankMax);
  const bank = -bankMax * clamp(product / BANK_FULL, -1, 1) * (1 - plant);
  const roll = distributeBank(bank, tuning.headStabilization);
  return { pitch, roll, crouch, strideScale, replaced: false };
}
