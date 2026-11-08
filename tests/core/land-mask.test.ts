import { expect, test } from 'vitest';
import { DEFAULT_WORLD_SETTINGS } from '../../src/core/world/models';
import { generateWorld, resolveLandStyle, sampleLandMask } from '../../src/core/world/world-gen';
import type { MapStyle } from '../../src/core/world/models';

const SEEDS = [1, 7, 42, 99, 7741, 12011];

function landFraction(seed: number): number {
  const n = 72;
  let land = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (sampleLandMask((x + 0.5) / n, (y + 0.5) / n, 'continent', seed) > 0.2) land += 1;
    }
  }
  return land / (n * n);
}

function bits(seed: number): string {
  let out = '';
  const n = 28;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out += sampleLandMask((x + 0.5) / n, (y + 0.5) / n, 'continent', seed) > 0.2 ? '1' : '0';
    }
  }
  return out;
}

test('a continent stays off the border and keeps a similar amount of land', () => {
  for (const seed of SEEDS) {
    const share = landFraction(seed);
    expect(share).toBeGreaterThan(0.22);
    expect(share).toBeLessThan(0.55);
    for (let i = 0; i < 16; i++) {
      const t = (i + 0.5) / 16;
      expect(sampleLandMask(0.02, t, 'continent', seed)).toBe(0);
      expect(sampleLandMask(0.98, t, 'continent', seed)).toBe(0);
      expect(sampleLandMask(t, 0.02, 'continent', seed)).toBe(0);
      expect(sampleLandMask(t, 0.98, 'continent', seed)).toBe(0);
    }
  }
});

test('different seeds grow different continents', () => {
  const shapes = SEEDS.map(bits);
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      let differ = 0;
      const a = shapes[i] ?? '';
      const b = shapes[j] ?? '';
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) differ += 1;
      expect(differ).toBeGreaterThan(40);
    }
  }
});

test('random picks a stable authored style from the seed', () => {
  expect(resolveLandStyle('fjords', 4)).toBe('fjords');
  const picked = resolveLandStyle('random', 7741);
  expect(picked).not.toBe('custom');
  expect(resolveLandStyle('random', 7741)).toBe(picked);
  expect(resolveLandStyle('random', 3)).not.toBe(resolveLandStyle('random', 8));
});

function northernCoast(style: MapStyle, seed: number): number[] {
  const cuts: number[] = [];
  for (let x = 6; x < 58; x++) {
    let hit = 0;
    for (let y = 1; y < 36; y++) {
      if (sampleLandMask((x + 0.5) / 64, (y + 0.5) / 64, style, seed) > 0.2) {
        hit = y;
        break;
      }
    }
    cuts.push(hit);
  }
  return cuts;
}

test('coasts inside the margin are not a straight cut', () => {
  const styles: MapStyle[] = [
    'continent',
    'archipelago',
    'isthmus',
    'fjords',
    'desert',
    'shattered',
  ];
  for (const style of styles) {
    const cuts = northernCoast(style, 7741);
    const used = new Set(cuts.filter((cut) => cut > 0));
    expect(used.size).toBeGreaterThan(3);
    expect(Math.min(...cuts.filter((cut) => cut > 0))).toBeGreaterThan(1);
  }
});

test('a small continent still grows towns and a road', () => {
  const world = generateWorld(7741, {
    ...DEFAULT_WORLD_SETTINGS,
    worldScale: 1,
    mapStyle: 'continent',
  });
  expect(world.nodes.length).toBeGreaterThan(2);
  expect(world.paths.some((cell) => cell === 1)).toBe(true);
  expect(world.biomes.includes(0)).toBe(true);
});
