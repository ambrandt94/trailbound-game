/**
 * Clip choice and playback rate shared by Character Forge bodies and skinned props.
 * Forge clips are in place (no root motion). Walk rate is speed / 1.4, the same
 * reference the controller uses. Clips that publish a stride are foot-locked instead.
 */

export const LOCO_FADE_SEC = 0.16;
/** Metres per second at which a scale-1 walk clip still reads as a walk. */
export const WALK_MAX_MPS = 2.2;
/** Authored Forge walk speed at timeScale 1. */
export const WALK_REF_MPS = 1.4;

export interface LocoSampleInput {
  state: string;
  speed: number;
  scale: number;
  clips: readonly string[];
  durations?: Readonly<Record<string, number>>;
  strides?: Readonly<Record<string, number>>;
  /** FF3 rips play at half rate. Forge bodies omit this and use 1. */
  gaitRate?: number;
}

export interface LocoSample {
  /** Null keeps the clip already playing. Jump and fall do that. */
  clip: string | null;
  timeScale: number;
  fade: number;
}

function hasClip(clips: ReadonlySet<string>, name: string): boolean {
  return clips.has(name);
}

function resolveClip(name: string, clips: ReadonlySet<string>): string | null {
  if (hasClip(clips, name)) return name;
  if (name === 'Run' && hasClip(clips, 'Walk')) return 'Walk';
  if (name === 'Cheer' && hasClip(clips, 'Interact')) return 'Interact';
  if ((name === 'Interact' || name === 'Cheer' || name === 'Carry') && hasClip(clips, 'Idle')) {
    return 'Idle';
  }
  if (hasClip(clips, 'Idle')) return 'Idle';
  return null;
}

export function locomotionSample(input: LocoSampleInput): LocoSample {
  const clips = new Set(input.clips);
  const rate = input.gaitRate ?? 1;
  const size = input.scale > 0 ? input.scale : 1;
  const speed = Number.isFinite(input.speed) ? Math.max(0, input.speed) : 0;
  const state = input.state;
  let name: string | null;
  let timeScale = rate;
  if (state === 'sprint' || state === 'dodge' || state === 'run') {
    const walked = !!input.strides && speed < WALK_MAX_MPS * size;
    name = walked ? 'Walk' : 'Run';
  } else if (state === 'sneak' || state === 'carry') name = 'Walk';
  else if (state === 'ride') {
    name = 'Idle';
    timeScale = rate * 0.8;
  } else if (state === 'emote' || state === 'yell') {
    name = hasClip(clips, 'Cheer') ? 'Cheer' : 'Interact';
  } else if (state === 'jump' || state === 'fall') name = null;
  else name = 'Idle';

  if (name) name = resolveClip(name, clips);
  const stride = name && input.strides ? input.strides[name] : undefined;
  const duration = name && input.durations ? input.durations[name] : undefined;
  if (name && stride && duration && (name === 'Walk' || name === 'Run')) {
    timeScale = Math.max(0.15, (speed * duration) / (stride * size));
  } else if (!input.strides && name === 'Run') {
    timeScale = state === 'sprint' ? 1.28 : state === 'dodge' ? 1.45 : 1;
  } else if (!input.strides && (name === 'Walk' || name === 'Carry')) {
    timeScale = Math.max(0.35, speed / WALK_REF_MPS);
  }
  return {
    clip: name,
    timeScale,
    fade: name ? LOCO_FADE_SEC : 0,
  };
}

/** Forge and the placeholder only expose Idle and Walk. Run and sneak map onto Walk. */
export function forgeClip(sample: LocoSample, current: 'Idle' | 'Walk'): 'Idle' | 'Walk' {
  if (!sample.clip) return current;
  return sample.clip === 'Idle' ? 'Idle' : 'Walk';
}
