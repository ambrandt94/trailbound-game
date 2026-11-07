import { expect, test } from 'vitest';
import { areaReduce, mipForScreenPx } from '../../src/render/map/art-mip';
import { waterKindAt } from '../../src/render/map/tile-fill';

test('the mip follows how large a tile is on screen', () => {
  expect(mipForScreenPx(0.3)).toBe(1);
  expect(mipForScreenPx(0.8)).toBe(1);
  expect(mipForScreenPx(3.5)).toBe(3);
  expect(mipForScreenPx(11)).toBe(12);
  expect(mipForScreenPx(24)).toBe(24);
  expect(mipForScreenPx(57)).toBe(48);
});

test('area reduction stays on colours that are already in the tile', () => {
  const src = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const o = (y * 4 + x) * 4;
      const red = x < 2;
      src[o] = red ? 200 : 10;
      src[o + 1] = red ? 40 : 80;
      src[o + 2] = red ? 20 : 180;
      src[o + 3] = 255;
    }
  }
  const out = areaReduce(src, 4, 2);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i] ?? 0;
    const g = out[i + 1] ?? 0;
    const b = out[i + 2] ?? 0;
    const known = (r === 200 && g === 40 && b === 20) || (r === 10 && g === 80 && b === 180);
    expect(known).toBe(true);
  }
});

test('the shallow water line wobbles instead of cutting the whole tile', () => {
  const at = (x: number, _y: number) => (x < 4 ? 2 : 0);
  let shallow = 0;
  let samples = 0;
  for (let ty = 0; ty < 8; ty++) {
    for (let py = 0; py < 48; py += 3) {
      samples += 1;
      if (waterKindAt(6, ty, 8, py, 7741, at) === 'shallow') shallow += 1;
    }
  }
  expect(shallow).toBeGreaterThan(samples * 0.08);
  expect(shallow).toBeLessThan(samples * 0.92);
});
