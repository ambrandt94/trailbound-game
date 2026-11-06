/** Camera presets from trailbound-controller `VIEWS` (four zoom steps in each mode). */

export interface AreaViewPreset {
  n: string;
  camPitch: number;
  camDist: number;
  camFov: number;
  camLag: number;
  tp?: 1;
}

export const ZOOM_PER_MODE = 4;

export const CAM_DIST = { min: 2, max: 80 };
export const CAM_PITCH = { min: -5, max: 85 };
export const CAM_FOV = { min: 15, max: 75 };
export const CAM_LAG = { min: 0, max: 0.6 };

export const AREA_VIEWS: readonly AreaViewPreset[] = [
  { n: 'Top-down vista', camPitch: 50, camDist: 60, camFov: 24, camLag: 0.25 },
  { n: 'Top-down far', camPitch: 56, camDist: 24, camFov: 24, camLag: 0.2 },
  { n: 'Top-down mid', camPitch: 42, camDist: 30, camFov: 52, camLag: 0.12 },
  { n: 'Top-down near', camPitch: 42, camDist: 9, camFov: 36, camLag: 0.1 },
  { n: '3rd-person vista', tp: 1, camPitch: 20, camDist: 26, camFov: 42, camLag: 0.2 },
  { n: '3rd-person far', tp: 1, camPitch: 28, camDist: 9, camFov: 45, camLag: 0.16 },
  { n: '3rd-person mid', tp: 1, camPitch: 20, camDist: 6.5, camFov: 50, camLag: 0.13 },
  { n: '3rd-person near', tp: 1, camPitch: 14, camDist: 4, camFov: 55, camLag: 0.1 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isThirdPerson(viewIndex: number): boolean {
  if (viewIndex < 0) return false;
  return !!AREA_VIEWS[viewIndex]?.tp;
}

/** V: next zoom step inside the current mode. A custom camera snaps to mid first. */
export function cycleZoom(viewIndex: number): number {
  const base = isThirdPerson(viewIndex) ? ZOOM_PER_MODE : 0;
  if (viewIndex < 0) return 2;
  return base + ((viewIndex - base + 1) % ZOOM_PER_MODE);
}

/** C: overhead and third person keep the same zoom step. */
export function toggleCameraMode(viewIndex: number): number {
  const level = viewIndex < 0 ? 2 : viewIndex % ZOOM_PER_MODE;
  return isThirdPerson(viewIndex) ? level : ZOOM_PER_MODE + level;
}

export function viewPreset(viewIndex: number): AreaViewPreset | null {
  if (viewIndex < 0) return null;
  return AREA_VIEWS[viewIndex] ?? null;
}

export function viewName(viewIndex: number): string {
  return viewPreset(viewIndex)?.n ?? 'custom';
}

/** -1 when the live distance, pitch, and FOV are not one of the eight presets. */
export function matchView(pitch: number, dist: number, fov: number): number {
  return AREA_VIEWS.findIndex(
    (view) =>
      Math.abs(view.camPitch - pitch) < 0.05 &&
      Math.abs(view.camDist - dist) < 0.05 &&
      Math.abs(view.camFov - fov) < 0.05,
  );
}

export interface CameraPose {
  camDist: number;
  camPitch: number;
  camFov: number;
  camYaw: number;
  camLag: number;
}

export function clampCamera(pose: CameraPose): CameraPose {
  const yaw = ((pose.camYaw % 360) + 360) % 360;
  return {
    camDist: clamp(pose.camDist, CAM_DIST.min, CAM_DIST.max),
    camPitch: clamp(pose.camPitch, CAM_PITCH.min, CAM_PITCH.max),
    camFov: clamp(pose.camFov, CAM_FOV.min, CAM_FOV.max),
    camYaw: yaw,
    camLag: clamp(pose.camLag, CAM_LAG.min, CAM_LAG.max),
  };
}

/** Wheel zoom across the original distance slider (2–80), not the four preset steps. */
export function zoomDistance(dist: number, wheelY: number): number {
  if (!wheelY) return clamp(dist, CAM_DIST.min, CAM_DIST.max);
  const dir = Math.sign(wheelY);
  const next = dist * (dir > 0 ? 1.1 : 1 / 1.1);
  return clamp(next, CAM_DIST.min, CAM_DIST.max);
}
