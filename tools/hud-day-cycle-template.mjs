/**
 * Builds the art template for the day-cycle HUD: every sprite slot laid out as
 * its own cell on a 512x512 transparent sheet at one whole-number upscale,
 * with generous gutters, plus a guide with outlines and names, a native-size
 * (1x) sheet, and `layout.json` (cell rectangles in both coordinate systems).
 *
 * The top of every sheet carries a reference-only sample of the assembled HUD,
 * drawn by the game's own renderer (see `hud-day-cycle-preview.mjs`). The
 * slicer ignores it. Every pixel-font glyph has its own cell, with a fixed
 * gap between glyphs, so the font is easy to edit.
 *
 * The biome terrain masks (bases, details) go on a second sheet, `biomes`, with
 * its own previews: the sky strip at sunrise for several biomes, rendered by the
 * game's renderer. Same scale as the main sheet, same rules, also sliced by
 * `hud-day-cycle-slice.mjs`.
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
import { renderBiomePreview, renderPreview } from './hud-day-cycle-preview.mjs';
import { createImage, decodePng, encodePng } from './ui-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ART_DIR = join(root, 'public', 'assets', 'ui', 'hud-day-cycle');
export const TEMPLATE_DIR = join(ART_DIR, 'template');
export const SHEET = 512;
const MIN_GUTTER_PX = 8;
const LABEL_SCALE = 1;

/** Transparent native pixels between neighbouring font cells (cells sit on a pitch of cellW + this). */
export const FONT_GAP = 4;
/** Scales tried, biggest first. 512 / 4 is a whole 128 grid; 5 would leave a 2 px sliver. */
const SCALES = [5, 4, 3, 2];

/** Files of each sheet, in the template folder. */
export const SHEET_FILES = {
  main: {
    sheet: 'hud-day-cycle-template-512.png',
    guide: 'hud-day-cycle-template-guide.png',
    flat: 'hud-day-cycle-template-1x.png',
  },
  biomes: {
    sheet: 'hud-day-cycle-template-biomes-512.png',
    guide: 'hud-day-cycle-template-biomes-guide.png',
    flat: 'hud-day-cycle-template-biomes-1x.png',
  },
};

/** The biome previews on the biomes sheet: a biome name or recipe id, and its label. */
export const BIOME_PREVIEWS = [
  ['Forest', 'FOREST'],
  ['Mountain', 'MOUNTAINS'],
  ['Snow', 'SNOWY MOUNTAINS'],
  ['Sand', 'COAST'],
  ['Desert', 'DESERT'],
  ['Plains', 'PLAINS'],
  ['Taiga', 'TAIGA'],
  ['Marsh', 'MARSH'],
];

/** @param {ReturnType<typeof createImage>} img @param {number} x @param {number} y @param {number} w @param {number} h */
function crop(img, x, y, w, h) {
  const out = createImage(w, h);
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) out.px(xx, yy, img.get(x + xx, y + yy));
  return out;
}

/** Transparent native pixels between cells at a scale. */
export const gutterFor = (scale) => Math.max(2, Math.ceil(MIN_GUTTER_PX / scale));

