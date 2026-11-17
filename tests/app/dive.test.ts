import { expect, test } from 'vitest';
import { divePose } from '../../src/app/scenes/dive';
import { areaPxPerMetre, wrapDeg } from '../../src/render/area/dive-camera';

test('the dive zooms in log space and hands the last stretch to CSS', () => {
  const from = { x: 0, y: 0, scale: 0.4 };
  const to = { x: 100, y: 50, scale: 3.6 };
  const start = divePose(from, to, 0, 20);
  expect(start).toEqual({ x: 0, y: 0, scale: 0.4, magnify: 1 });
  const end = divePose(from, to, 1, 20);
  expect(end.x).toBeCloseTo(100, 9);
  expect(end.scale).toBeCloseTo(3.6, 9);
  expect(end.magnify).toBeCloseTo(20, 9);
  const mid = divePose(from, to, 0.5, 20);
  expect(mid.scale * mid.magnify).toBeCloseTo(Math.sqrt(0.4 * 3.6 * 20), 6);
  expect(mid.x).toBeCloseTo(50, 6);
  let last = 0;
  for (let u = 0; u <= 1.0001; u += 0.05) {
    const pose = divePose(from, to, u, 20);
    const apparent = pose.scale * pose.magnify;
    expect(apparent).toBeGreaterThanOrEqual(last - 1e-9);
    expect(pose.scale).toBeLessThanOrEqual(3.6 + 1e-9);
    // CSS only magnifies once the map is at its closest scale.
    if (pose.magnify > 1 + 1e-9) expect(pose.scale).toBeCloseTo(3.6, 9);
    last = apparent;
  }
  expect(divePose(from, to, 3, 20).x).toBeCloseTo(100, 9);
});

test('the 3D end of the dive measures metres per pixel', () => {
  // 900 px tall, 200 m out, 24° fov: about 10.6 px per metre.
  expect(areaPxPerMetre(900, 200, 24)).toBeCloseTo(900 / (400 * Math.tan((12 * Math.PI) / 180)), 6);
  expect(areaPxPerMetre(900, 100, 24)).toBeCloseTo(2 * areaPxPerMetre(900, 200, 24), 6);
  expect(wrapDeg(45)).toBe(45);
  expect(wrapDeg(315)).toBe(-45);
  expect(wrapDeg(-190)).toBe(170);
  expect(wrapDeg(180)).toBe(180);
});
