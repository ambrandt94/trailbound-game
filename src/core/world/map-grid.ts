/**
 * The playable map draws one Pixel Kingdom tile per cell of the 192-wide
 * sheet. A 16× continent stores 3072 fine tiles and displays 192.
 * Hero, POI, and settlement markers all use `fineToDisplay` so a pin and
 * the traveller share one conversion. The inverse is exact: standing on
 * the pin is the same fine point `describeMapStand` resolves.
 */
import { TILE, WORLD_BASE } from './models';

export const CLOSE_MARKER_SCALE = 1.2;

/** Map pin sizes in screen px (before the UI scale): a place, and a prominent pin (town, close zoom, near the hero). */
export const MAP_PIN_PX = 28;
export const MAP_PIN_PROMINENT_PX = 40;
/** Smallest a pin shrinks to when fully zoomed out, so towns and sites don't bury the map. */
export const MAP_PIN_MIN_PX = 10;
export const MAP_PIN_MIN_PROMINENT_PX = 13;
/** At or above this scale pins are full size; at or below `MAP_PIN_SHRINK_SCALE` they are at the minimum. */
export const MAP_PIN_FULL_SCALE = CLOSE_MARKER_SCALE;
export const MAP_PIN_SHRINK_SCALE = 0.12;

/**
 * On-screen pin size at a map scale. Full size from the close zoom in; shrinks
 * smoothly (log of the scale) as the map zooms out, down to the minimum.
 */
export function mapPinScreenPx(scale: number, prominent: boolean): number {
  const full = prominent ? MAP_PIN_PROMINENT_PX : MAP_PIN_PX;
  const min = prominent ? MAP_PIN_MIN_PROMINENT_PX : MAP_PIN_MIN_PX;
  if (!(scale > 0)) return min;
  const lo = Math.log(MAP_PIN_SHRINK_SCALE);
  const hi = Math.log(MAP_PIN_FULL_SCALE);
  const t = Math.min(1, Math.max(0, (Math.log(scale) - lo) / (hi - lo)));
  const eased = t * t * (3 - 2 * t);
  return min + (full - min) * eased;
}
/** Fine tiles. POIs inside this of the hero always keep a label. */
export const NEAR_POI_TILES = 48;

export function mapDisplayStep(width: number): number {
  if (width >= WORLD_BASE && width % WORLD_BASE === 0) return width / WORLD_BASE;
  return 1;
}

/** Fine world tiles → display tiles. Matches the map camera (`hero / step`). */
export function fineToDisplay(fine: number, step: number): number {
  const s = step > 0 ? step : 1;
  return fine / s;
}

/**
 * Centre of the fine tile that contains `fine`. Markers use this, not the
 * tile corner and not the centre of the coarse display cell, so a half-cell
 * shift cannot move the pin onto a neighbour.
 */
export function fineTileCenter(fine: number): number {
  if (!Number.isFinite(fine)) return 0.5;
  return Math.floor(fine) + 0.5;
}

/** Display position of the fine-tile centre under `fine`. */
export function markerDisplay(fine: number, step: number): number {
  return fineToDisplay(fineTileCenter(fine), step);
}

/**
 * Map yaw 0 faces north (−y). The wagon sits just behind the hero.
 * `scale` is screen pixels per world pixel, used to keep the gap visible.
 */
export function wagonTrailFine(
  x: number,
  y: number,
  yaw: number,
  step: number,
  scale: number,
): { x: number; y: number } {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const rawTiles = 22 / (safeScale * TILE);
  const displayTiles = Math.min(1.5, Math.max(0.55, rawTiles));
  const fine = displayTiles * (step > 0 ? step : 1);
  const facing = Number.isFinite(yaw) ? yaw : 0;
  return {
    x: x - Math.sin(facing) * fine,
    y: y + Math.cos(facing) * fine,
  };
}
