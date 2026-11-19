/**
 * Builds the art template for the day-cycle HUD: every sprite slot laid out as
 * its own cell on a 512x512 transparent sheet at one whole-number upscale,
 * with generous gutters, plus a guide with outlines and names, a native-size
 * (1x) sheet, and `layout.json` (cell rectangles in both coordinate systems).
 *
 *   node tools/hud-day-cycle-template.mjs [--out <dir>]
 *
 * Reads `manifest.json` and the PNGs in `public/assets/ui/hud-day-cycle/`, so
 * the template always shows the art that is in the game now. Edit the sheet,
 * then `node tools/hud-day-cycle-slice.mjs <sheet.png>` puts it back.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createImage, decodePng, encodePng } from './ui-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ART_DIR = join(root, 'public', 'assets', 'ui', 'hud-day-cycle');
export const TEMPLATE_DIR = join(ART_DIR, 'template');
export const SHEET = 512;
const MIN_GUTTER_PX = 16;
const LABEL_SCALE = 1;

/** Rows of this many glyphs for the font sheet, so it fits at a big scale. */
const FONT_ROW_GLYPHS = 14;

/** @param {ReturnType<typeof createImage>} img @param {number} x @param {number} y @param {number} w @param {number} h */
function crop(img, x, y, w, h) {
  const out = createImage(w, h);
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) out.px(xx, yy, img.get(x + xx, y + yy));
  return out;
}

/** Plan every cell, native size and label, before any position is known. */
export function planCells(manifest, art) {
  /** @type {Array<{slot: string, state: string, w: number, h: number, img: any, label: string, part?: any}>} */
  const cells = [];
  for (const [id, def] of Object.entries(manifest.sprites)) {
    const sheet = art.get(def.file);
    def.states.forEach((state, i) => {
      const label = (def.states.length > 1 ? `${id} ${state}` : id)
        .toUpperCase()
        .replace(/_/g, '-');
      cells.push({
        slot: id,
        state,
        w: def.w,
        h: def.h,
        img: crop(sheet, i * def.w, 0, def.w, def.h),
        label,
      });
    });
  }
  const font = manifest.font;
  const fontImg = art.get(font.file);
  const count = font.glyphs.length;
  for (let start = 0, row = 1; start < count; start += FONT_ROW_GLYPHS, row++) {
    const n = Math.min(FONT_ROW_GLYPHS, count - start);
    cells.push({
      slot: 'pixel_font',
      state: `row${row}`,
      w: n * font.cellW,
      h: font.cellH,
      img: crop(fontImg, start * font.cellW, 0, n * font.cellW, font.cellH),
      label: `PIXEL-FONT ROW ${row}`,
      part: { glyphStart: start, glyphCount: n },
    });
  }
  return cells;
}

function labelWidthPx(label, font) {
  let w = 0;
  for (const ch of label) w += ((font.widths[ch] ?? font.cellW) + font.spacing) * LABEL_SCALE;
  return w - font.spacing * LABEL_SCALE;
}

/** Shelf-pack footprints (cell plus its label) at a given scale. Returns null if it does not fit. */
export function pack(cells, scale, font) {
  const native = Math.floor(SHEET / scale);
  const gutter = Math.max(3, Math.ceil(MIN_GUTTER_PX / scale));
  const labelRows = Math.ceil((5 * LABEL_SCALE + 3) / scale);
  const items = cells.map((cell) => ({
    cell,
    fw: Math.max(cell.w, Math.ceil(labelWidthPx(cell.label, font) / scale)),
    fh: cell.h + labelRows,
  }));
  items.sort((a, b) => b.fh - a.fh || b.fw - a.fw);
  const maxX = native - gutter;
  let x = gutter;
  let y = gutter;
  let rowH = 0;
  for (const item of items) {
    if (item.fw > maxX - gutter) return null;
    if (x + item.fw > maxX) {
      x = gutter;
      y += rowH + gutter;
      rowH = 0;
    }
    item.x = x;
    item.y = y;
    x += item.fw + gutter;
    rowH = Math.max(rowH, item.fh);
  }
  if (y + rowH > native - gutter) return null;
  return { items, native, gutter };
}

