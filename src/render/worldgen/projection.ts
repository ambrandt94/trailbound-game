/**
 * World Gen's one projection, globe and flat map alike. The mesh shader in
 * `view.ts` does the same maths per vertex; these helpers invert it for
 * picking and place labels.
 *
 * A point at latitude `lat`, longitude `lon` with `dl = wrap(lon − lon0)`:
 * - globe:  yaw by −lon0, tilt by lat0, scale by the radius (x right, y up, z to the eye);
 * - flat:   (dl · R, (lat − lat0) · R) — equirect, centred on (lon0, lat0).
 * At the view centre both have the same position and scale, so WG4's morph
 * keeps the middle still while the rest unrolls.
 */

export interface ViewState {
  /** Longitude / latitude at the view centre, radians. */
  lon0: number;
  lat0: number;
  /** Globe radius in CSS px (flat: px per radian). */
  radiusPx: number;
  /** 0 = globe, 1 = flat map. */
  morph: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

const TAU = Math.PI * 2;

/** Angle into −π..π. */
export function wrapAngle(a: number): number {
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/** Screen offset from the view centre (px, y down) of a lat/lon, or null on the globe's far side. */
export function project(view: ViewState, p: LatLon): { x: number; y: number } | null {
  const dl = wrapAngle(p.lon - view.lon0);
  const R = view.radiusPx;
  const cl = Math.cos(p.lat);
  const qx = cl * Math.sin(dl);
  const qy = Math.sin(p.lat);
  const qz = cl * Math.cos(dl);
  const c = Math.cos(view.lat0);
  const s = Math.sin(view.lat0);
  const gx = qx;
  const gy = qy * c - qz * s;
  const gz = qy * s + qz * c;
  const fx = dl;
  const fy = p.lat - view.lat0;
  const m = view.morph;
  if (m < 0.5 && gz < 0) return null;
  return { x: (gx + (fx - gx) * m) * R, y: -(gy + (fy - gy) * m) * R };
}

/** The lat/lon under a screen offset from the view centre (px, y down); null off the planet. */
export function unproject(view: ViewState, x: number, y: number): LatLon | null {
  const R = view.radiusPx;
  if (R <= 0) return null;
  if (view.morph >= 0.5) {
    const dl = x / R;
    const lat = view.lat0 - y / R;
    if (Math.abs(dl) > Math.PI || Math.abs(lat) > Math.PI / 2) return null;
    return { lat, lon: wrapAngle(view.lon0 + dl) };
  }
  const gx = x / R;
  const gy = -y / R;
  const r2 = gx * gx + gy * gy;
  if (r2 > 1) return null;
  const gz = Math.sqrt(1 - r2);
  const c = Math.cos(view.lat0);
  const s = Math.sin(view.lat0);
  const qy = gy * c + gz * s;
  const qz = -gy * s + gz * c;
  const lat = Math.asin(Math.max(-1, Math.min(1, qy)));
  const dl = Math.atan2(gx, qz);
  return { lat, lon: wrapAngle(view.lon0 + dl) };
}

/** Radius that fits the whole globe in a view, with a margin. */
export function globeFitRadius(viewW: number, viewH: number): number {
  return Math.max(40, Math.min(viewW, viewH) * 0.42);
}

/** Px per radian that fits the whole flat map's width (and its height) in a view. */
export function flatFitRadius(viewW: number, viewH: number): number {
  return Math.max(20, Math.min((viewW * 0.96) / TAU, (viewH * 0.96) / Math.PI));
}
