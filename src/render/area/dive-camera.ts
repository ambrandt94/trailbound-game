/**
 * The 3D end of the map dive. The area camera starts (and a rise ends) this
 * far out and this steep, so the map can be magnified to the same metres per
 * pixel before the two cross-fade.
 */
export const DIVE_CAM_DIST_M = 200;
export const DIVE_CAM_PITCH_DEG = 86;

/** Screen pixels per ground metre at the centre of a near-top-down view. */
export function areaPxPerMetre(viewH: number, dist: number, fovDeg: number): number {
  const fov = (Math.max(1, Math.min(170, fovDeg)) * Math.PI) / 180;
  return Math.max(1, viewH) / (2 * Math.max(1, dist) * Math.tan(fov / 2));
}

/** Wrap degrees to (−180, 180]. */
export function wrapDeg(deg: number): number {
  const d = (((deg % 360) + 540) % 360) - 180;
  return d === -180 ? 180 : d;
}