/** Plan every cell, native size and label, before any position is known. Font glyphs belong to the main sheet. */
export function planCells(manifest, art, sheetId = 'main') {
  /** @type {Array<{slot: string, state: string, w: number, h: number, img: any, label: string}>} */
  const cells = [];
  for (const [id, def] of Object.entries(manifest.sprites)) {
    if ((def.sheet ?? 'main') !== sheetId) continue;
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
  // One cell per glyph, as wide as the glyph's advance in the game (`:` `.` are 1 px). A space is blank: no cell.
  const font = manifest.font;
  const fontImg = art.get(font.file);
  const glyphs = [];
  if (sheetId === 'main') {
    [...font.glyphs].forEach((ch, index) => {
      if (ch === ' ') return;
      const w = Math.min(font.widths[ch] ?? font.cellW, font.cellW);
      glyphs.push({ ch, index, w, img: crop(fontImg, index * font.cellW, 0, w, font.cellH) });
    });
  }
  return { cells, glyphs };
}

function labelWidthPx(label, font) {
  let w = 0;
  for (const ch of label) w += ((font.widths[ch] ?? font.cellW) + font.spacing) * LABEL_SCALE;
  return w - font.spacing * LABEL_SCALE;
}

/**
 * Pack the preview band (top), then every cell with its label, shelf by shelf.
 * `previews` are `{img, label}`: one is centred, several go in a grid, each
 * with a label row. Font glyphs are grouped into rows of `perRow` cells on a
 * fixed pitch; a row is one footprint. Returns null if it does not fit on the
 * sheet at `scale`.
 */
export function pack(plan, scale, font, previews) {
  const { cells, glyphs } = plan;
  const native = Math.floor(SHEET / scale);
  const gutter = gutterFor(scale);
  const labelRows = Math.ceil((5 * LABEL_SCALE + 3) / scale);
  const pw = Math.max(...previews.map((p) => p.img.w));
  if (pw > native) return null;
  const pitch = font.cellW + FONT_GAP;
  /** @type {Array<any>} */
  const items = cells.map((cell) => ({
    cell,
    fw: Math.max(cell.w, Math.ceil(labelWidthPx(cell.label, font) / scale)),
    fh: cell.h + labelRows,
  }));
  if (glyphs.length) {
    const perRowMax = Math.max(1, Math.floor((native - 2 * gutter + FONT_GAP) / pitch));
    const rowCount = Math.ceil(glyphs.length / perRowMax);
    const perRow = Math.ceil(glyphs.length / rowCount);
    for (let start = 0; start < glyphs.length; start += perRow) {
      const row = glyphs.slice(start, start + perRow);
      items.push({ fontRow: row, fw: row.length * pitch - FONT_GAP, fh: font.cellH + labelRows });
    }
  }
  items.sort((a, b) => b.fh - a.fh || b.fw - a.fw);

  // Preview band: a grid of equal columns, centred as a block.
  const columns = Math.max(1, Math.floor((native + gutter) / (pw + gutter)));
  const used = Math.min(columns, previews.length);
  const bandX = Math.floor((native - (used * pw + (used - 1) * gutter)) / 2);
  let by = 1;
  let rowTop = by;
  let rowMaxH = 0;
  const placed = previews.map((p, i) => {
    const col = i % columns;
    if (i > 0 && col === 0) {
      rowTop += rowMaxH + labelRows + gutter;
      rowMaxH = 0;
    }
    rowMaxH = Math.max(rowMaxH, p.img.h);
    return { ...p, x: bandX + col * (pw + gutter), y: rowTop, w: p.img.w, h: p.img.h };
  });
  const bandBottom = rowTop + rowMaxH + labelRows;

  const maxX = native - gutter;
  let x = gutter;
  let y = bandBottom + gutter;
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
  if (items.length && y + rowH > native - gutter) return null;
  return { items, native, gutter, previews: placed, labelRows, pitch };
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

/**
 * Build one sheet (512, 1x, guide) and its layout. `getPreviews(maxW)` makes the
 * preview images for a given maximum width; scales are tried from `maxScale` down.
 */
async function buildSheet({ id, manifest, art, getPreviews, maxScale, previewNote }) {
  const font = manifest.font;
  const plan = planCells(manifest, art, id);
  let previews = null;
  let chosen = null;
  for (const scale of SCALES.filter((s) => s <= maxScale)) {
    previews = await getPreviews(Math.floor(SHEET / scale), scale);
    const packed = pack(plan, scale, font, previews);
    if (packed) {
      chosen = { scale, ...packed };
      break;
    }
  }
  if (!chosen || !previews) throw new Error(`the ${id} sheet does not fit on a 512 sheet at 2x`);
  const { scale, items, native, gutter, pitch, previews: placed } = chosen;
  const sheet = createImage(SHEET, SHEET);
  const flat = createImage(native, native);
  const guide = createImage(SHEET, SHEET);
  for (let i = 0; i < guide.data.length; i += 4) {
    guide.data[i] = 44;
    guide.data[i + 1] = 49;
    guide.data[i + 2] = 60;
    guide.data[i + 3] = 255;
  }
  const fontImg = art.get(font.file);

  // Reference-only previews, in all three images.
  for (const p of placed) {
    stamp(sheet, p.img, p.x * scale, p.y * scale, scale);
    stamp(guide, p.img, p.x * scale, p.y * scale, scale);
    stamp(flat, p.img, p.x, p.y, 1);
  }

  const slotCells = new Map();
  const fontCells = [];
  for (const item of items) {
    const place = (img, w, h, dx = 0) => {
      const ox = (item.x + dx) * scale;
      const oy = item.y * scale;
      stamp(sheet, img, ox, oy, scale);
      stamp(guide, img, ox, oy, scale);
      stamp(flat, img, item.x + dx, item.y, 1);
      return {
        rect: { x: ox, y: oy, w: w * scale, h: h * scale },
        rect1x: { x: item.x + dx, y: item.y, w, h },
      };
    };
    if (item.fontRow) {
      item.fontRow.forEach((g, i) => {
        const rects = place(g.img, g.w, font.cellH, i * pitch);
        fontCells.push({ glyph: g.ch, index: g.index, ...rects });
      });
    } else {
      const { cell } = item;
      const rects = place(cell.img, cell.w, cell.h);
      if (!slotCells.has(cell.slot)) slotCells.set(cell.slot, []);
      slotCells.get(cell.slot).push({ state: cell.state, ...rects });
    }
  }

  // Guide: cell outlines, 9-slice lines, anchors, names.
  const line = [255, 80, 200, 255];
  const sliceColor = [80, 230, 255, 255];
  const anchorColor = [255, 230, 60, 255];
  const white = [245, 245, 250, 255];
  const previewColor = [255, 160, 40, 255];
  for (const item of items) {
    if (item.fontRow) continue;
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
    drawText(guide, font, fontImg, cell.label, ox, oy + cell.h * scale + 3, white);
  }
  // Font: every glyph cell outlined, its character under it.
  for (const g of fontCells) {
    const { x, y, w, h } = g.rect;
    rect(guide, x - 1, y - 1, w + 2, h + 2, line);
    drawText(guide, font, fontImg, g.glyph, x, y + h + 3, [190, 200, 220, 255]);
  }
  // Previews: dashed orange frame and a label, so they are not mistaken for cells.
  for (const p of placed) {
    const px = p.x * scale;
    const py = p.y * scale;
    const pw = p.w * scale;
    const ph = p.h * scale;
    for (let i = -2; i < pw + 2; i++) {
      if (i % 8 < 5) {
        guide.px(px + i, py - 2, previewColor);
        guide.px(px + i, py + ph + 1, previewColor);
      }
    }
    for (let i = -2; i < ph + 2; i++) {
      if (i % 8 < 5) {
        guide.px(px - 2, py + i, previewColor);
        guide.px(px + pw + 1, py + i, previewColor);
      }
    }
    drawText(guide, font, fontImg, p.label, px, py + ph + 6, previewColor);
  }

  const slots = Object.entries(manifest.sprites)
    .filter(([, def]) => (def.sheet ?? 'main') === id)
    .map(([slotId, def]) => ({
      id: slotId,
      file: def.file,
      w: def.w,
      h: def.h,
      anchor: def.anchor,
      ...(def.slice ? { slice: def.slice } : {}),
      states: def.states,
      // Frames go back into the PNG in state order, whatever order the packer placed them in.
      cells: def.states.map((state) => slotCells.get(slotId).find((c) => c.state === state)),
    }));
  fontCells.sort((a, b) => a.index - b.index);
  const files = SHEET_FILES[id];
  const toRects = (p) => ({
    label: p.label,
    ...(p.biome ? { biome: p.biome, tuRemaining: p.tuRemaining } : {}),
    rect: { x: p.x * scale, y: p.y * scale, w: p.w * scale, h: p.h * scale },
    rect1x: { x: p.x, y: p.y, w: p.w, h: p.h },
  });
  const layout = {
    files,
    scale,
    sheet: { w: SHEET, h: SHEET },
    native: { w: native, h: native },
    gutter,
    previews: placed.map(toRects),
    previewNote,
    slots,
    ...(fontCells.length
      ? {
          font: {
            id: 'pixel_font',
            file: font.file,
            cellW: font.cellW,
            cellH: font.cellH,
            glyphs: font.glyphs,
            widths: font.widths,
            pitch,
            gap: FONT_GAP,
            note: 'One cell per glyph, as wide as the glyph advances in the game (`:` and `.` are 1 px). Space has no cell: it is blank. Cells sit on a fixed pitch (`cellW + gap`) with `gap` transparent native pixels between neighbours.',
            cells: fontCells,
          },
        }
      : {}),
  };
  return { layout, sheet, flat, guide };
}

export async function buildTemplate(artDir = ART_DIR) {
  const manifest = JSON.parse(readFileSync(join(artDir, 'manifest.json'), 'utf8'));
  /** @type {Map<string, any>} */
  const art = new Map();
  for (const def of Object.values(manifest.sprites))
    art.set(def.file, decodePng(readFileSync(join(artDir, def.file))));
  art.set(manifest.font.file, decodePng(readFileSync(join(artDir, manifest.font.file))));

  // Main sheet: the HUD sample (the right-hand end of the HUD), as wide as the sheet allows.
  let sample = null;
  const main = await buildSheet({
    id: 'main',
    manifest,
    art,
    maxScale: Math.max(...SCALES),
    previewNote:
      'The right-hand end of the HUD as the game draws it (84 TU left), at the sheet scale. Reference only: the slicer ignores it.',
    getPreviews: async (maxW) => {
      sample = await renderPreview(artDir, undefined, maxW);
      return [
        {
          img: sample.image,
          label: 'PREVIEW ONLY - THE HUD PUT TOGETHER, NOT SLICED',
          tuRemaining: sample.tuRemaining,
        },
      ];
    },
  });
  // Biomes sheet: same scale as the main sheet; previews of the sky strip at sunrise.
  const biomes = await buildSheet({
    id: 'biomes',
    manifest,
    art,
    maxScale: main.layout.scale,
    previewNote:
      'The sky strip at sunrise (95 TU left in summer) for each biome, drawn by the game from the recipes in src/ui/day-cycle/biome-recipes.ts and the strips on this sheet. Reference only: the slicer ignores them.',
    getPreviews: async (maxW, scale) => {
      const gutter = gutterFor(scale);
      const pw = Math.floor((maxW - gutter) / 2) - 2;
      const out = [];
      for (const [biome, label] of BIOME_PREVIEWS) {
        const p = await renderBiomePreview(artDir, biome, pw);
        out.push({
          img: p.image,
          label: `${label} - SUNRISE`,
          biome,
          tuRemaining: p.tuRemaining,
        });
      }
      return out;
    },
  });

  const { previewNote, ...mainRest } = main.layout;
  const { previews } = main.layout;
  const layout = {
    version: 3,
    note: 'Cell rectangles: `rect` is in 512 sheet pixels, `rect1x` in native pixels. Each cell is `w x h` native pixels shown at `scale`. The top-level fields describe the main sheet; `sheets.biomes` the biome terrain sheet. `preview`/`previews` are reference only and are never sliced.',
    ...mainRest,
    preview: {
      note: previewNote,
      tuRemaining: sample?.tuRemaining,
      sourceCrop: sample?.crop,
      rect: previews[0].rect,
      rect1x: previews[0].rect1x,
    },
    sheets: { biomes: biomes.layout },
  };
  return { layout, main, biomes };
}

export async function writeTemplate(outDir = TEMPLATE_DIR, artDir = ART_DIR) {
  const { layout, main, biomes } = await buildTemplate(artDir);
  mkdirSync(outDir, { recursive: true });
  for (const [id, built] of [
    ['main', main],
    ['biomes', biomes],
  ]) {
    const files = SHEET_FILES[id];
    writeFileSync(join(outDir, files.sheet), encodePng(built.sheet));
    writeFileSync(join(outDir, files.guide), encodePng(built.guide));
    writeFileSync(join(outDir, files.flat), encodePng(built.flat));
  }
  writeFileSync(join(outDir, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
  return layout;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const at = process.argv.indexOf('--out');
  const out = at > 0 ? resolve(process.argv[at + 1] ?? '') : TEMPLATE_DIR;
  const layout = await writeTemplate(out);
  const b = layout.sheets.biomes;
  console.log(
    `main sheet at ${layout.scale}x (${layout.native.w}x${layout.native.h} native), biomes sheet at ${b.scale}x (${b.native.w}x${b.native.h}) written to ${out}`,
  );
}
