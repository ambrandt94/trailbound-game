/**
 * Zoom-in past the 2D cap becomes a dive into the area under the traveller.
 * Each wheel notch, pinch step, or + press adds a fixed share of the ring.
 * One notch is not enough. Two notches, or one pinch that reports two steps,
 * fill it. After input stops the ring holds, then fades slowly.
 */
import { MAP_ZOOM_CAP, smoothstep } from './models';

/** Share of the ring added by one zoom-in event. Two events complete a dive. */
export const MAP_DIVE_NOTCH = 0.55;
/** How long the ring keeps its fill after the last zoom-in. */
export const MAP_DIVE_HOLD_SEC = 1;
/** How long a full ring takes to fade once the hold has ended. */
export const MAP_DIVE_DECAY_SEC = 1.6;

export interface DiveIntentState {
  /** 0..1. 1 means the fade into 3D should start. */
  intent: number;
  /** Seconds the current fill is held before it may decay. */
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
 * Advance the dive cue. `notches` is how many zoom-in events landed on the
 * cap this frame (wheel, pinch, or +). Deep water passes `canEnter` false
 * and never dives. `dt` is clamped so a hitch cannot skip the hold.
 */
export function stepDiveIntent(
  state: DiveIntentState,
  dt: number,
  notches: number,
  atCap: boolean,
  canEnter: boolean,
): DiveStep {
  const step = Math.min(Math.max(dt, 0), 0.05);
  const adds = Number.isFinite(notches) ? Math.max(0, Math.floor(notches)) : 0;
  let pulse = state.pulse;
  let intent = state.intent;
  if (adds > 0 && atCap && canEnter) {
    intent = Math.min(1, intent + adds * MAP_DIVE_NOTCH);
    pulse = MAP_DIVE_HOLD_SEC;
  } else {
    pulse = Math.max(0, pulse - step);
    if (!(pulse > 0 && atCap && canEnter)) {
      intent = Math.max(0, intent - step / MAP_DIVE_DECAY_SEC);
    }
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
