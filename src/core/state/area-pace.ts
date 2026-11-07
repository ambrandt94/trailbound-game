/**
 * On-screen metres per real second in a 3D area, and the Walk clip's stride.
 *
 * The controller demo's unlabeled move is 5.5 m/s (its "run"), and Shift is
 * 5.5 × 1.6 = 8.8 m/s. This town uses that demo's metre: one street tile is
 * 1 m, a door leaf is about 2.05 m, and the hero is about 1.40 m. The same
 * 5.5 m/s is a sprint beside a person. The 120 Hz motor already takes dt in
 * seconds and steps once per tick, so the speed was not a doubled frame.
 *
 * Forge Walk (`packs/core.glb`) is one 2/3 s cycle. The planted foot travels
 * 0.163 m backward during its stance, and a cycle is two steps (0.326 m), on
 * a skeleton whose head bone sits at 0.692 m. Scaled to the 1.40 m hero that
 * is 0.660 m per cycle: 0.99 m/s at timeScale 1. Playback is
 * speed × duration / stride, then capped so a walk cannot run away from the clip.
 */
export const HERO_HEIGHT_M = 1.4;
export const FORGE_SKELETON_HEAD_M = 0.692;
export const FORGE_WALK_DURATION_S = 2 / 3;
/** One foot's backward travel while it is planted, in clip metres. */
export const FORGE_WALK_STANCE_M = 0.163;

/** Metres the hero covers in one Walk cycle at timeScale 1 and scale 1. */
export const FORGE_WALK_STRIDE_M =
  FORGE_WALK_STANCE_M * 2 * (HERO_HEIGHT_M / FORGE_SKELETON_HEAD_M);

export const AREA_PACE = {
  sneak: 0.8,
  walk: 1.6,
  run: 3.5,
  sprint: 5.5,
  /** Seconds Shift is held before a jog becomes a sprint. */
  sprintCharge: 0.45,
  /** Procedural pawn: metres of travel in one full left-right cycle. */
  blockStride: 1.4,
  /** Walk and sneak stay near the clip. Faster gaits may play quicker. */
  walkPlaybackCap: 1.1,
  fastPlaybackCap: 2.2,
  forgeWalkDuration: FORGE_WALK_DURATION_S,
  forgeWalkStride: FORGE_WALK_STRIDE_M,
} as const;

export type GaitName = 'sneak' | 'walk' | 'run' | 'sprint';

export function gaitSpeed(name: GaitName): number {
  return AREA_PACE[name];
}

/**
 * Mixer rate that carries `stride` metres per cycle at `speed`.
 * `scale` is the body's uniform scale. The cap keeps a short clip from buzzing.
 */
export function clipTimeScale(
  speed: number,
  duration: number,
  stride: number,
  scale = 1,
  maxRate = Number.POSITIVE_INFINITY,
): number {
  const sized = stride * (scale > 0 ? scale : 1);
  if (!(duration > 0) || !(sized > 0) || !(speed > 0)) return 1;
  const rate = (speed * duration) / sized;
  const cap = maxRate > 0 ? maxRate : Number.POSITIVE_INFINITY;
  return Math.min(cap, Math.max(0.2, rate));
}

export function playbackCap(state: string): number {
  if (state === 'walk' || state === 'sneak' || state === 'carry') return AREA_PACE.walkPlaybackCap;
  return AREA_PACE.fastPlaybackCap;
}
