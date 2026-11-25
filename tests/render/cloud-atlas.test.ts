import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseCloudAtlas } from '../../src/render/worldgen/cloud-atlas';
import { puffRingCount } from '../../src/render/worldgen/regions-overlay';
// @ts-expect-error ui-png is an untyped mjs module.
import { decodePng } from '../../tools/ui-png.mjs';

const meta = parseCloudAtlas(
  JSON.parse(readFileSync('public/assets/worldgen/clouds/cloud-atlas.json', 'utf8')),
);
const png = decodePng(readFileSync('public/assets/worldgen/clouds/cloud-atlas.png'));

describe('cloud atlas', () => {
  test('cover, haze and veil are 64 and the puffs stay 48×32', () => {
    expect(meta.size).toEqual([png.w, png.h]);
    for (const name of ['cover-a', 'cover-b', 'haze', 'veil']) {
      expect(meta.sprites[name]).toMatchObject({ w: 64, h: 64 });
    }
    expect(meta.puffs).toEqual(['puff-0', 'puff-1']);
    for (const name of meta.puffs) {
      expect(meta.sprites[name]).toMatchObject({ w: 48, h: 32 });
    }
    // Rims, poof frames and clearing-rim frames were not redrawn.
    for (const name of meta.anims.poof!.frames) {
      expect(meta.sprites[name]).toMatchObject({ w: 28, h: 28 });
    }
    for (const name of meta.anims.clearingRim!.frames) {
      expect(meta.sprites[name]).toMatchObject({ w: 25, h: 25 });
    }
    expect(meta.shadows).toHaveLength(4);
  });

  test('rects stay inside the atlas and do not overlap', () => {
    const rects = Object.entries(meta.sprites);
    for (const [name, rect] of rects) {
      expect(rect.x + rect.w, name).toBeLessThanOrEqual(meta.size[0]);
      expect(rect.y + rect.h, name).toBeLessThanOrEqual(meta.size[1]);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]![1];
        const b = rects[j]![1];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${rects[i]![0]} overlaps ${rects[j]![0]}`).toBe(true);
      }
    }
  });

  test('the kept rim art is the previous peach frame, not a resample of the cover', () => {
    const rim = meta.sprites['rim-0']!;
    expect(Array.from(png.get(rim.x, rim.y))).toEqual([244, 201, 169, 255]);
  });
});

describe('puff ring pitch', () => {
  test('a 48px puff steps by its own width instead of the old 14px pitch', () => {
    // Circumference of a 200px clearing is about 1257. At 48×3×0.85 the pitch
    // is 122px, so the ring is about 10 stamps, not the 30 the old 14px step made.
    expect(puffRingCount(200, 3, 48)).toBe(10);
    expect(puffRingCount(30, 3, 48)).toBe(0);
    expect(puffRingCount(400, 2, 48)).toBe(24);
  });
});
