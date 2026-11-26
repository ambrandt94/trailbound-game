import { expect, test } from 'vitest';
import { bootRoute } from '../../src/app/boot-route';
import { mapDojoInput } from '../../src/input/dojo-input';
import { cameraWish, followCamera } from '../../src/core/combat/space';

test('?mode=dojo opens the dojo and does not enter a town', () => {
  expect(bootRoute('')).toBe('title');
  expect(bootRoute('?town=waystead')).toBe('town');
  expect(bootRoute('?mode=dojo')).toBe('dojo');
  expect(bootRoute('?town=waystead&mode=dojo')).toBe('dojo');
  expect(bootRoute('?mode=dojo&cf=1')).toBe('dojo');
});

test('dojo inputs map X, Y, and counter without mixing them', () => {
  const base = {
    a: false,
    d: false,
    w: false,
    s: false,
    j: false,
    k: false,
    mouseX: false,
    mouseY: false,
    counterEdge: false,
    stickX: 0,
    stickZ: 0,
    padX: false,
    padY: false,
    lockHeld: false,
  };
  expect(mapDojoInput({ ...base, lockHeld: true })).toMatchObject({
    xDown: false,
    yDown: false,
    lockDown: true,
  });
  expect(mapDojoInput({ ...base, j: true }).xDown).toBe(true);
  expect(mapDojoInput({ ...base, mouseX: true }).xDown).toBe(true);
  expect(mapDojoInput({ ...base, padX: true }).xDown).toBe(true);
  expect(mapDojoInput({ ...base, k: true }).yDown).toBe(true);
  expect(mapDojoInput({ ...base, mouseY: true }).yDown).toBe(true);
  expect(mapDojoInput({ ...base, counterEdge: true })).toMatchObject({
    xDown: false,
    yDown: false,
    counterPressed: true,
  });
  const diagonal = mapDojoInput({ ...base, w: true, d: true });
  expect(diagonal.ix).toBeCloseTo(Math.SQRT1_2, 5);
  expect(diagonal.iz).toBeCloseTo(Math.SQRT1_2, 5);
  expect(mapDojoInput({ ...base, w: true })).toMatchObject({ ix: 0, iz: 1 });
});

test('the dojo camera matches the town stick and follow placement', () => {
  expect(cameraWish(0, 1, 0)).toEqual({ x: 0, z: -1 });
  expect(cameraWish(1, 0, 0).x).toBeCloseTo(1, 5);
  expect(cameraWish(1, 0, 0).z).toBeCloseTo(0, 5);
  const placed = followCamera({ x: 0, y: 0, z: 0 }, 0, 28, 9, 1.35);
  expect(placed.x).toBeCloseTo(0, 5);
  expect(placed.z).toBeCloseTo(Math.cos((28 * Math.PI) / 180) * 9, 5);
  expect(placed.y).toBeCloseTo(1.35 + Math.sin((28 * Math.PI) / 180) * 9, 5);
  expect(placed.lookY).toBeCloseTo(1.35, 5);
  expect(placed.y).toBeGreaterThan(0.4);
});