/** Largest whole-number scale that fits, and the packed cells at that scale. */
export function planLayout(manifest, art) {
  const cells = planCells(manifest, art);
  for (let scale = 12; scale >= 2; scale--) {
    const packed = pack(cells, scale, manifest.font);
    if (packed) return { scale, ...packed };
  }
  throw new Error('the HUD cells do not fit on a 512 sheet at 2x');
}

function stamp(sheet, img, ox, oy, scale) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const c = img.get(x, y);
      if (c[3] === 0) continue;
      for (let yy = 0; yy < scale; yy++)
        for (let xx = 0; xx < scale; xx++) sheet.px(ox + x * scale + xx, oy + y * scale + yy, c);
    }
  }
}

function rect(img, x, y, w, h, color) {
  for (let i = 0; i < w; i++) {
    img.px(x + i, y, color);
    img.px(x + i, y + h - 1, color);
  }
  for (let i = 0; i < h; i++) {
    img.px(x, y + i, color);
    img.px(x + w - 1, y + i, color);
  }
}

function drawText(img, font, fontImg, text, x, y, color) {
  let dx = x;
  for (const ch of text) {
    const index = font.glyphs.indexOf(ch);
    const width = font.widths[ch] ?? font.cellW;
    if (index >= 0 && ch !== ' ') {
      for (let gy = 0; gy < font.cellH; gy++) {
        for (let gx = 0; gx < width; gx++) {
          if (fontImg.get(index * font.cellW + gx, gy)[3] === 0) continue;
          for (let yy = 0; yy < LABEL_SCALE; yy++) {
            for (let xx = 0; xx < LABEL_SCALE; xx++)
              img.px(dx + gx * LABEL_SCALE + xx, y + gy * LABEL_SCALE + yy, color);
          }
        }
      }
    }
    dx += (width + font.spacing) * LABEL_SCALE;
  }
}

