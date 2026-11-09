/**
 * The playable map draws one Pixel Kingdom tile per cell of the 192-wide
 * sheet. A 16× continent stores 3072 fine tiles and displays 192.
 * Hero, POI, and settlement markers all use `fineToDisplay` so a pin and
 * the traveller share one conversion. The inverse is exact: standing on
 * the pin is the same fine point `describeMapStand` resolves.
 */
import { TILE, WORLD_BASE } from './models';

export const CLOSE_MARKER_SCALE = 1.2;
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
