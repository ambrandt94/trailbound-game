import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { skinText } from '../../src/ui/glyphs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(join(root, 'src/ui/theme/pixel-skin.css'), 'utf8');
const creator = readFileSync(join(root, 'src/ui/creator.tsx'), 'utf8');
const slice = JSON.parse(readFileSync(join(root, 'src/ui/theme/ui_atlas_9slice.json'), 'utf8')) as {
  version: string;
  sprites: Record<string, { borders: { l: number; t: number; r: number; b: number } }>;
};

describe('pixel menu skin', () => {
  test('bundles v2.1.2 sprites and does not point at concept urls', () => {
    expect(slice.version).toBe('2.1.2');
    expect(css).not.toContain('/workspace');
    expect(css.toLowerCase()).not.toContain('#000');
    expect(css).toContain('#2a1d2c');
    expect(css).toContain('SoftballGold.woff');
    expect(css).toContain('SoftballGold.ttf');
    expect(css).toContain('font-size: 16px');
    expect(css).toContain('font-size: 32px');

    const urls = [...css.matchAll(/url\('\.\/sprites\/([^']+)'\)/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(8);
    const files = new Set(readdirSync(join(root, 'src/ui/theme/sprites')));
    for (const name of urls) {
      expect(files.has(name ?? ''), `${name} is missing from the sprite folder`).toBe(true);
    }
    expect(files.has('frame.png')).toBe(true);
    expect(files.has('header_strip.png')).toBe(true);
  });

  test('border slices follow the atlas metadata', () => {
    expect(slice.sprites.frame?.borders).toEqual({ l: 16, t: 16, r: 16, b: 16 });
    expect(slice.sprites.frame_light?.borders).toEqual({ l: 8, t: 8, r: 8, b: 8 });
    expect(slice.sprites.title_bar?.borders).toEqual({ l: 16, t: 10, r: 16, b: 16 });
    expect(slice.sprites.header_strip?.borders).toEqual({ l: 0, t: 2, r: 0, b: 2 });
    expect(slice.sprites.button_normal?.borders).toEqual({ l: 8, t: 6, r: 8, b: 6 });
    expect(css).toContain('border-image-slice: 16;');
    expect(css).toContain('border-image-slice: 8;');
    expect(css).toContain('border-image-slice: 10 16 16 16;');
    expect(css).toContain('border-image-slice: 2 0 2 0 fill;');
    expect(css).toContain('border-image-slice: 6 8 6 8;');
  });

  test('the paperdoll uses the menu skin', () => {
    const wardrobe = readFileSync(join(root, 'src/ui/wardrobe.tsx'), 'utf8');
    expect(creator).not.toContain('wardrobe-selection');
    expect(creator).not.toContain('data-surface="wardrobe"');
    expect(wardrobe).toContain('data-surface="paperdoll"');
    expect(wardrobe).toContain('tb-wardrobe');
    expect(wardrobe).not.toContain('wardrobe-selection');
    expect(css).toContain('.tb-wardrobe-columns');
    expect(css).not.toContain('.wardrobe-selection');
  });

  test('menu copy uses glyphs Softball Gold can draw', () => {
    expect(skinText('Charting the continent…')).toBe('Charting the continent...');
    expect(skinText('Loading the road…')).toBe('Loading the road...');
    expect(skinText('WASD move · Shift sprint')).toBe('WASD move | Shift sprint');
    expect(skinText('×0.25')).toBe('x0.25');
    expect(skinText('Pixel scale (render ÷)')).toBe('Pixel scale (render /)');
    expect(skinText('Bayer 4×4')).toBe('Bayer 4x4');
  });
});
