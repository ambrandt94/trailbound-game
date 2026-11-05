import { expect, test } from 'vitest';
import { DIRT_EDGE_BASE, SANDSTONE_ROAD, SAND_WET } from '../../src/render/map/biome-table';
import { pickCell } from '../../src/render/map/terrain-pick';

test('a grass cell picks a weighted plains variant and never the wet-sand id', () => {
  const pick = pickCell([2, 2, 2, 2], 4, 9, 7741, false, false);
  expect(pick.water).toBe('none');
  expect(pick.mask).toBeUndefined();
  expect(pick.atlasId).toBeGreaterThanOrEqual(0);
  expect(pick.atlasId).toBeLessThanOrEqual(6);
  expect(pick.atlasId).not.toBe(SAND_WET);
});

test('the same corners and seed pick the same variant', () => {
  const a = pickCell([4, 4, 4, 4], 12, 40, 7741, false, false);
  const b = pickCell([4, 4, 4, 4], 12, 40, 7741, false, false);
  expect(a.atlasId).toBe(b.atlasId);
});

test('open water is the deep plane over wet sand', () => {
  const pick = pickCell([0, 0, 0, 0], 3, 3, 7741, true, true);
  expect(pick.atlasId).toBe(SAND_WET);
  expect(pick.water).toBe('deep');
});

test('a coast cell uses the authored grass-over-sand edge', () => {
  const pick = pickCell([2, 2, 1, 1], 8, 8, 11, false, false);
  expect(pick.water).toBe('none');
  expect(pick.mask).toBeUndefined();
  expect(pick.atlasId).toBeGreaterThanOrEqual(60);
  expect(pick.atlasId).toBeLessThan(72);
});

test('an unauthored pair falls back to a generic mask', () => {
  const pick = pickCell([4, 4, 9, 9], 2, 2, 5, false, false);
  expect(pick.mask).toBeDefined();
  expect(pick.mask?.maskIndex).toBeGreaterThanOrEqual(0);
});

test('road atlas ids stay in the dirt and sandstone range', () => {
  expect(DIRT_EDGE_BASE).toBe(8);
  expect(SANDSTONE_ROAD).toBe(20);
});
