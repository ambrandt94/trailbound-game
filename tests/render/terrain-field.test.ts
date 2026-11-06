import { expect, test } from 'vitest';
import { Biome } from '../../src/core/world/models';
import {
  FIELD_REACH,
  SUBCELLS,
  sampleField,
  tileVariant,
} from '../../src/render/map/terrain-field';

const atWall = (x: number, _y: number) => (x >= 8 ? Biome.Sand : Biome.Snow);

function coastX(y: number, seed = 7741): number {
  let lo = 6;
  let hi = 10;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (sampleField(mid, y, seed, atWall).biome === Biome.Snow) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

test('the presentation field is deterministic and stays inside a uniform area', () => {
  const at = () => Biome.Forest;
  const a = sampleField(100.2, -3.4, 7741, at);
  const b = sampleField(100.2, -3.4, 7741, at);
  expect(a.biome).toBe(Biome.Forest);
  expect(a.base).toBe(Biome.Forest);
  expect(b.biome).toBe(a.biome);
  expect(SUBCELLS).toBeGreaterThanOrEqual(4);
  expect(SUBCELLS).toBeLessThanOrEqual(8);
  expect(48 % SUBCELLS).toBe(0);
  expect(FIELD_REACH).toBe(2);
});

test('a vertical snow and sand wall curves instead of holding a straight step', () => {
  const xs: number[] = [];
  for (let y = 0; y < 18; y += 0.5) xs.push(coastX(y));
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  expect(max - min).toBeGreaterThan(0.35);
  expect(sampleField(0.4, 5.5, 7741, atWall).biome).toBe(Biome.Snow);
  expect(sampleField(30.2, 5.5, 7741, atWall).biome).toBe(Biome.Sand);
});

test('snow only dusts the sand side of a wall', () => {
  let fringe = 0;
  let far = 0;
  let total = 0;
  for (let y = 0; y < 24; y += 0.25) {
    total += 1;
    if (sampleField(8.15, y, 7741, atWall).biome === Biome.Snow) fringe += 1;
    if (sampleField(9.3, y, 7741, atWall).biome === Biome.Snow) far += 1;
  }
  expect(fringe).toBeGreaterThan(0);
  expect(fringe).toBeLessThan(total * 0.9);
  expect(far).toBe(0);
});

test('snow, sand, and water variants flip and shift along a row', () => {
  for (const biome of [Biome.Snow, Biome.Sand, Biome.Water]) {
    const span = biome === Biome.Water ? 128 : 48;
    const seen = new Set<string>();
    const first = tileVariant(biome, 4, 9, 7741, span);
    expect(tileVariant(biome, 4, 9, 7741, span)).toEqual(first);
    for (let x = 0; x < 12; x++) {
      const variant = tileVariant(biome, x, 4, 7741, span);
      expect(variant.ox).toBeGreaterThanOrEqual(0);
      expect(variant.ox).toBeLessThan(span);
      expect(variant.oy).toBeGreaterThanOrEqual(0);
      expect(variant.oy).toBeLessThan(span);
      seen.add(`${variant.id}:${variant.flipX}:${variant.flipY}:${variant.ox}:${variant.oy}`);
    }
    expect(seen.size).toBeGreaterThan(4);
  }
});
