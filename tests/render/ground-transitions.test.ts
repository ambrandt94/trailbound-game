import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { BIOME_COUNT, Biome } from '../../src/core/world/models';
import { recolorPixels } from '../../src/render/map/classic-ground';
import {
  DEFAULT_GROUND_MANIFEST,
  GroundTable,
  validateGroundManifest,
  type GroundManifest,
} from '../../src/render/map/ground-manifest';

const table = new GroundTable(DEFAULT_GROUND_MANIFEST);
const id = (biome: Biome) => table.ids[table.groundOf(biome)];
const rank = (g: string) => table.ids.indexOf(g);

test('shipped ground-transitions.json matches the built-in default and validates', () => {
  const raw: unknown = JSON.parse(
    readFileSync('public/assets/map/classic/ground-transitions.json', 'utf8'),
  );
  expect(validateGroundManifest(raw).errors).toEqual([]);
  expect(raw).toEqual(JSON.parse(JSON.stringify(DEFAULT_GROUND_MANIFEST)));
});

test('ground order is water < sand < autumn < grass < lush < snow', () => {
  const order = ['W', 'D', 'A', 'G', 'L', 'S'].map(rank);
  expect(order.every((r, i) => i === 0 || r > order[i - 1]!)).toBe(true);
  expect(id(Biome.Water)).toBe('W');
  expect(id(Biome.Desert)).toBe('D');
  expect(id(Biome.Hills)).toBe('A');
  expect(id(Biome.Plains)).toBe('G');
  expect(id(Biome.Marsh)).toBe('L');
  expect(id(Biome.Taiga)).toBe('S');
  expect(id(Biome.Badlands)).toBe('Db');
  expect(id(Biome.Ashlands)).toBe('Da');
  expect(id(Biome.Mountain)).toBe('Gm');
  for (let b = 0; b < BIOME_COUNT; b++) expect(table.ids[table.groundOf(b)]).toBeDefined();
});

test('tinted grounds resolve to their base fill plus a tint', () => {
  const fill = table.resolveFill(rank('Gm'));
  expect(fill?.fill).toEqual({ sheet: 'pk', col: 1, row: 1 });
  expect(fill?.tints).toEqual([{ base: 'G', tint: [150, 228, 136] }]);
});

test('edges resolve exact pair, then upper/*, then the base ground recoloured', () => {
  const sw = table.resolveEdge(rank('S'), rank('W'));
  expect(sw?.exact).toBe(true);
  expect(sw?.edge.block).toEqual({ sheet: 'pk', col: 4, row: 7 });
  const sg = table.resolveEdge(rank('S'), rank('G'));
  expect(sg?.exact).toBe(false);
  expect(sg?.edge.lower).toBe('*');
  const gmg = table.resolveEdge(rank('Gm'), rank('G'));
  expect(gmg?.edge.upper).toBe('G');
  expect(gmg?.recolors).toEqual([{ base: 'G', tint: [150, 228, 136] }]);
  const dbd = table.resolveEdge(rank('Db'), rank('D'));
  expect(dbd?.edge).toMatchObject({ upper: 'D', lower: '*' });
  expect(dbd?.recolors).toHaveLength(2);
});

test('a painted sheet drops in by manifest and wins over the fallback', () => {
  const painted: GroundManifest = {
    ...DEFAULT_GROUND_MANIFEST,
    sheets: { ...DEFAULT_GROUND_MANIFEST.sheets, art: 'assets/map/classic/tilesets/painted.png' },
    edges: [
      { upper: 'S', lower: 'G', block: { sheet: 'art', col: 0, row: 0 }, key: { mode: 'none' } },
      ...DEFAULT_GROUND_MANIFEST.edges,
    ],
  };
  expect(validateGroundManifest(painted).errors).toEqual([]);
  const t = new GroundTable(painted);
  const hit = t.resolveEdge(t.ids.indexOf('S'), t.ids.indexOf('G'));
  expect(hit?.exact).toBe(true);
  expect(hit?.edge.block.sheet).toBe('art');
});

test('bad manifests are rejected with reasons', () => {
  expect(validateGroundManifest(null).manifest).toBeNull();
  const bad = {
    ...DEFAULT_GROUND_MANIFEST,
    biomes: { Plains: 'Nope', Lava: 'G' },
    edges: [{ upper: 'G', lower: 'Q', block: { sheet: 'missing', col: 0, row: 0 } }],
  };
  const { manifest, errors } = validateGroundManifest(bad);
  expect(manifest).toBeNull();
  expect(errors.join(' ')).toMatch(/unknown biome Lava/);
  expect(errors.join(' ')).toMatch(/Plains maps to unknown ground/);
  expect(errors.join(' ')).toMatch(/edge 0: unknown lower/);
  expect(errors.join(' ')).toMatch(/edge 0: block is not a tile ref/);
});

test('recolour keeps shading, skips far colours and never makes black', () => {
  const px = new Uint8ClampedArray([
    104, 212, 98, 255, 59, 174, 79, 255, 198, 142, 100, 255, 0, 0, 0, 0,
  ]);
  recolorPixels(px, [104, 212, 98], [250, 188, 128]);
  expect([...px.slice(0, 3)]).toEqual([250, 188, 128]);
  expect(px[4]!).toBeLessThan(250);
  expect(px[4]!).toBeGreaterThan(150);
  expect([...px.slice(8, 11)]).toEqual([198, 142, 100]);
  expect(px[15]).toBe(0);
  for (let i = 0; i < 12; i += 4) expect(px[i]! + px[i + 1]! + px[i + 2]!).toBeGreaterThan(24);
});
