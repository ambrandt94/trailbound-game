/**
 * The 2D map zooms only up to `MAP_ZOOM_CAP`. Entering a place is the Enter
 * key or the on-screen button, never another zoom notch.
 * Coming back from 3D eases the camera under the cap and ignores Enter for
 * a short cooldown so the key that left cannot walk straight back in.
 */
import { MAP_ZOOM_CAP } from './models';

/** Ignore Enter for this long after the map becomes active again. */
export const MAP_ENTRY_COOLDOWN_SEC = 0.5;
/** Target scale after leaving 3D while the camera was sitting on the cap. */
export const MAP_RETURN_ZOOM = MAP_ZOOM_CAP * 0.86;

export function stepEntryCooldown(remaining: number, dt: number): number {
  if (!(remaining > 0)) return 0;
  const step = Math.max(Number.isFinite(dt) ? dt : 0, 0);
  return Math.max(0, remaining - step);
}

/** Ease under the cap when the camera is parked on it. Otherwise leave it. */
export function zoomAfterArea(current: number): number {
  if (!Number.isFinite(current)) return MAP_RETURN_ZOOM;
  if (current >= MAP_ZOOM_CAP - 1e-3) return MAP_RETURN_ZOOM;
  return current;
}
