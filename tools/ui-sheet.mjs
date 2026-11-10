import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPRITES, SKIN_VERSION } from './ui-catalog.mjs';
import { drawSprite } from './ui-draw.mjs';
import { importUiSheet } from './ui-import.mjs';
import { createImage, encodePng, fillRect } from './ui-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'assets-src/ui-template');

const PARCHMENT = [236, 220, 188, 255];
const GUIDE_INK = [58, 36, 24, 255];
const SLICE = [196, 48, 96, 255];
const CAPTION = 40;
const GAP = 22;
const MARGIN = 16;
const SHEET_W = 1680;

/** 5×7 glyphs, top row first, bit 4 is the left pixel. */
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 0, 12, 8],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '/': [1, 2, 4, 8, 16, 0, 0],
  x: [0, 17, 10, 4, 10, 17, 0],
  0: [14, 17, 19, 21, 25, 17, 14],
  1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 6, 8, 16, 31],
  3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2],
  5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14],
  7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [14, 17, 16, 14, 1, 17, 14],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
};

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {readonly number[]} color
 * @param {number} scale
 */
export function drawLabel(img, text, x, y, color, scale = 2) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row] ?? 0;
      for (let col = 0; col < 5; col++) {
        if ((bits & (1 << (4 - col))) === 0) continue;
        fillRect(img, cx + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cx += 6 * scale;
  }
  return cx;
}

/** @param {typeof SPRITES} sprites */
export function layoutSheet(sprites) {
  /** @type {Array<typeof sprites[number] & { rect: { x: number, y: number, w: number, h: number }, cell: { x: number, y: number, w: number, h: number } }>} */
  const placed = [];
  let x = MARGIN;
  let y = MARGIN;
  let rowH = 0;
  let maxX = 0;
  let group = '';
  for (const sprite of sprites) {
    if (sprite.group !== group) {
      if (group) {
        x = MARGIN;
        y += rowH + GAP;
        rowH = 0;
      }
      group = sprite.group;
      y += 22;
    }
    const cellW = Math.max(sprite.w + 12, 360);
    const cellH = CAPTION + sprite.h;
    if (x + cellW > SHEET_W - MARGIN) {
      x = MARGIN;
      y += rowH + GAP;
      rowH = 0;
    }
    const rect = {
      x: x + Math.floor((cellW - sprite.w) / 2),
      y: y + CAPTION,
      w: sprite.w,
      h: sprite.h,
    };
    placed.push({ ...sprite, rect, cell: { x, y, w: cellW, h: cellH } });
    x += cellW + GAP;
    maxX = Math.max(maxX, x);
    rowH = Math.max(rowH, cellH);
  }
  return { placed, width: SHEET_W, height: y + rowH + MARGIN, maxX };
}

