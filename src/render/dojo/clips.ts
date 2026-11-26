/**
 * Full-body attack and stance clips for the cf-humanoid-29 skeleton.
 * Quaternius in the public 2.2.1 bundle only mounts Idle, Walk, and Run
 * (plus one generic Attack1H that is not on the public policy and does not
 * match per-move hit frames). These clips are authored here as data so a
 * later mocap pass can replace a single archetype.
 *
 * Tracks are additive local deltas on top of whatever Idle, Walk, or Run
 * is playing. Limb bones point along local +Y. Identity means "no extra
 * rotation", so legs keep the locomotion cycle while a guard or swing
 * layers on the torso and arms.
 */
import {
  AdditiveAnimationBlendMode,
  AnimationClip,
  Euler,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import type { Archetype } from '../../core/combat/archetype';
import type { DodgeKind } from '../../core/combat/motor';

type EulerDeg = [number, number, number];

interface Pose {
  /** Bone name to euler degrees, local XYZ delta. */
  rot: Record<string, EulerDeg>;
  /** Hips offset in metres, additive. */
  hips?: [number, number, number];
}

interface Key {
  t: number;
  pose: Pose;
}

const BONES = [
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'Clavicle_R',
  'UpperArm_R',
  'LowerArm_R',
  'Hand_R',
  'Clavicle_L',
  'UpperArm_L',
  'LowerArm_L',
  'Hand_L',
  'Thigh_R',
  'Knee_R',
  'Shin_R',
  'Thigh_L',
  'Knee_L',
  'Shin_L',
] as const;

function eulerQuat(deg: EulerDeg): [number, number, number, number] {
  const q = new Quaternion().setFromEuler(
    new Euler((deg[0] * Math.PI) / 180, (deg[1] * Math.PI) / 180, (deg[2] * Math.PI) / 180, 'XYZ'),
  );
  return [q.x, q.y, q.z, q.w];
}

function pose(rot: Record<string, EulerDeg>, hips?: [number, number, number]): Pose {
  return { rot, hips };
}

export function makeAdditiveClip(name: string, keys: readonly Key[]): AnimationClip {
  const times = keys.map((key) => key.t);
  const duration = times[times.length - 1] ?? 1;
  const tracks = BONES.map((bone) => {
    const values: number[] = [];
    for (const key of keys) {
      const deg = key.pose.rot[bone] ?? [0, 0, 0];
      values.push(...eulerQuat(deg));
    }
    return new QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
  });
  const hipsValues: number[] = [];
  for (const key of keys) {
    const hips = key.pose.hips ?? [0, 0, 0];
    hipsValues.push(hips[0], hips[1], hips[2]);
  }
  tracks.push(new VectorKeyframeTrack('Hips.position', times, hipsValues));
  const clip = new AnimationClip(name, duration, tracks);
  clip.blendMode = AdditiveAnimationBlendMode;
  return clip;
}

const ready = (extra: Record<string, EulerDeg> = {}): Pose =>
  pose({
    Chest: [-6, 0, 0],
    UpperArm_R: [-28, 0, 22],
    LowerArm_R: [-48, 0, 0],
    UpperArm_L: [-32, 0, -24],
    LowerArm_L: [-50, 0, 0],
    ...extra,
  });

const ARCHETYPES: Record<Archetype, Key[]> = {
  horizontal: [
    { t: 0, pose: ready() },
    {
      t: 0.22,
      pose: pose(
        {
          Spine: [0, -14, 0],
          Chest: [-4, -32, 8],
          Hips: [0, 16, 0],
          UpperArm_R: [-58, 10, 36],
          LowerArm_R: [-78, 0, 8],
          Hand_R: [0, 0, -12],
          UpperArm_L: [-18, 0, -16],
          LowerArm_L: [-36, 0, 0],
          Thigh_R: [16, 0, 0],
          Thigh_L: [-8, 0, 0],
        },
        [0, 0, -0.04],
      ),
    },
    {
      t: 0.42,
      pose: pose(
        {
          Spine: [6, 18, 0],
          Chest: [10, 36, -6],
          Hips: [0, -20, 0],
          UpperArm_R: [-8, 18, -62],
          LowerArm_R: [-18, 0, -8],
          Hand_R: [0, 0, -24],
          UpperArm_L: [-24, 0, -10],
          Clavicle_R: [0, 0, -8],
          Thigh_L: [-26, 0, 0],
          Knee_L: [24, 0, 0],
          Thigh_R: [8, 0, 0],
        },
        [0.02, 0.02, 0.12],
      ),
    },
    {
      t: 0.72,
      pose: pose(
        {
          Chest: [4, 18, -4],
          Hips: [0, -8, 0],
          UpperArm_R: [-16, 8, -28],
          LowerArm_R: [-30, 0, 0],
          Thigh_L: [-8, 0, 0],
        },
        [0, 0, 0.04],
      ),
    },
    { t: 1, pose: ready() },
  ],
  vertical: [
    { t: 0, pose: ready() },
    {
      t: 0.22,
      pose: pose(
        {
          Spine: [-12, 0, 0],
          Chest: [-22, -8, 0],
          Hips: [-8, 0, 0],
          UpperArm_R: [-118, 0, 18],
          LowerArm_R: [-40, 0, 0],
          UpperArm_L: [-70, 0, -16],
          LowerArm_L: [-30, 0, 0],
          Head: [-12, 0, 0],
          Thigh_R: [10, 0, 0],
        },
        [0, 0.04, -0.06],
      ),
    },
    {
      t: 0.42,
      pose: pose(
        {
          Spine: [14, 0, 0],
          Chest: [28, 4, 0],
          Hips: [10, 0, 0],
          UpperArm_R: [18, 0, 10],
          LowerArm_R: [-24, 0, 0],
          Hand_R: [16, 0, 0],
          UpperArm_L: [-10, 0, -8],
          Head: [10, 0, 0],
          Thigh_L: [-22, 0, 0],
          Knee_L: [18, 0, 0],
          Thigh_R: [12, 0, 0],
        },
        [0, -0.02, 0.1],
      ),
    },
    {
      t: 0.72,
      pose: pose({
        Chest: [8, 0, 0],
        UpperArm_R: [-12, 0, 14],
        LowerArm_R: [-36, 0, 0],
        Thigh_L: [-6, 0, 0],
      }),
    },
    { t: 1, pose: ready() },
  ],
  thrust: [
    { t: 0, pose: ready() },
    {
      t: 0.22,
      pose: pose(
        {
          Chest: [-4, -16, 4],
          Hips: [0, 10, 0],
          UpperArm_R: [-24, 8, 28],
          LowerArm_R: [-92, 0, 6],
          Hand_R: [0, 0, -8],
          UpperArm_L: [-20, 0, -18],
          LowerArm_L: [-40, 0, 0],
          Thigh_R: [8, 0, 0],
        },
        [0, 0, -0.02],
      ),
    },
    {
      t: 0.42,
      pose: pose(
        {
          Spine: [6, 6, 0],
          Chest: [8, 8, -2],
          Hips: [4, -6, 0],
          UpperArm_R: [-74, 6, 8],
          LowerArm_R: [-8, 0, 0],
          Hand_R: [0, 0, -6],
          Clavicle_R: [0, 0, -6],
          UpperArm_L: [-16, 0, -8],
          Thigh_L: [-24, 0, 0],
          Knee_L: [16, 0, 0],
          Thigh_R: [6, 0, 0],
        },
        [0, 0.01, 0.16],
      ),
    },
    {
      t: 0.7,
      pose: pose(
        {
          Chest: [2, 4, 0],
          UpperArm_R: [-40, 0, 12],
          LowerArm_R: [-28, 0, 0],
          Thigh_L: [-8, 0, 0],
        },
        [0, 0, 0.04],
      ),
    },
    { t: 1, pose: ready() },
  ],
  bash: [
    { t: 0, pose: ready() },
    {
      t: 0.22,
      pose: pose(
        {
          Chest: [-16, 8, 0],
          Hips: [-6, 8, 0],
          UpperArm_L: [-36, 0, -18],
          LowerArm_L: [-44, 0, 0],
          UpperArm_R: [-20, 0, 16],
          LowerArm_R: [-36, 0, 0],
          Thigh_R: [-18, 0, 0],
          Thigh_L: [12, 0, 0],
        },
        [0, 0, -0.04],
      ),
    },
    {
      t: 0.42,
      pose: pose(
        {
          Spine: [10, 0, 0],
          Chest: [22, -6, 4],
          Hips: [8, -4, 0],
          UpperArm_L: [-68, 0, -12],
          LowerArm_L: [-16, 0, 0],
          Clavicle_L: [0, 0, 8],
          UpperArm_R: [-22, 0, 20],
          LowerArm_R: [-40, 0, 0],
          Thigh_R: [-62, 0, 6],
          Knee_R: [48, 0, 0],
          Shin_R: [10, 0, 0],
          Thigh_L: [14, 0, 0],
          Head: [8, 0, 0],
        },
        [0, 0.06, 0.14],
      ),
    },
    {
      t: 0.72,
      pose: pose({
        Chest: [6, 0, 0],
        UpperArm_L: [-28, 0, -16],
        Thigh_R: [-12, 0, 0],
        Knee_R: [12, 0, 0],
      }),
    },
    { t: 1, pose: ready() },
  ],
};

const STANCE: Record<string, Key[]> = {
  guard: [
    {
      t: 0,
      pose: pose({
        Chest: [-8, 0, 0],
        UpperArm_R: [-34, 4, 26],
        LowerArm_R: [-58, 0, 4],
        Hand_R: [0, 0, -8],
        UpperArm_L: [-42, 0, -32],
        LowerArm_L: [-62, 0, -4],
        Hand_L: [0, 0, 8],
        Head: [-4, 0, 0],
        Thigh_R: [6, 0, 4],
        Thigh_L: [6, 0, -4],
        Knee_R: [8, 0, 0],
        Knee_L: [8, 0, 0],
      }),
    },
    {
      t: 0.6,
      pose: pose(
        {
          Chest: [-7, 2, 0],
          UpperArm_R: [-32, 4, 24],
          LowerArm_R: [-56, 0, 4],
          UpperArm_L: [-40, 0, -30],
          LowerArm_L: [-60, 0, -4],
          Head: [-3, 1, 0],
          Thigh_R: [5, 0, 4],
          Thigh_L: [7, 0, -4],
          Knee_R: [7, 0, 0],
          Knee_L: [9, 0, 0],
        },
        [0, 0.012, 0],
      ),
    },
    {
      t: 1.2,
      pose: pose({
        Chest: [-8, 0, 0],
        UpperArm_R: [-34, 4, 26],
        LowerArm_R: [-58, 0, 4],
        Hand_R: [0, 0, -8],
        UpperArm_L: [-42, 0, -32],
        LowerArm_L: [-62, 0, -4],
        Hand_L: [0, 0, 8],
        Head: [-4, 0, 0],
        Thigh_R: [6, 0, 4],
        Thigh_L: [6, 0, -4],
        Knee_R: [8, 0, 0],
        Knee_L: [8, 0, 0],
      }),
    },
  ],
  'strafe-right': [
    { t: 0, pose: pose({}) },
    {
      t: 0.5,
      pose: pose(
        {
          Chest: [0, 14, -8],
          Hips: [0, -8, 0],
          Spine: [0, 6, 0],
          Thigh_R: [8, 0, 10],
          Thigh_L: [-6, 0, -8],
          UpperArm_R: [-8, 0, 6],
          UpperArm_L: [-6, 0, -4],
        },
        [0.04, 0, 0],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  'strafe-left': [
    { t: 0, pose: pose({}) },
    {
      t: 0.5,
      pose: pose(
        {
          Chest: [0, -14, 8],
          Hips: [0, 8, 0],
          Spine: [0, -6, 0],
          Thigh_L: [8, 0, -10],
          Thigh_R: [-6, 0, 8],
          UpperArm_L: [-8, 0, -6],
          UpperArm_R: [-6, 0, 4],
        },
        [-0.04, 0, 0],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  backpedal: [
    { t: 0, pose: pose({}) },
    {
      t: 0.5,
      pose: pose(
        {
          Chest: [-16, 0, 0],
          Spine: [-6, 0, 0],
          Hips: [-6, 0, 0],
          Head: [-6, 0, 0],
          Thigh_R: [12, 0, 0],
          Thigh_L: [10, 0, 0],
          UpperArm_R: [-10, 0, 8],
          UpperArm_L: [-12, 0, -8],
        },
        [0, 0, -0.03],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  start: [
    { t: 0, pose: pose({}) },
    {
      t: 0.45,
      pose: pose(
        {
          Chest: [16, 0, 0],
          Spine: [6, 0, 0],
          Hips: [8, 0, 0],
          Thigh_L: [-16, 0, 0],
          Thigh_R: [10, 0, 0],
        },
        [0, -0.02, 0.04],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  stop: [
    { t: 0, pose: pose({}) },
    {
      t: 0.4,
      pose: pose(
        {
          Chest: [-18, 0, 0],
          Hips: [-8, 0, 0],
          Thigh_L: [14, 0, 0],
          Thigh_R: [12, 0, 0],
          Knee_L: [16, 0, 0],
          Knee_R: [14, 0, 0],
        },
        [0, -0.03, -0.02],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  skid: [
    { t: 0, pose: pose({}) },
    {
      t: 0.35,
      pose: pose(
        {
          Chest: [-26, 8, 0],
          Spine: [-8, 0, 0],
          Hips: [-10, 6, 0],
          Thigh_L: [18, 0, 0],
          Thigh_R: [16, 0, 0],
          Knee_L: [22, 0, 0],
          Knee_R: [20, 0, 0],
          Head: [-8, 0, 0],
        },
        [0, -0.04, -0.02],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  sprint: [
    { t: 0, pose: pose({}) },
    {
      t: 0.5,
      pose: pose(
        {
          Chest: [22, 0, 0],
          Spine: [8, 0, 0],
          Hips: [6, 0, 0],
          Head: [6, 0, 0],
        },
        [0, 0, 0.03],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
};

const DODGES: Record<DodgeKind, Key[]> = {
  left: [
    { t: 0, pose: pose({}) },
    {
      t: 0.45,
      pose: pose(
        {
          Chest: [0, -10, 16],
          Hips: [0, 8, 12],
          Spine: [0, -6, 6],
          UpperArm_R: [-20, 0, 18],
          UpperArm_L: [-16, 0, -22],
          Thigh_L: [10, 0, -14],
          Thigh_R: [-8, 0, 10],
          Knee_L: [28, 0, 0],
          Knee_R: [18, 0, 0],
          Head: [0, -6, 4],
        },
        [-0.06, 0.22, 0],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  right: [
    { t: 0, pose: pose({}) },
    {
      t: 0.45,
      pose: pose(
        {
          Chest: [0, 10, -16],
          Hips: [0, -8, -12],
          Spine: [0, 6, -6],
          UpperArm_L: [-20, 0, -18],
          UpperArm_R: [-16, 0, 22],
          Thigh_R: [10, 0, 14],
          Thigh_L: [-8, 0, -10],
          Knee_R: [28, 0, 0],
          Knee_L: [18, 0, 0],
          Head: [0, 6, -4],
        },
        [0.06, 0.22, 0],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  back: [
    { t: 0, pose: pose({}) },
    {
      t: 0.48,
      pose: pose(
        {
          Chest: [-28, 0, 0],
          Spine: [-10, 0, 0],
          Hips: [-18, 0, 0],
          Head: [-16, 0, 0],
          UpperArm_R: [-48, 0, 20],
          UpperArm_L: [-48, 0, -20],
          LowerArm_R: [-30, 0, 0],
          LowerArm_L: [-30, 0, 0],
          Thigh_R: [36, 0, 0],
          Thigh_L: [34, 0, 0],
          Knee_R: [48, 0, 0],
          Knee_L: [46, 0, 0],
        },
        [0, 0.28, -0.04],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
  forward: [
    { t: 0, pose: pose({}) },
    {
      t: 0.42,
      pose: pose(
        {
          Chest: [18, 0, 0],
          Spine: [8, 0, 0],
          Hips: [12, 0, 0],
          Head: [6, 0, 0],
          UpperArm_R: [-36, 0, 12],
          LowerArm_R: [-24, 0, 0],
          UpperArm_L: [-20, 0, -10],
          Thigh_L: [-32, 0, 0],
          Knee_L: [20, 0, 0],
          Thigh_R: [16, 0, 0],
        },
        [0, 0.16, 0.08],
      ),
    },
    { t: 1, pose: pose({}) },
  ],
};

const cache = new Map<string, AnimationClip>();

function cached(name: string, keys: readonly Key[]): AnimationClip {
  const found = cache.get(name);
  if (found) return found;
  const clip = makeAdditiveClip(name, keys);
  cache.set(name, clip);
  return clip;
}

export function attackClip(kind: Archetype): AnimationClip {
  return cached(`attack-${kind}`, ARCHETYPES[kind]);
}

export function stanceClip(
  name:
    'guard' | 'strafe-right' | 'strafe-left' | 'backpedal' | 'start' | 'stop' | 'skid' | 'sprint',
): AnimationClip {
  return cached(name, STANCE[name] ?? STANCE.guard ?? []);
}

export function dodgeClip(kind: DodgeKind): AnimationClip {
  return cached(`dodge-${kind}`, DODGES[kind]);
}
