/**
 * Mixer rate for the dojo. The clip's own stride keeps the planted foot with
 * the ground. A plant multiplies the rate down toward zero.
 */
import type { LocoBlend } from '../../core/combat/posture';
import { clipTimeScale } from '../../core/state/area-pace';
import type { ForgeRaceMetrics } from '../characters/forge';

export function dojoPlaybackRate(
  speed: number,
  blend: LocoBlend,
  strideScale: number,
  metrics: ForgeRaceMetrics | null,
): number {
  const scaleMul = Number.isFinite(strideScale) ? Math.max(0, strideScale) : 1;
  const safe = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  if (!metrics || !(metrics.strideM > 0) || !(metrics.walkDuration > 0)) {
    const base = safe < 0.25 ? 1 : Math.min(1.65, Math.max(0.2, safe / 1.7));
    return base * scaleMul;
  }
  const bodyScale = metrics.scale && metrics.scale > 0 ? metrics.scale : 1;
  let rate = 1;
  if (
    blend.run >= blend.walk &&
    blend.run > 0.15 &&
    metrics.runDuration &&
    metrics.runStrideM &&
    metrics.runDuration > 0 &&
    metrics.runStrideM > 0
  ) {
    rate = clipTimeScale(safe, metrics.runDuration, metrics.runStrideM, bodyScale);
  } else if (blend.walk > 0.15) {
    rate = clipTimeScale(safe, metrics.walkDuration, metrics.strideM, bodyScale);
  }
  return rate * scaleMul;
}
