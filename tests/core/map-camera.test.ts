import { expect, test } from 'vitest';
import { MapCamera, pixelSnapScale } from '../../src/render/map/map-camera';

test('a free zoom eases and keeps the cursor point fixed', () => {
  const camera = new MapCamera();
  camera.frame(800, 600, 400, 300);
  camera.follow = false;
  camera.x = 400;
  camera.y = 300;
  camera.targetX = 400;
  camera.targetY = 300;
  camera.scale = 1;
  camera.targetScale = 1;
  const before = camera.screenToWorld(220, 180, 800, 600);
  camera.zoomAt(220, 180, 1.35, 800, 600);
  expect(camera.scale).toBeGreaterThan(1);
  expect(camera.scale).toBeLessThan(camera.targetScale);
  const mid = camera.screenToWorld(220, 180, 800, 600);
  expect(mid.x).toBeCloseTo(before.x, 4);
  expect(mid.y).toBeCloseTo(before.y, 4);
  camera.update(0.08, 400, 300);
  const after = camera.screenToWorld(220, 180, 800, 600);
  expect(after.x).toBeCloseTo(before.x, 4);
  expect(after.y).toBeCloseTo(before.y, 4);
  expect(camera.scale).toBeGreaterThan(1.05);
});

test('a 16× continent is framed like the original 192-tile map', () => {
  const camera = new MapCamera();
  camera.frame(3072, 3072, 1600, 800);
  expect(camera.step).toBe(16);
  expect(camera.scale).toBeCloseTo(0.26, 5);
  expect(camera.state().x).toBeCloseTo(100, 5);
  expect(camera.state().y).toBeCloseTo(50, 5);
});

test('close zoom snaps a world pixel onto a whole screen pixel', () => {
  expect(pixelSnapScale(0.016)).toBeCloseTo(0.016, 5);
  expect(pixelSnapScale(3.6) * 16).toBe(58);
});
