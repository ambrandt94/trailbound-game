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
/** Once near the edge, stay "near" until this far in: the exit zone has a lip, not a line. */
export const EDGE_EXIT_MARGIN_OFF = 5;
/** "Leaving" warning: shows inside this many metres of the edge... */
export const EDGE_WARN_ON_M = 7.5;
/** ...and hides only once the hero is this far in, so a wobble at 7.5 m cannot flip it. */
export const EDGE_WARN_OFF_M = 9;
/** Once shown, the warning stays at least this long. */
export const EDGE_WARN_MIN_SEC = 0.5;
/** Outward speed below this (a real turn back) cancels the exit timer at once. */
export const EDGE_TURN_BACK = -0.25;
/** A dip in pushing that is not a turn (a stumble, a stick wobble) drains the timer at this × real time. */
export const EDGE_HOLD_DRAIN = 2;

export type EdgeSide = 'N' | 'E' | 'S' | 'W';

export interface EdgeLeaveState {
  hold: number;
  /** The fade has been requested. Later steps do not request it again. */
  fired: boolean;
  /** Inside the exit zone (with its lip). */
  near: boolean;
  /** The "leaving" warning is showing. */
  warn: boolean;
  /** Seconds the warning has been showing. */
  warnSec: number;
}

export function freshEdgeLeave(): EdgeLeaveState {
  return { hold: 0, fired: false, near: false, warn: false, warnSec: 0 };
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
 *
 * Every switch has two thresholds, so a hero standing or jittering on one
 * cannot flip it frame to frame:
 * - near the edge: in at `EDGE_EXIT_MARGIN`, out at `EDGE_EXIT_MARGIN_OFF`;
 * - the warning: on at `EDGE_WARN_ON_M`, off at `EDGE_WARN_OFF_M`, and at
 *   least `EDGE_WARN_MIN_SEC` on;
 * - the exit timer: runs while pushing out, resets on a real turn back, and
 *   only drains (`EDGE_HOLD_DRAIN`) through a slack frame.
 */
export function stepEdgeLeave(
  state: EdgeLeaveState,
  dist: number,
  outward: number,
  dt: number,
): EdgeLeaveStep {
  if (state.fired) return { state, warn: false, startFade: false };
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const finite = Number.isFinite(dist);
  const near = finite && dist < (state.near ? EDGE_EXIT_MARGIN_OFF : EDGE_EXIT_MARGIN);
  const out = Number.isFinite(outward) ? outward : 0;
  const pushing = out > EDGE_EXIT_OUTWARD;
  const turned = out < EDGE_TURN_BACK;
  let hold = 0;
  if (near && pushing) hold = state.hold + step;
  else if (near && !turned) hold = Math.max(0, state.hold - step * EDGE_HOLD_DRAIN);
  const startFade = hold >= EDGE_EXIT_HOLD_SEC;
  let warn = finite && dist < (state.warn ? EDGE_WARN_OFF_M : EDGE_WARN_ON_M);
  const shownSec = state.warn ? state.warnSec + step : 0;
  if (state.warn && !warn && shownSec < EDGE_WARN_MIN_SEC) warn = true;
  return {
    state: { hold, fired: startFade, near, warn: warn && !startFade, warnSec: warn ? shownSec : 0 },
    warn: !startFade && warn,
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

/**
 * Nearest point outside the playable mask, for a hero inside it: the distance
 * in metres and the vector toward it. Out-of-grid counts as outside. Null when
 * nothing is outside within `limit` metres. `m` is metres per mask cell.
 *
 * This is a distance field, so it moves smoothly as the hero walks. The
 * gradient normal it replaces went flat past ~1.5 cells from the edge and fell
 * back to "away from the nearest neighbour cell", which flips every cell and
 * made the exit warning and exit timer jump between the true distance and 16 m.
 */
export function nearestOutside(
  mask: ArrayLike<number>,
  w: number,
  h: number,
  m: number,
  x: number,
  z: number,
  limit: number,
): { d: number; dx: number; dz: number } | null {
  const ix0 = Math.floor(x / m);
  const iz0 = Math.floor(z / m);
  let best = Number.POSITIVE_INFINITY;
  let bx = x;
  let bz = z;
  const reach = Math.ceil(limit / m) + 1;
  for (let r = 0; r <= reach; r++) {
    // Every cell of ring r is at least r - 1 cells away.
    if (best <= (r - 1) * m) break;
    for (let dz = -r; dz <= r; dz++) {
      const fullRow = dz === -r || dz === r || r === 0;
      for (let dx = -r; dx <= r; dx += fullRow ? 1 : 2 * r) {
        const ix = ix0 + dx;
        const iz = iz0 + dz;
        if (ix >= 0 && iz >= 0 && ix < w && iz < h && mask[iz * w + ix]) continue;
        const cx = Math.max(ix * m, Math.min((ix + 1) * m, x));
        const cz = Math.max(iz * m, Math.min((iz + 1) * m, z));
        const d = Math.hypot(cx - x, cz - z);
        if (d < best) {
          best = d;
          bx = cx;
          bz = cz;
        }
      }
    }
  }
  return best === Number.POSITIVE_INFINITY || best > limit
    ? null
    : { d: best, dx: bx - x, dz: bz - z };
}

/**
 * Velocity along the exit normal, for the exit timer. Zero for the convoy's
 * auto-walk: following the wagon is never "walking out on purpose", so it must
 * not start a leave, even when it presses on a wall.
 */
export function edgeOutward(
  vx: number | undefined,
  vz: number | undefined,
  ox: number,
  oz: number,
  autoWalk: boolean,
): number {
  if (autoWalk) return 0;
  return (vx || 0) * ox + (vz || 0) * oz;
}

/**
 * The auto-walk's hold at the playable edge: inside `holdM` of it, the
 * outward part of the wanted velocity is dropped (the tangent part stays, so
 * the hero slides along it). `edge` is `TBArea.edgeInfo`: the distance to the
 * mask edge and the unit way out. Null means no edge to hold at.
 */
export function holdVelocityAtEdge(
  vx: number,
  vz: number,
  edge: { dist: number; ox: number; oz: number } | null,
  holdM: number,
): { vx: number; vz: number } {
  if (!edge || !Number.isFinite(edge.dist) || !(edge.dist < holdM)) return { vx, vz };
  const out = vx * edge.ox + vz * edge.oz;
  if (!(out > 0)) return { vx, vz };
  return { vx: vx - out * edge.ox, vz: vz - out * edge.oz };
}
