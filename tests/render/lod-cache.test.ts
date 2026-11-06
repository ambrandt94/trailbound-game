import { expect, test } from 'vitest';
import { Biome, TILE, type WorldData, type WorldSettings } from '../../src/core/world/models';
import {
  FAR_BLOCK,
  FarSheet,
  chunkDetailWanted,
  lodLevelForScreenPx,
  mipFactorFor,
  nonBlack,
  solidPalette,
} from '../../src/render/map/detail-lod';
import { ImageLodCache, downsamplePixels } from '../../src/render/map/lod-cache';

const settings = {
  worldScale: 1,
  mapStyle: 'continent',
  poiCount: 0,
  wanderers: 0,
  caravans: 0,
  armies: 0,
  landSketch: null,
  residentsMode: 'perPlace',
  avgPerHouse: 2,
  avgPerPlace: 8,
} as WorldSettings;

function tinyWorld(): WorldData {
  const width = 4;
  const height = 4;
  const biomes = new Uint8Array(width * height);
  biomes.fill(Biome.Plains);
  biomes[0] = Biome.Water;
  const paths = new Uint8Array(width * height);
  paths[1 + 1 * width] = 1;
  return {
    seed: 7,
    width,
    height,
    settings,
    biomes,
    heightM: new Float32Array(width * height),
    heights: new Float32Array(width * height),
    paths,
    nodes: [],
    pois: [],
    features: [],
  };
}

test('lod level follows screen pixels per world tile, not a crossfade band', () => {
  expect(lodLevelForScreenPx(0.2)).toBe(3);
  expect(lodLevelForScreenPx(2.9)).toBe(3);
  expect(lodLevelForScreenPx(3)).toBe(2);
  expect(lodLevelForScreenPx(11)).toBe(2);
  expect(lodLevelForScreenPx(12)).toBe(1);
  expect(lodLevelForScreenPx(47)).toBe(1);
  expect(lodLevelForScreenPx(48)).toBe(0);
  expect(lodLevelForScreenPx(TILE * 0.016)).toBe(3);
  expect(lodLevelForScreenPx(TILE * 9)).toBe(0);
});

test('street chunks are requested from screen size, at the same threshold on either side of the old fade', () => {
  expect(chunkDetailWanted(0.016)).toBe(false);
  expect(chunkDetailWanted(1)).toBe(false);
  expect(chunkDetailWanted(2.9)).toBe(false);
  expect(chunkDetailWanted(3)).toBe(true);
  expect(chunkDetailWanted(4.1)).toBe(chunkDetailWanted(4.3));
  expect(chunkDetailWanted(9)).toBe(true);
});

test('mip factor gets coarser as the tile shrinks on screen', () => {
  expect(mipFactorFor(384, 400)).toBe(1);
  expect(mipFactorFor(384, 200)).toBe(1);
  expect(mipFactorFor(384, 100)).toBe(2);
  expect(mipFactorFor(384, 50)).toBe(4);
  expect(mipFactorFor(384, 40)).toBe(8);
  expect(mipFactorFor(128, 10)).toBe(8);
});

test('the image cache evicts the least recently used entry and a read keeps it', () => {
  const cache = new ImageLodCache<string>(100);
  cache.set('a', 'A', 40, 1);
  cache.set('b', 'B', 40, 2);
  cache.set('c', 'C', 40, 4);
  expect(cache.has('a')).toBe(false);
  expect(cache.get('b')).toBe('B');
  cache.set('d', 'D', 40, 8);
  expect(cache.has('b')).toBe(true);
  expect(cache.has('c')).toBe(false);
  expect(cache.get('d')).toBe('D');
  expect(cache.bytes).toBeLessThanOrEqual(100);
  expect(cache.levelOf('d')).toBe(8);
});

test('downsampling keeps the source colour and shrinks the image', () => {
  const src = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < src.length; i += 4) {
    src[i] = 192;
    src[i + 1] = 64;
    src[i + 2] = 32;
    src[i + 3] = 255;
  }
  const small = downsamplePixels(src, 4, 4, 2);
  expect(small.width).toBe(2);
  expect(small.height).toBe(2);
  expect(small.data[0]! + small.data[1]! + small.data[2]!).toBeGreaterThan(18);
  expect(small.data[0]).toBeGreaterThan(80);
  expect(small.data[3]).toBe(255);
  expect(nonBlack(0, 0, 0, [127, 175, 114])).toEqual([127, 175, 114]);
  expect(nonBlack(20, 80, 40, [1, 2, 3])).toEqual([20, 80, 40]);
});

test('the far sheet is one texel per world tile and roads stay on the path texel', () => {
  const world = tinyWorld();
  const sheet = new FarSheet(
    solidPalette(
      15,
      { r: 90, g: 150, b: 60 },
      { r: 190, g: 150, b: 70 },
      { r: 40, g: 110, b: 150 },
    ),
  );
  let guard = 0;
  while (!sheet.step(world, 2, 2, 50) && guard < 8) guard += 1;
  expect(sheet.ready).toBe(true);
  expect(sheet.blockCount(world)).toBe(1);
  expect(FAR_BLOCK).toBeGreaterThanOrEqual(world.width);

  const water = sheet.colorAt(0, 0);
  const land = sheet.colorAt(2, 2);
  const road = sheet.colorAt(1, 1);
  expect(water).toEqual({ r: 40, g: 110, b: 150 });
  expect(land).toEqual({ r: 90, g: 150, b: 60 });
  expect(road).toEqual({ r: 190, g: 150, b: 70 });
  for (const pixel of [water, land, road]) {
    expect(pixel).toBeTruthy();
    expect(pixel!.r + pixel!.g + pixel!.b).toBeGreaterThan(18);
  }
  expect(sheet.bytes).toBe(world.width * world.height * 4);
});
