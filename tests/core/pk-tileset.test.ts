import { expect, test } from 'vitest';
import { Biome } from '../../src/core/world/models';
import {
  GROUPS,
  NB,
  NB_OFFSETS,
  SEASON,
  biomeSeason,
  blobQuadrants,
  featureGroup,
  pieceIndex,
  quadPiece,
  quadUniform,
} from '../../src/core/world/tileset';

const quads = (mask: number) => [0, 1, 2, 3].map((q) => quadPiece(blobQuadrants(mask), q));
const p = pieceIndex;
const ALL = 255;

test('quarter-tile blob: interior, edges and outer corners use the 3x3', () => {
  expect(quads(ALL)).toEqual([p(1, 1), p(1, 1), p(1, 1), p(1, 1)]);
  expect(quadUniform(blobQuadrants(ALL))).toBe(true);
  // Open to the north: top edge pieces on the north half, interior below.
  expect(quads(ALL & ~(NB.n | NB.ne | NB.nw))).toEqual([p(1, 0), p(1, 0), p(1, 1), p(1, 1)]);
  // Isolated cell: four outer corners.
  expect(quads(0)).toEqual([p(0, 0), p(2, 0), p(2, 2), p(0, 2)]);
  // Only south and east neighbours: NW outer corner of the 3x3.
  expect(quads(NB.s | NB.e | NB.se)).toEqual([p(0, 0), p(1, 0), p(1, 1), p(0, 1)]);
});

test('quarter-tile blob: a missing diagonal uses the inner-corner pieces', () => {
  expect(quads(ALL & ~NB.se)).toEqual([p(1, 1), p(1, 1), p(0, 4), p(1, 1)]);
  expect(quads(ALL & ~NB.sw)).toEqual([p(1, 1), p(1, 1), p(1, 1), p(1, 4)]);
  expect(quads(ALL & ~NB.ne)).toEqual([p(1, 1), p(0, 5), p(1, 1), p(1, 1)]);
  expect(quads(ALL & ~NB.nw)).toEqual([p(1, 5), p(1, 1), p(1, 1), p(1, 1)]);
});

test('quarter-tile blob: a diagonal alone never changes a corner without both sides', () => {
  expect(quads(NB.ne | NB.se | NB.sw | NB.nw)).toEqual(quads(0));
  expect(NB_OFFSETS).toHaveLength(8);
  expect(NB_OFFSETS[0]).toEqual([0, -1]);
});

test('every mask yields pieces inside the 4x6 group block', () => {
  for (let mask = 0; mask < 256; mask++) {
    for (const piece of quads(mask)) {
      expect(piece).toBeGreaterThanOrEqual(0);
      expect(piece).toBeLessThan(24);
    }
  }
});

test('biomes use the pack seasons, features stay on their groups', () => {
  expect(biomeSeason(Biome.Snow)).toBe(SEASON.winter);
  expect(biomeSeason(Biome.Taiga)).toBe(SEASON.winter);
  expect(biomeSeason(Biome.Desert)).toBe(SEASON.autumn);
  expect(biomeSeason(Biome.Ashlands)).toBe(SEASON.autumn);
  expect(biomeSeason(Biome.Marsh)).toBe(SEASON.lush);
  expect(biomeSeason(Biome.Jungle)).toBe(SEASON.lush);
  expect(biomeSeason(Biome.DarkForest)).toBe(SEASON.lush);
  expect(featureGroup(Biome.Forest)).toBe(GROUPS.forest);
  expect(featureGroup(Biome.Taiga)).toBe(GROUPS.forest);
  expect(featureGroup(Biome.Hills)).toBe(GROUPS.plateau);
  expect(featureGroup(Biome.Snow)).toBe(GROUPS.rock);
  expect(featureGroup(Biome.Mountain)).toBe(GROUPS.rock);
  expect(featureGroup(Biome.Water)).toBeNull();
  expect(featureGroup(Biome.Sand)).toBeNull();
  expect(featureGroup(Biome.Marsh)).toBeNull();
  expect(featureGroup(Biome.Plains)).toBeNull();
});
