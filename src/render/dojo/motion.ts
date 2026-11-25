/**
 * Idle and Walk are the only body clips the runtime exposes (KayKit on
 * Character Forge 2, the forge clips on v1). Every other fight beat is a
 * tween on top of Idle. This list is the placeholder set.
 */
export const PLACEHOLDER_MOTIONS = [
  'jab',
  'cross',
  'kick',
  'heavy-kick',
  'flurry',
  'sweep',
  'uppercut',
  'throw',
  'chop',
  'cleave',
  'hook',
  'heavy-hook',
  'timber',
  'pull-chop',
  'rive',
  'axe-counter',
  'hammer-swing',
  'hammer-overhead',
  'hammer-sweep',
  'slam',
  'quake',
  'crush',
  'crater',
  'hammer-counter',
  'stab',
  'carve',
  'dash-stab',
  'storm',
  'flicker',
  'venom',
  'riposte',
  'slash',
  'heavy-slash',
  'bash',
  'guard-bash',
  'crescent',
  'follow',
  'riposte-line',
  'parry',
  'enemy-strike',
  'stagger',
  'down',
  'whiff',
] as const;

export type PlaceholderMotion = (typeof PLACEHOLDER_MOTIONS)[number];

export interface MotionPose {
  lunge: number;
  lean: number;
  hop: number;
  weaponPitch: number;
  weaponYaw: number;
  weaponRoll: number;
  offPitch: number;
}

const ZERO: MotionPose = {
  lunge: 0,
  lean: 0,
  hop: 0,
  weaponPitch: 0,
  weaponYaw: 0,
  weaponRoll: 0,
  offPitch: 0,
};

interface Tune {
  lunge: number;
  lean: number;
  hop: number;
  pitch: number;
  yaw: number;
  roll: number;
  off: number;
}

