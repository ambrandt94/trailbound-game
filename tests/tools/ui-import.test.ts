import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
// Plain JS art tools. They are checked by the importer test, not by tsc.
// @ts-expect-error ui-catalog is an untyped mjs module.
import { SPRITES } from '../../tools/ui-catalog.mjs';
// @ts-expect-error ui-import is an untyped mjs module.
import { importUiSheet } from '../../tools/ui-import.mjs';
// @ts-expect-error ui-png is an untyped mjs module.
import { decodePng, encodePng } from '../../tools/ui-png.mjs';
// @ts-expect-error ui-sheet is an untyped mjs module.
import { buildSheets, layoutSheet, manifestFrom } from '../../tools/ui-sheet.mjs';

describe('ui template import', () => {
  test('sheet cells stay inside the canvas and do not overlap', () => {
    const layout = layoutSheet(SPRITES);
    expect(layout.placed.length).toBe(SPRITES.length);
    for (const sprite of layout.placed) {
      const { rect } = sprite;
      expect(rect.w).toBe(sprite.w);
      expect(rect.h).toBe(sprite.h);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(layout.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(layout.height);
      expect(sprite.w - sprite.borders.l - sprite.borders.r).toBeGreaterThan(0);
      expect(sprite.h - sprite.borders.t - sprite.borders.b).toBeGreaterThan(0);
    }
    for (let i = 0; i < layout.placed.length; i++) {
      for (let j = i + 1; j < layout.placed.length; j++) {
        const a = layout.placed[i]?.rect;
        const b = layout.placed[j]?.rect;
        if (!a || !b) continue;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${layout.placed[i]?.name} overlaps ${layout.placed[j]?.name}`).toBe(false);
      }
    }
  });

  test('import slices a sheet into sprites and 9-slice atlas metadata', () => {
    const layout = layoutSheet(SPRITES);
    const { art } = buildSheets(layout);
    const manifest = manifestFrom(layout);
    const dir = mkdtempSync(join(tmpdir(), 'tb-ui-'));
    writeFileSync(join(dir, 'sheet.png'), encodePng(art));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const spritesDir = join(dir, 'sprites');
    const result = importUiSheet({
      sheetPath: join(dir, 'sheet.png'),
      manifestPath: join(dir, 'manifest.json'),
      spritesDir,
      atlasPath: join(dir, 'atlas.png'),
      atlasJsonPath: join(dir, 'atlas.json'),
    });
    expect(result.count).toBe(SPRITES.length);
    const primary = decodePng(readFileSync(join(spritesDir, 'button_primary.png')));
    expect(primary.w).toBe(80);
    expect(primary.h).toBe(44);
    expect(Array.from(primary.get(40, 22))).toEqual([122, 58, 38, 255]);
    const disabled = decodePng(readFileSync(join(spritesDir, 'button_disabled.png')));
    expect(Array.from(disabled.get(40, 22))).toEqual([210, 192, 164, 255]);
    const atlas = JSON.parse(readFileSync(join(dir, 'atlas.json'), 'utf8')) as {
      display_scale: number;
      version: string;
      sprites: Record<string, { borders: { l: number; t: number; r: number; b: number } }>;
    };
    expect(atlas.version).toBe('3.0.0');
    expect(atlas.display_scale).toBe(1);
    expect(atlas.sprites.header_strip?.borders).toEqual({ l: 0, t: 4, r: 0, b: 4 });
    expect(atlas.sprites.slot_selected?.borders).toEqual({ l: 6, t: 6, r: 6, b: 6 });
  });
});
