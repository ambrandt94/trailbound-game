/**
 * Framing for the static globe, shared by the map scene and tests.
 * At the flat map's furthest zoom the home chunk on the globe is drawn the same
 * size as the whole flat map, so the hand-over does not jump; further out, the
 * planet settles to the existing `GLOBE_FILL_*` framing.
 */
import { TILE, globeFillFor } from '../world/models';
import { latLonToSphere, sphereToLatLon, type Vec3 } from './cube-sphere';

/** Planet diameter in CSS px at a map camera scale. */
export function globeDiameterPx(
  scale: number,
  cellsWide: number,
  n: number,
  viewW: number,
  viewH: number,
): number {
  const chunkPx = cellsWide * TILE * scale;
  // A chunk at the face centre spans (π/2)/n radians of the sphere: D = chunk · 4n / π.
  const match = (chunkPx * 4 * n) / Math.PI;
  const fill = globeFillFor(scale, cellsWide) * Math.min(viewW, viewH);
  return Math.max(match, fill);
}

/** Drag on the globe: how much of the player's turn still applies at this scale. */
export function globeTurnWeight(scale: number, switchScale: number): number {
  const t = Math.max(0, Math.min(1, (scale / switchScale - 0.5) / 0.45));
  return 1 - t * t * (3 - 2 * t);
}

/** Where the camera looks: the home point turned by the player's drag (radians). */
export function globeLook(home: Vec3, turnLat: number, turnLon: number, weight: number): Vec3 {
  const ll = sphereToLatLon(home);
  const lat = Math.max(-1.45, Math.min(1.45, ll.lat + turnLat * weight));
  return latLonToSphere(lat, ll.lon + turnLon * weight);
}
