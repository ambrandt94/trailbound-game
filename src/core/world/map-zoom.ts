/**
 * Zoom-in past the 2D cap becomes a dive into the area under the traveller.
 * One wheel tick or one + press arms a short pulse. The dive only fires after
 * zoom-in input keeps arriving for `MAP_DIVE_HOLD_SEC`.
 */
import { MAP_ZOOM_CAP, smoothstep } from './models';

/** How long zoom-in must continue at the cap before the fade starts. */
export const MAP_DIVE_HOLD_SEC = 0.55;
/** How long one zoom-in tick keeps the dive armed. Shorter than the hold. */
export const MAP_ZOOM_PULSE_SEC = 0.22;
/** How fast a released dive cue fades back out. */
export const MAP_DIVE_DECAY_SEC = 0.3;
/** Scale where zoom-in starts easing the camera back onto the traveller. */
export const MAP_DIVE_EASE_SCALE = MAP_ZOOM_CAP * 0.82;

export interface DiveIntentState {
  /** 0..1. 1 means the fade into 3D should start. */
  intent: number;
  /** Seconds of zoom-in credit still on the clock. */
  pulse: number;
}

export function emptyDiveIntent(): DiveIntentState {
  return { intent: 0, pulse: 0 };
}

export interface DiveStep {
  state: DiveIntentState;
  dive: boolean;
}

/**
 * Advance the dive cue. `zoomingIn` is true on a frame that received zoom-in
 * at the cap (wheel, pinch, or a held +). Deep water passes `canEnter` false
 * and never dives. `dt` is clamped so a hitch cannot turn one tick into a dive.
 */
export function stepDiveIntent(
  state: DiveIntentState,
  dt: number,
  zoomingIn: boolean,
  atCap: boolean,
  canEnter: boolean,
): DiveStep {
  const step = Math.min(Math.max(dt, 0), 0.05);
  let pulse = state.pulse;
  let intent = state.intent;
  if (zoomingIn && atCap && canEnter) pulse = MAP_ZOOM_PULSE_SEC;
  if (pulse > 0 && atCap && canEnter) {
    intent = Math.min(1, intent + step / MAP_DIVE_HOLD_SEC);
    pulse = Math.max(0, pulse - step);
  } else {
    pulse = Math.max(0, pulse - step);
    intent = Math.max(0, intent - step / MAP_DIVE_DECAY_SEC);
  }
  const dive = intent >= 1 && atCap && canEnter;
  if (dive) {
    intent = 0;
    pulse = 0;
  }
  return { state: { intent, pulse }, dive };
}

/**
 * Edge darkening while the map is near the cap, then the dive ring's progress.
 * Zero on deep water, so the cap there is only a stop.
 */
export function diveCueAmount(scale: number, intent: number, canEnter: boolean): number {
  if (!canEnter) return 0;
  const approach = smoothstep(MAP_ZOOM_CAP * 0.88, MAP_ZOOM_CAP, scale) * 0.4;
  const held = Number.isFinite(intent) ? Math.min(1, Math.max(0, intent)) : 0;
  return Math.min(1, Math.max(approach, held));
}

/** True when a zoom-in at this scale should pull the camera onto the traveller. */
export function zoomEasesToHero(scale: number, factor: number): boolean {
  return factor > 1.001 && scale >= MAP_DIVE_EASE_SCALE;
}
