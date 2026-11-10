import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKIN_VERSION } from './ui-catalog.mjs';
import { createImage, decodePng, encodePng } from './ui-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} ManifestSprite
 * @property {{ x: number, y: number, w: number, h: number }} rect
 * @property {{ l: number, t: number, r: number, b: number }} borders
 * @property {string | null} state
 * @property {string} [label]
 * @property {string} [notes]
 */

/**
 * @typedef {object} Manifest
 * @property {string} version
 * @property {number} width
 * @property {number} height
 * @property {Record<string, ManifestSprite>} sprites
 */

/**
 * @param {object} options
 * @param {string} options.sheetPath
 * @param {string} options.manifestPath
 * @param {string} options.spritesDir
 * @param {string} options.atlasPath
 * @param {string} options.atlasJsonPath
 */
export function importUiSheet(options) {
  const sheet = decodePng(readFileSync(options.sheetPath));
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
  const names = Object.keys(manifest.sprites).sort();
  /** @type {Record<string, ReturnType<typeof createImage>>} */
  const images = {};
  for (const name of names) {
    const entry = manifest.sprites[name];
    const { x, y, w, h } = entry.rect;
    if (w < 1 || h < 1) throw new Error(`${name} has an empty rect`);
    if (x < 0 || y < 0 || x + w > sheet.w || y + h > sheet.h) {
      throw new Error(`${name} rect falls outside the sheet`);
    }
    const img = createImage(w, h);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) img.px(xx, yy, sheet.get(x + xx, y + yy));
    }
    images[name] = img;
  }
  mkdirSync(options.spritesDir, { recursive: true });
  const keep = new Set(names.map((name) => `${name}.png`));
  for (const file of readdirSync(options.spritesDir)) {
    if (file.endsWith('.png') && !keep.has(file)) unlinkSync(join(options.spritesDir, file));
  }
  for (const name of names) {
    writeFileSync(join(options.spritesDir, `${name}.png`), encodePng(images[name]));
  }
  const packed = packAtlas(names, images);
  writeFileSync(options.atlasPath, encodePng(packed.image));
  const atlas = {
    version: manifest.version ?? SKIN_VERSION,
    title: 'Trailbound UI v3',
    atlas: 'ui_atlas.png',
    width: packed.image.w,
    height: packed.image.h,
    padding: 2,
    extrude: 1,
    grid: 1,
    display_scale: 1,
    sprites: Object.fromEntries(
      names.map((name) => {
        const entry = manifest.sprites[name];
        return [
          name,
          {
            rect: packed.rects[name],
            borders: entry.borders,
            recommended_scale: 1,
            state: entry.state ?? null,
            notes: entry.notes ?? entry.label ?? '',
          },
        ];
      }),
    ),
  };
  writeFileSync(options.atlasJsonPath, `${JSON.stringify(atlas, null, 2)}\n`);
  return { count: names.length, atlasW: packed.image.w, atlasH: packed.image.h };
}

/**
 * @param {string[]} names
 * @param {Record<string, ReturnType<typeof createImage>>} images
 */
export function packAtlas(names, images) {
  const padding = 2;
  const extrude = 1;
  const gap = padding;
  let x = gap;
  let y = gap;
  let rowH = 0;
  const maxW = 1024;
  /** @type {Record<string, { x: number, y: number, w: number, h: number }>} */
  const rects = {};
  let needW = 0;
  let needH = 0;
  for (const name of names) {
    const img = images[name];
    if (x + img.w + gap > maxW) {
      x = gap;
      y += rowH + gap;
      rowH = 0;
    }
    rects[name] = { x, y, w: img.w, h: img.h };
    x += img.w + gap;
    rowH = Math.max(rowH, img.h);
    needW = Math.max(needW, x);
    needH = Math.max(needH, y + img.h + gap);
  }
  const image = createImage(needW, needH);
  for (const name of names) {
    const img = images[name];
    const rect = rects[name];
    for (let yy = -extrude; yy < img.h + extrude; yy++) {
      for (let xx = -extrude; xx < img.w + extrude; xx++) {
        const sx = Math.min(img.w - 1, Math.max(0, xx));
        const sy = Math.min(img.h - 1, Math.max(0, yy));
        image.px(rect.x + xx, rect.y + yy, img.get(sx, sy));
      }
    }
  }
  return { image, rects };
}

function main() {
  const result = importUiSheet({
    sheetPath: join(root, 'assets-src/ui-template/ui_template_sheet.png'),
    manifestPath: join(root, 'assets-src/ui-template/ui_template_manifest.json'),
    spritesDir: join(root, 'src/ui/theme/sprites'),
    atlasPath: join(root, 'src/ui/theme/ui_atlas.png'),
    atlasJsonPath: join(root, 'src/ui/theme/ui_atlas_9slice.json'),
  });
  console.log(`imported ${result.count} sprites into ${result.atlasW}x${result.atlasH} atlas`);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) main();