const TUNE: Record<string, Tune> = {
  jab: { lunge: 0.08, lean: 0.12, hop: 0, pitch: 1.4, yaw: 0.2, roll: 0.1, off: 0.2 },
  cross: { lunge: 0.12, lean: 0.2, hop: 0, pitch: 1.7, yaw: 0.7, roll: 0.2, off: 0.2 },
  kick: { lunge: 0.1, lean: -0.15, hop: 0.08, pitch: 0.3, yaw: 0.1, roll: 0.4, off: 0 },
  'heavy-kick': { lunge: 0.14, lean: -0.25, hop: 0.16, pitch: 0.4, yaw: 0.2, roll: 0.5, off: 0 },
  flurry: { lunge: 0.06, lean: 0.1, hop: 0.02, pitch: 1.5, yaw: 0.5, roll: 0.3, off: 0.8 },
  sweep: { lunge: 0.08, lean: 0.05, hop: 0.04, pitch: 0.4, yaw: 1.1, roll: 0.2, off: 0 },
  uppercut: { lunge: 0.06, lean: -0.35, hop: 0.18, pitch: -1.6, yaw: 0.1, roll: 0.2, off: 0.2 },
  throw: { lunge: 0.16, lean: 0.35, hop: 0, pitch: 0.8, yaw: 0.4, roll: 0.6, off: 0.8 },
  chop: { lunge: 0.08, lean: 0.18, hop: 0, pitch: 1.5, yaw: 0.8, roll: 0.2, off: 0 },
  cleave: { lunge: 0.06, lean: -0.2, hop: 0.04, pitch: -2.2, yaw: 0.1, roll: 0.15, off: 0 },
  hook: { lunge: 0.1, lean: 0.1, hop: 0, pitch: 0.6, yaw: 1.4, roll: -0.4, off: 0 },
  'heavy-hook': { lunge: 0.12, lean: 0.16, hop: 0, pitch: 0.8, yaw: 1.6, roll: -0.5, off: 0 },
  timber: { lunge: 0.1, lean: 0.22, hop: 0, pitch: 1.8, yaw: 0.9, roll: 0.3, off: 0 },
  'pull-chop': { lunge: 0.12, lean: 0.2, hop: 0, pitch: 1.3, yaw: 1.1, roll: 0.2, off: 0 },
  rive: { lunge: 0.1, lean: 0.24, hop: 0.02, pitch: 2, yaw: 0.6, roll: 0.4, off: 0 },
  'axe-counter': { lunge: 0.14, lean: 0.2, hop: 0, pitch: 1.2, yaw: 0.9, roll: 0.3, off: 0 },
  'hammer-swing': { lunge: 0.05, lean: 0.28, hop: 0, pitch: 1.2, yaw: 1.6, roll: 0.2, off: 0.4 },
  'hammer-overhead': {
    lunge: 0.04,
    lean: -0.3,
    hop: 0.06,
    pitch: -2.4,
    yaw: 0,
    roll: 0.1,
    off: 0.3,
  },
  'hammer-sweep': { lunge: 0.04, lean: 0.16, hop: 0, pitch: 0.5, yaw: 1.8, roll: 0.2, off: 0.3 },
  slam: { lunge: 0.02, lean: 0.4, hop: 0.22, pitch: -2.1, yaw: 0, roll: 0, off: 0.5 },
  quake: { lunge: 0.04, lean: 0.3, hop: 0.05, pitch: 1.1, yaw: 1.7, roll: 0.2, off: 0.4 },
  crush: { lunge: 0.06, lean: 0.32, hop: 0.04, pitch: 1.6, yaw: 0.8, roll: 0.2, off: 0.3 },
  crater: { lunge: 0.02, lean: 0.45, hop: 0.2, pitch: -2.2, yaw: 0.2, roll: 0, off: 0.6 },
  'hammer-counter': { lunge: 0.12, lean: 0.3, hop: 0, pitch: 0.9, yaw: 0.5, roll: 0.2, off: 0.4 },
  stab: { lunge: 0.1, lean: 0.08, hop: 0, pitch: 1.1, yaw: 0.15, roll: 0.1, off: 1.1 },
  carve: { lunge: 0.08, lean: 0.1, hop: 0, pitch: 1.3, yaw: 0.7, roll: 0.4, off: 1.2 },
  'dash-stab': { lunge: 0.18, lean: 0.22, hop: 0, pitch: 1.35, yaw: 0.1, roll: 0.05, off: 0.4 },
  storm: { lunge: 0.08, lean: 0.08, hop: 0.03, pitch: 1.4, yaw: 0.6, roll: 0.5, off: 1.3 },
  flicker: { lunge: 0.16, lean: 0.18, hop: 0, pitch: 1.2, yaw: 0.3, roll: 0.2, off: 0.5 },
  venom: { lunge: 0.1, lean: 0.12, hop: 0, pitch: 1.25, yaw: 0.5, roll: 0.35, off: 1.1 },
  riposte: { lunge: 0.12, lean: 0.1, hop: 0, pitch: 1.3, yaw: 0.4, roll: 0.2, off: 0.9 },
  slash: { lunge: 0.08, lean: 0.14, hop: 0, pitch: 1.3, yaw: 0.9, roll: 0.15, off: 0.15 },
  'heavy-slash': { lunge: 0.1, lean: 0.22, hop: 0, pitch: 1.8, yaw: 1.1, roll: 0.2, off: 0.2 },
  bash: { lunge: 0.12, lean: 0.1, hop: 0, pitch: 0.2, yaw: 0.1, roll: 0, off: 1.4 },
  'guard-bash': { lunge: 0.14, lean: 0.16, hop: 0, pitch: 0.25, yaw: 0.15, roll: 0, off: 1.7 },
  crescent: { lunge: 0.08, lean: 0.16, hop: 0, pitch: 1.2, yaw: 1.4, roll: 0.2, off: 0.3 },
  follow: { lunge: 0.1, lean: 0.12, hop: 0, pitch: 0.4, yaw: 0.3, roll: 0.1, off: 1.3 },
  'riposte-line': { lunge: 0.12, lean: 0.18, hop: 0, pitch: 1.5, yaw: 0.8, roll: 0.2, off: 0.8 },
  parry: { lunge: 0.1, lean: -0.12, hop: 0, pitch: 0.7, yaw: 0.4, roll: 0.1, off: 1.1 },
  'enemy-strike': { lunge: 0.1, lean: 0.4, hop: 0, pitch: 1.1, yaw: 0.2, roll: 0, off: 0.3 },
  stagger: { lunge: -0.06, lean: -0.45, hop: 0, pitch: 0.4, yaw: 0, roll: 0, off: 0.2 },
  down: { lunge: 0.04, lean: 0.9, hop: -0.35, pitch: 0.6, yaw: 0.2, roll: 0.4, off: 0.4 },
  whiff: { lunge: 0.05, lean: 0.2, hop: 0, pitch: 0.5, yaw: 0.3, roll: 0, off: 0.4 },
};

function strikeCurve(phase: number): number {
  const p = Math.max(0, Math.min(1, phase));
  if (p < 0.32) return -0.85 * (p / 0.32);
  if (p < 0.55) return -0.85 + 1.9 * ((p - 0.32) / 0.23);
  return 1.05 * (1 - (p - 0.55) / 0.45);
}

/** Tween for one placeholder beat. Idle and Walk return a rest pose. */
export function motionPose(motion: string, phase: number): MotionPose {
  if (!motion || motion === 'idle' || motion === 'walk') return ZERO;
  if (motion === 'enemy-strike') {
    const wind = phase < 0.72 ? phase / 0.72 : 1;
    const fire = phase < 0.72 ? 0 : (phase - 0.72) / 0.28;
    return {
      lunge: -0.06 * wind + 0.16 * fire,
      lean: -0.4 * wind + 0.45 * fire,
      hop: 0,
      weaponPitch: -0.8 * wind + 1.1 * fire,
      weaponYaw: 0.2 * fire,
      weaponRoll: 0,
      offPitch: 0.3 * wind,
    };
  }
  const tune = TUNE[motion] ?? TUNE.jab;
  if (!tune) return ZERO;
  const swing = strikeCurve(phase);
  const hop = tune.hop * Math.sin(Math.max(0, Math.min(1, phase)) * Math.PI);
  return {
    lunge: tune.lunge * Math.max(0, swing),
    lean: tune.lean * swing,
    hop: motion === 'down' ? tune.hop : hop,
    weaponPitch: tune.pitch * swing,
    weaponYaw: tune.yaw * swing,
    weaponRoll: tune.roll * swing,
    offPitch: tune.off * Math.max(0, swing),
  };
}
