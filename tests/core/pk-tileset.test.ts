import { expect, test } from 'vitest';
import { Biome } from '../../src/core/world/models';
import { GROUPS, SEASON, biomeSeason, blobLocal, overlayGroup } from '../../src/core/world/tileset';

test('blob autotile matches the original Pixel Kingdom 3x3', () => {
  expect(blobLocal(true, true, true, true)).toEqual([1, 1]);
  expect(blobLocal(false, true, true, true)).toEqual([1, 0]);
  expect(blobLocal(true, true, false, true)).toEqual([1, 2]);
  expect(blobLocal(true, false, true, true)).toEqual([2, 1]);
  expect(blobLocal(true, true, true, false)).toEqual([0, 1]);
  expect(blobLocal(false, false, false, false)).toEqual([3, 2]);
  expect(blobLocal(false, true, false, false)).toEqual([0, 1]);
});

test('biomes use the pack seasons and groups, not a generated fill', () => {
  expect(biomeSeason(Biome.Snow)).toBe(SEASON.winter);
  expect(biomeSeason(Biome.Taiga)).toBe(SEASON.winter);
  expect(biomeSeason(Biome.Desert)).toBe(SEASON.autumn);
  expect(biomeSeason(Biome.Ashlands)).toBe(SEASON.autumn);
  expect(biomeSeason(Biome.Marsh)).toBe(SEASON.lush);
  expect(biomeSeason(Biome.Jungle)).toBe(SEASON.lush);
  expect(biomeSeason(Biome.DarkForest)).toBe(SEASON.lush);
  expect(overlayGroup(Biome.Water)).toBe(GROUPS.water);
  expect(overlayGroup(Biome.Sand)).toBe(GROUPS.path);
  expect(overlayGroup(Biome.Desert)).toBe(GROUPS.path);
  expect(overlayGroup(Biome.Forest)).toBe(GROUPS.forest);
  expect(overlayGroup(Biome.Taiga)).toBe(GROUPS.forest);
  expect(overlayGroup(Biome.Snow)).toBe(GROUPS.rock);
  expect(overlayGroup(Biome.Mountain)).toBe(GROUPS.rock);
  expect(overlayGroup(Biome.Marsh)).toBeNull();
  expect(overlayGroup(Biome.Plains)).toBeNull();
});