export function buildTemplate(artDir = ART_DIR) {
  const manifest = JSON.parse(readFileSync(join(artDir, 'manifest.json'), 'utf8'));
  /** @type {Map<string, any>} */
  const art = new Map();
  for (const def of Object.values(manifest.sprites))
    art.set(def.file, decodePng(readFileSync(join(artDir, def.file))));
  art.set(manifest.font.file, decodePng(readFileSync(join(artDir, manifest.font.file))));

  const { scale, items, native, gutter } = planLayout(manifest, art);
  const sheet = createImage(SHEET, SHEET);
  const flat = createImage(native, native);
  const guide = createImage(SHEET, SHEET);
  for (let i = 0; i < guide.data.length; i += 4) {
    guide.data[i] = 44;
    guide.data[i + 1] = 49;
    guide.data[i + 2] = 60;
    guide.data[i + 3] = 255;
  }
  const fontImg = art.get(manifest.font.file);

  const slotCells = new Map();
  const fontRows = [];
  for (const item of items) {
    const { cell } = item;
    const ox = item.x * scale;
    const oy = item.y * scale;
    stamp(sheet, cell.img, ox, oy, scale);
    stamp(guide, cell.img, ox, oy, scale);
    stamp(flat, cell.img, item.x, item.y, 1);
    const rect512 = { x: ox, y: oy, w: cell.w * scale, h: cell.h * scale };
    const rect1x = { x: item.x, y: item.y, w: cell.w, h: cell.h };
    if (cell.part) fontRows.push({ state: cell.state, ...cell.part, rect: rect512, rect1x });
    else {
      if (!slotCells.has(cell.slot)) slotCells.set(cell.slot, []);
      slotCells.get(cell.slot).push({ state: cell.state, rect: rect512, rect1x });
    }
  }
  // Guide: cell outlines, 9-slice lines, anchors, names.
  const line = [255, 80, 200, 255];
  const sliceColor = [80, 230, 255, 255];
  const anchorColor = [255, 230, 60, 255];
  const white = [245, 245, 250, 255];
  for (const item of items) {
    const { cell } = item;
    const ox = item.x * scale;
    const oy = item.y * scale;
    rect(guide, ox - 1, oy - 1, cell.w * scale + 2, cell.h * scale + 2, line);
    const def = manifest.sprites[cell.slot];
    if (def?.slice) {
      const [l, t, r, b] = def.slice;
      for (let x = l; x < def.w - r + 1; x += def.w - r - l || 1) {
        for (let y = 0; y < cell.h * scale; y++)
          if (y % 4 < 2) guide.px(ox + x * scale, oy + y, sliceColor);
      }
      for (let y = t; y < def.h - b + 1; y += def.h - b - t || 1) {
        for (let x = 0; x < cell.w * scale; x++)
          if (x % 4 < 2) guide.px(ox + x, oy + y * scale, sliceColor);
      }
    }
    if (def && cell.state === def.states[0]) {
      const ax = ox + def.anchor[0] * scale + Math.floor(scale / 2);
      const ay = oy + def.anchor[1] * scale + Math.floor(scale / 2);
      for (let d = -2; d <= 2; d++) {
        guide.px(ax + d, ay, anchorColor);
        guide.px(ax, ay + d, anchorColor);
      }
    }
    drawText(guide, manifest.font, fontImg, cell.label, ox, oy + cell.h * scale + 3, white);
  }

  // Guide only: the font rows are solid strips, so mark each glyph cell and name it above the row.
  const tick = [255, 80, 200, 255];
  for (const row of fontRows) {
    for (let g = 0; g < row.glyphCount; g++) {
      const gx = row.rect.x + g * manifest.font.cellW * scale;
      for (let y = 1; y <= 3; y++) guide.px(gx, row.rect.y - y, tick);
      const ch = manifest.font.glyphs[row.glyphStart + g] ?? ' ';
      drawText(guide, manifest.font, fontImg, ch, gx + 2, row.rect.y - 8, [190, 200, 220, 255]);
    }
  }

  const slots = Object.entries(manifest.sprites).map(([id, def]) => ({
    id,
    file: def.file,
    w: def.w,
    h: def.h,
    anchor: def.anchor,
    ...(def.slice ? { slice: def.slice } : {}),
    states: def.states,
    // Frames go back into the PNG in state order, whatever order the packer placed them in.
    cells: def.states.map((state) => slotCells.get(id).find((c) => c.state === state)),
  }));
  const layout = {
    version: 1,
    note: 'Cell rectangles: `rect` is in 512 sheet pixels, `rect1x` in native pixels. Each cell is `w x h` native pixels shown at `scale`.',
    scale,
    sheet: { w: SHEET, h: SHEET },
    native: { w: native, h: native },
    gutter,
    slots,
    font: {
      id: 'pixel_font',
      file: manifest.font.file,
      cellW: manifest.font.cellW,
      cellH: manifest.font.cellH,
      glyphs: manifest.font.glyphs,
      rows: fontRows,
    },
  };
  return { layout, sheet, flat, guide };
}

export function writeTemplate(outDir = TEMPLATE_DIR, artDir = ART_DIR) {
  const { layout, sheet, flat, guide } = buildTemplate(artDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'hud-day-cycle-template-512.png'), encodePng(sheet));
  writeFileSync(join(outDir, 'hud-day-cycle-template-guide.png'), encodePng(guide));
  writeFileSync(join(outDir, 'hud-day-cycle-template-1x.png'), encodePng(flat));
  writeFileSync(join(outDir, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
  return layout;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const at = process.argv.indexOf('--out');
  const out = at > 0 ? resolve(process.argv[at + 1] ?? '') : TEMPLATE_DIR;
  const layout = writeTemplate(out);
  console.log(
    `template at ${layout.scale}x (${layout.native.w}x${layout.native.h} native) written to ${out}`,
  );
}
