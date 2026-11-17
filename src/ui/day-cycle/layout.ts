import type { NodeLayout } from '../../core/sim/day-cycle';

/** Native (1x) HUD geometry. Everything is drawn at this size, then scaled by whole pixels. */
export const NODE_LAYOUT: NodeLayout = {
  count: 100,
  padX: 22,
  stepX: 3.2,
  centerY: 50,
  amplitude: 11,
  cycles: 2.5,
};

export const HUD_NATIVE_W = Math.round(
  NODE_LAYOUT.padX * 2 + (NODE_LAYOUT.count - 1) * NODE_LAYOUT.stepX,
);
export const HUD_NATIVE_H = 66;

/** Sky strip outer rectangle, in native pixels. */
export const SKY_RECT = {
  x: NODE_LAYOUT.padX - 6,
  y: 2,
  w: HUD_NATIVE_W - (NODE_LAYOUT.padX - 6) * 2,
  h: 22,
};

/** A bit under a third of a typical wide screen per whole-pixel step. */
const CSS_PX_PER_SCALE_STEP = 680;
const MAX_HEIGHT_FRACTION = 0.2;
const MAX_SCALE = 4;

/**
 * Whole-pixel scale for the HUD canvas, in *device* pixels, so every art
 * pixel is the same size on screen. The size aims at about 1 step per 680 CSS
 * px of width, never more than 20% of the height, never above 4 CSS steps.
 */
export function chooseHudScale(viewW: number, viewH: number, dpr = 1): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const byWidth = viewW / CSS_PX_PER_SCALE_STEP;
  const byHeight = (viewH * MAX_HEIGHT_FRACTION) / HUD_NATIVE_H;
  const target = Math.min(byWidth, byHeight, MAX_SCALE);
  return Math.max(1, Math.floor(target * ratio + 1e-6));
}
