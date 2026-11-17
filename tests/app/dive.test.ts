import { expect, test } from 'vitest';
import { DIVE_MAP_MAGNIFY, divePose } from '../../src/app/scenes/dive';

test('the dive moves in log scale from the view onto the target', () => {
  const from = { x: 0, y: 0, scale: 0.4 };
  const to = { x: 100, y: 50, scale: 3.6 };
  const start = divePose(from, to, 0);
  expect(start).toEqual({ x: 0, y: 0, scale: 0.4, magnify: 1 });
  const end = divePose(from, to, 1);
  expect(end.x).toBeCloseTo(100, 9);
  expect(end.scale).toBeCloseTo(3.6, 9);
  expect(end.magnify).toBeCloseTo(DIVE_MAP_MAGNIFY, 9);
  const mid = divePose(from, to, 0.5);
  expect(mid.scale).toBeCloseTo(Math.sqrt(0.4 * 3.6), 6);
  expect(mid.x).toBeCloseTo(50, 6);
  let last = 0;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    const pose = divePose(from, to, u);
    expect(pose.scale).toBeGreaterThanOrEqual(last - 1e-9);
    last = pose.scale;
  }
  // Already closer than the target: hold the scale, never zoom out.
  expect(divePose({ ...from, scale: 5 }, to, 0.7).scale).toBeCloseTo(5, 9);
  expect(divePose(from, to, 3).x).toBeCloseTo(100, 9);
});
