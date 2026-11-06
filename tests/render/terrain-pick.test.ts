import { expect, test } from 'vitest';
import { DIRT_EDGE_BASE, SANDSTONE_ROAD, SAND_WET } from '../../src/render/map/biome-table';
import {
  authoredPair,
  cellCorners,
  foamRuns,
  pickCell,
  waterBand,
} from '../../src/render/map/terrain-pick';

test('a grass cell picks a weighted plains variant and never the wet-sand id', () => {
  const pick = pickCell([2, 2, 2, 2], 4, 9, 7741, 'none');
  expect(pick.water).toBe('none');
  expect(pick.mask).toBeUndefined();
  expect(pick.atlasId).toBeGreaterThanOrEqual(0);
  expect(pick.atlasId).toBeLessThanOrEqual(6);
  expect(pick.atlasId).not.toBe(SAND_WET);
});

test('the same corners and seed pick the same variant', () => {
  const a = pickCell([4, 4, 4, 4], 12, 40, 7741);
  const b = pickCell([4, 4, 4, 4], 12, 40, 7741);
  expect(a.atlasId).toBe(b.atlasId);
});

test('open water is the deep plane over wet sand', () => {
  const pick = pickCell([0, 0, 0, 0], 3, 3, 7741, 'deep');
  expect(pick.atlasId).toBe(SAND_WET);
  expect(pick.water).toBe('deep');
});

test('a coast cell uses the authored grass-over-sand edge', () => {
  const pick = pickCell([2, 2, 1, 1], 8, 8, 11, 'none');
  expect(pick.water).toBe('none');
  expect(pick.mask).toBeUndefined();
  expect(pick.atlasId).toBeGreaterThanOrEqual(60);
  expect(pick.atlasId).toBeLessThan(72);
});

test('an unauthored pair falls back to a generic mask', () => {
  const pick = pickCell([10, 10, 1, 1], 2, 2, 5, 'none');
  expect(authoredPair(10, 1)).toBe(false);
  expect(pick.mask).toBeDefined();
  expect(pick.mask?.maskIndex).toBeGreaterThanOrEqual(0);
});

test('a straight coast shares corners and lays foam across the tile', () => {
  const grid = [
    [0, 0, 0],
    [1, 1, 1],
    [1, 1, 1],
  ];
  const at = (x: number, y: number) => grid[y]?.[x] ?? 0;
  const waterCorners = cellCorners(at, 1, 0);
  const sandCorners = cellCorners(at, 1, 1);
  const waterPick = pickCell(waterCorners, 1, 0, 1, 'shallow');
  const sandPick = pickCell(sandCorners, 1, 1, 1, 'none');
  expect(waterPick.landBits === 0 || waterPick.landBits === 15).toBe(false);
  expect(foamRuns(waterPick.landBits).length).toBeGreaterThan(0);
  expect(sandPick.water).toBe('none');
});

test('an outer corner turns the foam instead of drawing a full side', () => {
  const runs = foamRuns(7);
  expect(runs.length).toBe(2);
  expect(runs.every((run) => run.len === 0.5)).toBe(true);
});

test('water one tile off the beach is shallow and open water is deep', () => {
  const at = (x: number, y: number) => (y >= 2 ? 1 : 0);
  expect(waterBand(at, 4, 1)).toBe('shallow');
  expect(waterBand(at, 4, 0)).toBe('shallow');
  expect(waterBand(at, 4, -2)).toBe('deep');
});

test('road atlas ids stay in the dirt and sandstone range', () => {
  expect(DIRT_EDGE_BASE).toBe(8);
  expect(SANDSTONE_ROAD).toBe(20);
});
