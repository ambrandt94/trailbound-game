import { expect, test } from 'vitest';
import {
  AREA_VIEWS,
  CAM_DIST,
  CAM_FOV,
  CAM_PITCH,
  clampCamera,
  cycleZoom,
  isThirdPerson,
  matchView,
  toggleCameraMode,
  zoomDistance,
} from '../../src/core/state/area-camera';

test('the controller has four zoom steps in overhead and in third person', () => {
  expect(AREA_VIEWS).toHaveLength(8);
  expect(AREA_VIEWS.filter((view) => !view.tp)).toHaveLength(4);
  expect(AREA_VIEWS.filter((view) => view.tp)).toHaveLength(4);
  expect(AREA_VIEWS[0]?.n).toBe('Top-down vista');
  expect(AREA_VIEWS[0]?.camDist).toBe(60);
  expect(AREA_VIEWS[7]?.n).toBe('3rd-person near');
  expect(AREA_VIEWS[7]?.camDist).toBe(4);
});

test('V cycles the four steps of the current mode and C swaps mode', () => {
  let index = 0;
  const overhead: number[] = [];
  for (let i = 0; i < 4; i++) {
    overhead.push(index);
    index = cycleZoom(index);
  }
  expect(overhead).toEqual([0, 1, 2, 3]);
  expect(cycleZoom(3)).toBe(0);
  expect(isThirdPerson(0)).toBe(false);
  const third = toggleCameraMode(1);
  expect(third).toBe(5);
  expect(isThirdPerson(third)).toBe(true);
  expect(cycleZoom(third)).toBe(6);
  expect(toggleCameraMode(7)).toBe(3);
  expect(cycleZoom(-1)).toBe(2);
  expect(toggleCameraMode(-1)).toBe(6);
});

test('distance, pitch, and fov clamp to the original slider ranges', () => {
  expect(zoomDistance(60, 0)).toBe(60);
  expect(zoomDistance(70, 120)).toBe(77);
  expect(zoomDistance(78, 100)).toBe(CAM_DIST.max);
  expect(zoomDistance(3, -40)).toBeCloseTo(3 / 1.1);
  expect(zoomDistance(2.05, -10)).toBe(CAM_DIST.min);
  const pose = clampCamera({
    camDist: 400,
    camPitch: 120,
    camFov: 4,
    camYaw: -20,
    camLag: 4,
  });
  expect(pose.camDist).toBe(CAM_DIST.max);
  expect(pose.camPitch).toBe(CAM_PITCH.max);
  expect(pose.camFov).toBe(CAM_FOV.min);
  expect(pose.camYaw).toBe(340);
  expect(pose.camLag).toBe(0.6);
  expect(matchView(50, 60, 24)).toBe(0);
  expect(matchView(14, 4, 55)).toBe(7);
  expect(matchView(40, 12, 30)).toBe(-1);
});