/** @param {ReturnType<typeof layoutSheet>} layout */
export function buildSheets(layout) {
  const art = createImage(layout.width, layout.height);
  const guide = createImage(layout.width, layout.height);
  const blank = createImage(layout.width, layout.height);
  fillRect(art, 0, 0, art.w, art.h, PARCHMENT);
  fillRect(blank, 0, 0, blank.w, blank.h, PARCHMENT);
  let group = '';
  for (const sprite of layout.placed) {
    if (sprite.group !== group) {
      group = sprite.group;
      drawLabel(art, group, MARGIN, sprite.cell.y - 20, GUIDE_INK, 2);
      drawLabel(guide, group, MARGIN, sprite.cell.y - 20, GUIDE_INK, 2);
      drawLabel(blank, group, MARGIN, sprite.cell.y - 20, GUIDE_INK, 2);
    }
    const drawn = drawSprite(sprite);
    blit(art, drawn, sprite.rect.x, sprite.rect.y);
    const slice =
      sprite.borders.l + sprite.borders.t + sprite.borders.r + sprite.borders.b === 0
        ? 'fixed'
        : `slice ${sprite.borders.l} ${sprite.borders.t} ${sprite.borders.r} ${sprite.borders.b}`;
    const line1 = `${sprite.name} ${sprite.state ?? ''}`.trim();
    const line2 = `${sprite.w}x${sprite.h} ${slice}`;
    drawLabel(guide, line1, sprite.cell.x, sprite.cell.y + 2, GUIDE_INK, 2);
    drawLabel(guide, line2, sprite.cell.x, sprite.cell.y + 20, GUIDE_INK, 2);
    drawLabel(blank, line1, sprite.cell.x, sprite.cell.y + 2, GUIDE_INK, 2);
    drawLabel(blank, line2, sprite.cell.x, sprite.cell.y + 20, GUIDE_INK, 2);
    strokeRect(guide, sprite.rect.x, sprite.rect.y, sprite.rect.w, sprite.rect.h, GUIDE_INK);
    strokeRect(blank, sprite.rect.x, sprite.rect.y, sprite.rect.w, sprite.rect.h, GUIDE_INK);
    drawSlices(guide, sprite);
    drawSlices(blank, sprite);
  }
  return { art, guide, blank };
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {ReturnType<typeof layoutSheet>['placed'][number]} sprite
 */
function drawSlices(img, sprite) {
  const { x, y, w, h } = sprite.rect;
  const b = sprite.borders;
  if (b.l > 0) vline(img, x + b.l, y, h, SLICE);
  if (b.r > 0) vline(img, x + w - b.r, y, h, SLICE);
  if (b.t > 0) hline(img, x, y + b.t, w, SLICE);
  if (b.b > 0) hline(img, x, y + h - b.b, w, SLICE);
}

/**
 * @param {ReturnType<typeof createImage>} dest
 * @param {ReturnType<typeof createImage>} src
 * @param {number} dx
 * @param {number} dy
 */
function blit(dest, src, dx, dy) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.data[i + 3] === 0) continue;
      dest.px(dx + x, dy + y, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
    }
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {readonly number[]} color
 */
function strokeRect(img, x, y, w, h, color) {
  hline(img, x, y, w, color);
  hline(img, x, y + h - 1, w, color);
  vline(img, x, y, h, color);
  vline(img, x + w - 1, y, h, color);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {readonly number[]} color
 */
function hline(img, x, y, w, color) {
  for (let i = 0; i < w; i++) img.px(x + i, y, color);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} x
 * @param {number} y
 * @param {number} h
 * @param {readonly number[]} color
 */
function vline(img, x, y, h, color) {
  for (let i = 0; i < h; i++) img.px(x, y + i, color);
}

/** @param {ReturnType<typeof layoutSheet>} layout */
export function manifestFrom(layout) {
  /** @type {Record<string, unknown>} */
  const sprites = {};
  for (const sprite of layout.placed) {
    sprites[sprite.name] = {
      rect: sprite.rect,
      borders: sprite.borders,
      state: sprite.state,
      label: sprite.label,
      group: sprite.group,
      notes: sprite.borders.l + sprite.borders.t === 0 ? 'fixed icon, not a 9-slice' : '',
    };
  }
  return {
    version: SKIN_VERSION,
    title: 'Trailbound UI template sheet',
    sheet: 'ui_template_sheet.png',
    guide: 'ui_template_sheet_guide.png',
    blank: 'ui_template_sheet_blank.png',
    width: layout.width,
    height: layout.height,
    font: {
      family: 'Softball Gold',
      designPx: 16,
      bodyPx: 32,
      titlePx: 48,
    },
    sprites,
  };
}

function main() {
  const layout = layoutSheet(SPRITES);
  const { art, guide, blank } = buildSheets(layout);
  const manifest = manifestFrom(layout);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'ui_template_sheet.png'), encodePng(art));
  writeFileSync(join(dir, 'ui_template_sheet_guide.png'), encodePng(guide));
  writeFileSync(join(dir, 'ui_template_sheet_blank.png'), encodePng(blank));
  writeFileSync(join(dir, 'ui_template_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const imported = importUiSheet({
    sheetPath: join(dir, 'ui_template_sheet.png'),
    manifestPath: join(dir, 'ui_template_manifest.json'),
    spritesDir: join(root, 'src/ui/theme/sprites'),
    atlasPath: join(root, 'src/ui/theme/ui_atlas.png'),
    atlasJsonPath: join(root, 'src/ui/theme/ui_atlas_9slice.json'),
  });
  console.log(
    `sheet ${layout.width}x${layout.height} sprites ${layout.placed.length} atlas ${imported.atlasW}x${imported.atlasH}`,
  );
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) main();
