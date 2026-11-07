/**
 * Leaving a 3D area.
 * The walk clamp stops the body 0.35 m inside the area rectangle, so an exit
 * that waits until the body is past the mask never fires: the player hits a
 * wall and the fade stays at zero. The exit margin sits inside that wall.
 * Once the fade is committed it fires once and is not cancelled by the clamp.
 */

/** Inset of `walkClamp` from the area rectangle, in metres. */
export const WALK_CLAMP_MARGIN = 0.35;
/**
 * Metres inside the mask, or inside the clamp, where outward walking commits
 * to leaving. Deeper than a sprint step, so the fade starts before the wall.
 */
export const EDGE_EXIT_MARGIN = 4;
/**
 * Outward walking inside the margin before the fade starts.
 * Short enough that a sprint (about 9 m/s) covers less than the gap between
 * this margin and the walk clamp, so the body is still free when it fires.
 */
export const EDGE_EXIT_HOLD_SEC = 0.35;
/** Outward speed (m/s along the exit normal) that counts as leaving. */
export const EDGE_EXIT_OUTWARD = 0.25;

export type EdgeSide = 'N' | 'E' | 'S' | 'W';

export interface EdgeLeaveState {
  hold: number;
  /** The fade has been requested. Later steps do not request it again. */
  fired: boolean;
}

export function freshEdgeLeave(): EdgeLeaveState {
  return { hold: 0, fired: false };
}

export interface EdgeLeaveStep {
  state: EdgeLeaveState;
  warn: boolean;
  /** True on the single step that should start the fade. */
  startFade: boolean;
}

/**
 * `dist` is metres still inside the exit boundary (mask edge or walk clamp).
 * Negative means already past the mask. `outward` is velocity along the exit normal.
 */
export function stepEdgeLeave(
  state: EdgeLeaveState,
  dist: number,
  outward: number,
  dt: number,
): EdgeLeaveStep {
  if (state.fired) return { state, warn: false, startFade: false };
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const near = Number.isFinite(dist) && dist < EDGE_EXIT_MARGIN;
  const pushing = Number.isFinite(outward) && outward > EDGE_EXIT_OUTWARD;
  const hold = near && pushing ? state.hold + step : 0;
  const startFade = hold >= EDGE_EXIT_HOLD_SEC;
  return {
    state: { hold, fired: startFade },
    warn: !startFade && Number.isFinite(dist) && dist < 7.5,
    startFade,
  };
}

/** Compass side for an outward normal. A corner uses the stronger axis. */
export function edgeSide(ox: number, oz: number): EdgeSide {
  if (Math.abs(ox) > Math.abs(oz)) return ox > 0 ? 'E' : 'W';
  return oz >= 0 ? 'S' : 'N';
}

/** Metres of room before `walkClamp` stops the body. */
export function clampClearance(
  x: number,
  z: number,
  originX: number,
  originZ: number,
  widthM: number,
  depthM: number,
  margin = WALK_CLAMP_MARGIN,
): number {
  const minX = originX + margin;
  const maxX = originX + widthM - margin;
  const minZ = originZ + margin;
  const maxZ = originZ + depthM - margin;
  return Math.min(x - minX, maxX - x, z - minZ, maxZ - z);
}
