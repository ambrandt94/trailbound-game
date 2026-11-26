/**
 * Lock-on for melee. The first lock, and a retarget after the current foe
 * dies, picks the nearest living enemy (shorter id breaks a tie).
 *
 * Cycling is clockwise around the player, seen from above, starting from the
 * player's facing. +X is east and +Z is south, so clockwise from facing south
 * goes toward the west. A tap never drops the lock while more than one foe
 * is alive. A hold always drops it, and it does not also count as a tap.
 */

export const LOCK_HOLD_MS = 250;

export interface LockPoint {
  x: number;
  z: number;
}

export interface LockBody extends LockPoint {
  yaw: number;
}

export interface LockFoe extends LockPoint {
  id: string;
}

export type LockGesture = 'tap' | 'hold';

interface Track {
  down: boolean;
  pressedAt: number;
  heldEmitted: boolean;
}

/** One button. Holding past the threshold emits `hold` once; an earlier release emits `tap`. */
export class LockGestureBuffer {
  private track: Track = { down: false, pressedAt: 0, heldEmitted: false };

  constructor(private holdMs = LOCK_HOLD_MS) {}

  setThreshold(holdMs: number): void {
    this.holdMs = holdMs;
  }

  update(nowMs: number, down: boolean): LockGesture | null {
    if (down && !this.track.down) {
      this.track = { down: true, pressedAt: nowMs, heldEmitted: false };
      return null;
    }
    if (down && this.track.down && !this.track.heldEmitted) {
      if (nowMs - this.track.pressedAt >= this.holdMs) {
        this.track.heldEmitted = true;
        return 'hold';
      }
      return null;
    }
    if (!down && this.track.down) {
      const tap = !this.track.heldEmitted;
      this.track = { down: false, pressedAt: 0, heldEmitted: false };
      return tap ? 'tap' : null;
    }
    return null;
  }
}

export function nearestFoe(body: LockPoint, foes: readonly LockFoe[]): LockFoe | null {
  let best: LockFoe | null = null;
  let bestDist = Infinity;
  for (const foe of foes) {
    const dist = Math.hypot(foe.x - body.x, foe.z - body.z);
    if (
      !best ||
      dist < bestDist - 1e-9 ||
      (Math.abs(dist - bestDist) <= 1e-9 && foe.id < best.id)
    ) {
      best = foe;
      bestDist = dist;
    }
  }
  return best;
}

/** Smallest clockwise sweep from the player's facing. Straight ahead sorts last so a cycle moves on. */
export function clockwiseSweep(body: LockBody, foe: LockFoe): number {
  const want = Math.atan2(foe.x - body.x, foe.z - body.z);
  let delta = body.yaw - want;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  if (delta <= 1e-6) delta += Math.PI * 2;
  return delta;
}

export function nextClockwise(body: LockBody, foes: readonly LockFoe[], currentId: string): string {
  const ordered = [...foes].sort((a, b) => {
    const sweep = clockwiseSweep(body, a) - clockwiseSweep(body, b);
    if (Math.abs(sweep) > 1e-9) return sweep;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const index = ordered.findIndex((foe) => foe.id === currentId);
  const next = ordered[(index + 1) % ordered.length];
  return next?.id ?? currentId;
}

/**
 * Tap. No lock yet: take the nearest foe. One living foe: drop the lock.
 * Several: the next clockwise foe, and the lock stays on.
 */
export function applyLockTap(
  targetId: string | null,
  body: LockBody,
  foes: readonly LockFoe[],
): string | null {
  const current = targetId !== null && foes.some((foe) => foe.id === targetId) ? targetId : null;
  if (!current) return nearestFoe(body, foes)?.id ?? null;
  if (foes.length <= 1) return null;
  return nextClockwise(body, foes, current);
}

/** The locked foe died or despawned. Take the nearest survivor, or drop the lock. */
export function retargetLock(
  targetId: string | null,
  body: LockPoint,
  foes: readonly LockFoe[],
): string | null {
  if (targetId === null) return null;
  if (foes.some((foe) => foe.id === targetId)) return targetId;
  return nearestFoe(body, foes)?.id ?? null;
}
