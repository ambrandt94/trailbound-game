/**
 * Hold charge for a heavy. The buffer still fires the heavy at the threshold
 * so combo timing does not move. Charge keeps climbing while the button stays
 * down, and the hit frame reads whatever level it has reached.
 *
 * 1 — tap, released before the threshold.
 * 2 — heavy, held past the threshold but under twice that.
 * 3 — heavy held at least twice the threshold. Bigger release, more hit-stop
 *     and knockback. Damage stays the move's own number.
 */

export type ChargeLevel = 1 | 2 | 3;

/** Where the strike pose sits in a 0..1 attack clip. */
export const CLIP_STRIKE = 0.42;

export function chargeLevel(
  heldMs: number,
  thresholdMs: number,
  kind: 'tap' | 'hold',
): ChargeLevel {
  if (kind !== 'hold') return 1;
  const threshold = Math.max(1, thresholdMs);
  if (heldMs >= threshold * 2) return 3;
  return 2;
}

/** Additive pose size. Charge 2 is the authored heavy. */
export function chargeWeight(level: ChargeLevel): number {
  if (level === 1) return 0.82;
  if (level === 3) return 1.28;
  return 1;
}

/** Hit-stop and knockback scale. Charge 2 keeps the move's written values. */
export function chargeImpact(level: ChargeLevel): number {
  return level === 3 ? 1.4 : 1;
}

export function moveStrikePhase(move: {
  startup: number;
  active: number;
  recovery: number;
  hits: number;
}): number {
  const duration = move.startup + move.active + move.recovery;
  if (!(duration > 0)) return CLIP_STRIKE;
  const hit = move.startup + (Math.max(move.active, 0.001) * 0.5) / Math.max(1, move.hits);
  return Math.min(0.92, Math.max(0.08, hit / duration));
}

/**
 * Map the fight's 0..1 phase onto the clip so the strike pose lands on the
 * hit frame. Higher charge holds the wind-up longer, then rushes into that
 * same strike time.
 */
export function attackClipTime(
  phase: number,
  strikePhase: number,
  charge: ChargeLevel = 1,
): number {
  const p = Math.min(1, Math.max(0, phase));
  const strike = Math.min(0.92, Math.max(0.08, strikePhase));
  const hold = (charge - 1) * 0.22;
  if (p <= strike) {
    const u = strike > 0 ? p / strike : 1;
    const eased = u ** (1 + hold * 2.2);
    return eased * CLIP_STRIKE;
  }
  const u = (p - strike) / (1 - strike);
  return CLIP_STRIKE + u * (1 - CLIP_STRIKE);
}
