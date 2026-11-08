import { expect, test } from 'vitest';
import { Biome, WORLD_BASE } from '../../src/core/world/models';
import { buildCoarseMap, mapCellStep } from '../../src/render/map/coarse-map';

test('a 16× continent becomes the original 192 map tiles', () => {
  expect(mapCellStep(WORLD_BASE)).toBe(1);
  expect(mapCellStep(WORLD_BASE * 16)).toBe(16);
  expect(mapCellStep(800)).toBe(1);
});

test('a cell keeps the majority land and a river or road that crosses it', () => {
  const step = 4;
  const width = 8;
  const height = 4;
  const biomes = new Uint8Array(width * height).fill(Biome.Plains);
  const paths = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) biomes[0 + y * width] = Biome.Marsh;
  for (let x = 0; x < 4; x++) paths[x + 1 * width] = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 4; x < 8; x++) biomes[x + y * width] = Biome.Water;
  }
  const map = buildCoarseMap({ width, height, biomes, paths, seed: 1 }, step);
  expect(map.width).toBe(2);
  expect(map.height).toBe(1);
  expect(map.biomes[0]).toBe(Biome.Marsh);
  expect(map.paths[0]).toBe(1);
  expect(map.biomes[1]).toBe(Biome.Water);
});
