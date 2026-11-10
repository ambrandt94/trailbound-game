import { expect, test } from 'vitest';
import {
  OCCLUSION,
  aabbFromMatrix,
  advanceFades,
  expandAabb,
  isFadeRole,
  isProtectedNode,
  occludes,
  propOccluderRole,
  OccluderGrid,
  segmentHitsAabb,
  stepFade,
  visibilityFor,
  type Aabb,
  type OccCandidate,
} from '../../src/render/area/occlusion-select';

const box = (
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Aabb => ({
  minX,
  minY,
  minZ,
  maxX,
  maxY,
  maxZ,
});

test('a canopy on the camera-to-player segment is an occluder', () => {
  const canopy = box(4, 1, -1.2, 7, 6, 1.2);
  expect(occludes({ x: 0, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }, canopy, 'canopy')).toBe(true);
  expect(
    segmentHitsAabb({ x: 0, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }, expandAabb(canopy, 1.25)),
  ).toBe(true);
});

test('a prop just outside the capsule is left solid', () => {
  const beside = box(4, 0, 3, 6, 4, 5);
  expect(occludes({ x: 0, y: 1.5, z: 0 }, { x: 10, y: 1.5, z: 0 }, beside, 'canopy')).toBe(false);
});

test('a prop within the capsule radius of the segment fades even if the ray misses the mesh', () => {
  const beside = box(4, 0, 1, 6, 3, 2.2);
  expect(occludes({ x: 0, y: 1.5, z: 0 }, { x: 10, y: 1.5, z: 0 }, beside, 'bush')).toBe(true);
});

test('foliage around the camera fades even when it misses the player segment', () => {
  const lens = box(-1, 0.5, -2, 1.2, 3, -0.4);
  expect(occludes({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 1.6, z: 8 }, lens, 'canopy')).toBe(true);
});

test('the camera inside a canopy selects that canopy', () => {
  const canopy = box(-2, 0, -2, 2, 5, 2);
  expect(occludes({ x: 0, y: 2, z: 0 }, { x: 3, y: 1, z: 4 }, canopy, 'canopy')).toBe(true);
});

test('a building the player and camera are both inside is not faded', () => {
  const house = box(-4, 0, -4, 4, 6, 4);
  expect(occludes({ x: 0, y: 2, z: 0 }, { x: 1, y: 1, z: 1 }, house, 'building')).toBe(false);
});

test('a roof between the camera and a player outside the house still fades', () => {
  const house = box(2, 0, -3, 8, 6, 3);
  expect(occludes({ x: -2, y: 3, z: 0 }, { x: 12, y: 1, z: 0 }, house, 'building')).toBe(true);
});

test('the spatial grid matches a full scan, including negative coordinates', () => {
  const camera = { x: -2, y: 2, z: -30 };
  const player = { x: -2, y: 1.2, z: -8 };
  const items: OccCandidate[] = [];
  for (let i = 0; i < 40; i++) {
    const x = -20 + (i % 8) * 5;
    const z = -40 + Math.floor(i / 8) * 6;
    items.push({
      id: i,
      role: i % 5 === 0 ? 'trunk' : 'canopy',
      bounds: box(x, 0, z, x + 2.5, 4 + (i % 3), z + 2.5),
    });
  }
  const grid = new OccluderGrid();
  for (const item of items) grid.insert(item);
  const picked = new Set(grid.collect(camera, player));
  const brute = new Set(
    items.filter((item) => occludes(camera, player, item.bounds, item.role)).map((item) => item.id),
  );
  expect(picked).toEqual(brute);
  expect(picked.size).toBeGreaterThan(0);
  expect(picked.size).toBeLessThan(items.length);
});

test('fade eases across the full range in 0.2s and does not overshoot', () => {
  expect(stepFade(0, 1, 0.2, OCCLUSION.fadeSeconds)).toBe(1);
  expect(stepFade(0, 1, 0.1, OCCLUSION.fadeSeconds)).toBeCloseTo(0.5);
  expect(stepFade(0.25, 0, 0.05, OCCLUSION.fadeSeconds)).toBe(0);
  expect(stepFade(0.4, 1, 0, OCCLUSION.fadeSeconds)).toBe(0.4);
  const fades = new Float32Array([0, 1]);
  expect(advanceFades(fades, [0], 0.1)).toBe(true);
  expect(fades[0]).toBeCloseTo(0.5);
  expect(fades[1]).toBeCloseTo(0.5);
  advanceFades(fades, [], 1);
  expect(fades[0]).toBe(0);
  expect(fades[1]).toBe(0);
});

test('trunks stay more opaque than canopies, and opaque fade is fully solid', () => {
  expect(visibilityFor('canopy', 0)).toBe(1);
  expect(visibilityFor('bush', 1)).toBeCloseTo(OCCLUSION.visible.bush);
  expect(visibilityFor('canopy', 1)).toBeGreaterThanOrEqual(0.25);
  expect(visibilityFor('canopy', 1)).toBeLessThanOrEqual(0.35);
  expect(visibilityFor('trunk', 1)).toBeGreaterThan(visibilityFor('canopy', 1));
  expect(visibilityFor('building', 1)).toBeCloseTo(OCCLUSION.visible.building);
});

test('nature props are tagged by part, and actors are never fade targets', () => {
  expect(propOccluderRole('tree', 'tree_pine_m', 0, 6, 6, 10)).toBe('trunk');
  expect(propOccluderRole('tree', 'tree_pine_m', 2, 6, 6, 10)).toBe('canopy');
  expect(propOccluderRole('tree', 'tree_oak_l', 1, 8, 8, 12)).toBe('canopy');
  expect(propOccluderRole('plant', 'bush_round_l', 0, 1.75, 1.75, 1.25)).toBe('bush');
  expect(propOccluderRole('plant', 'flower_red', 0, 0.4, 0.4, 0.4)).toBeNull();
  expect(propOccluderRole('rock', 'rock_boulder_cool_l', 0, 4.5, 4.5, 3)).toBe('rock');
  expect(propOccluderRole('rock', 'rock_boulder_cool_s', 0, 0.75, 0.75, 0.5)).toBeNull();
  expect(propOccluderRole('fence', 'prop_fence_split_rail_3m', 0, 3, 0.2, 1)).toBeNull();
  expect(propOccluderRole('prop', 'party-wagon', 0, 2, 4, 2)).toBeNull();
  expect(isFadeRole('canopy')).toBe(true);
  expect(isFadeRole('player')).toBe(false);
  expect(isProtectedNode('party-wagon', {})).toBe(true);
  expect(isProtectedNode('CF_avatar', { person: true })).toBe(true);
  expect(isProtectedNode('npc-miller', {})).toBe(true);
  expect(isProtectedNode('oak-broadleaf-foliage', {})).toBe(false);
  expect(isProtectedNode('wagonwright', {})).toBe(false);
});

test('instance matrices turn a local trunk box into a world box', () => {
  const local = box(-0.2, 0, -0.5, 0.4, 2, 1.5);
  const identity = aabbFromMatrix(local, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  expect(identity).toEqual(local);
  const moved = aabbFromMatrix(local, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 1, -3, 1]);
  expect(moved.minX).toBeCloseTo(4.8);
  expect(moved.maxX).toBeCloseTo(5.4);
  expect(moved.minY).toBeCloseTo(1);
  expect(moved.minZ).toBeCloseTo(-3.5);
  expect(moved.maxZ).toBeCloseTo(-1.5);
  // +90° yaw: x' = z, z' = -x
  const yaw90 = aabbFromMatrix(local, [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]);
  expect(yaw90.minX).toBeCloseTo(-0.5);
  expect(yaw90.maxX).toBeCloseTo(1.5);
  expect(yaw90.minZ).toBeCloseTo(-0.4);
  expect(yaw90.maxZ).toBeCloseTo(0.2);
  expect(yaw90.minY).toBeCloseTo(0);
  expect(yaw90.maxY).toBeCloseTo(2);
});
