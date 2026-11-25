import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseCloudAtlas } from '../../src/render/worldgen/cloud-atlas';
// @ts-expect-error ui-png is an untyped mjs module.
import { decodePng } from '../../tools/ui-png.mjs';

const meta = parseCloudAtlas(
  JSON.parse(readFileSync('public/assets/worldgen/clouds/cloud-atlas.json', 'utf8')),
);
const png = decodePng(readFileSync('public/assets/worldgen/clouds/cloud-atlas.png'));

describe('cloud atlas', () => {
  test('the shipped PNG matches the JSON size, including the 55px cover', () => {
    expect(meta.size).toEqual([png.w, png.h]);
    expect(meta.sprites['cover-a']).toMatchObject({ w: 55, h: 55 });
    expect(meta.sprites['cover-b']).toMatchObject({ w: 55, h: 55 });
    expect(meta.sprites.haze).toMatchObject({ w: 55, h: 55 });
    expect(meta.sprites.veil).toMatchObject({ w: 55, h: 55 });
  });
});
