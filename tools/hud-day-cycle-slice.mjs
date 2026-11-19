/**
 * Slices an edited day-cycle HUD template back into the game's sprite PNGs.
 *
 *   node tools/hud-day-cycle-slice.mjs <edited-sheet.png> [--out <dir>] [--layout <layout.json>] [--sheet main|biomes]
 *                                      [--alpha-min <0-255>] [--dry-run]
 *
 * The sheet can be the 512 template, the native 1x one, or the 512 sheet at a
 * whole multiple (1024, ...). The size picks the mode. For the big sheets each
 * art pixel is a block of scale x scale pixels; model output can sit slightly
 * off the grid, so every block becomes its most common colour (blocks that are
 * mostly clear become transparent, and alpha below --alpha-min counts as
 * clear). Frames of one slot are put back side by side, so the written files
 * match `manifest.json`. Default output is `public/assets/ui/hud-day-cycle/`.
 *
 * There are two sheets: `main` (the HUD sprites and the font) and `biomes` (the
 * terrain strips for the sky strip). A file with "biomes" in its name is sliced as
 * the biomes sheet; otherwise pass `--sheet biomes` or `--sheet main`. Each sheet
 * only writes its own slots, so slicing one never touches the other's PNGs.
 *
 * Only the cells listed in `layout.json` are read. The sample band at the top of
 * the sheet (`layout.preview`) and the space between cells are ignored, so
 * nothing drawn there reaches the game. The pixel font is rebuilt in the game's
 * own layout (one `cellW` slot per glyph, glyphs side by side, narrow glyphs
 * padded with clear pixels) from the spaced-out glyph cells.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createImage, decodePng, encodePng } from './ui-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART_DIR = join(root, 'public', 'assets', 'ui', 'hud-day-cycle');
const DEFAULT_LAYOUT = join(ART_DIR, 'template', 'layout.json');
const DEFAULT_ALPHA_MIN = 16;

/**
 * One art pixel from a block of the sheet: the most common colour, with clear
 * pixels (alpha below `alphaMin`) counted as one colour. Ties go to the
 * colour that appears first.
 * @param {ReturnType<typeof createImage>} img
 */
export function blockColor(img, x0, y0, size, alphaMin = DEFAULT_ALPHA_MIN) {
  /** @type {Map<number, {n: number, c: number[]}>} */
  const tally = new Map();
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const c = img.get(x, y);
      const clear = c[3] < alphaMin;
      const key = clear ? 0 : ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0 || 1;
      const hit = tally.get(key);
      if (hit) hit.n++;
      else tally.set(key, { n: 1, c: clear ? [0, 0, 0, 0] : [c[0], c[1], c[2], c[3]] });
    }
  }
  let best = null;
  for (const entry of tally.values()) if (!best || entry.n > best.n) best = entry;
  return best ? best.c : [0, 0, 0, 0];
}

/**
 * Copy a `w x h` native region out of the sheet into a new image.
 * `k` is how many sheet pixels one art pixel covers.
 */
function cutCell(sheet, rect512, k, scale, alphaMin, native) {
  const w = rect512.w / scale;
  const h = rect512.h / scale;
  const out = createImage(w, h);
  const block = native ? 1 : scale * k;
  const ox = native ? rect512.x / scale : rect512.x * k;
  const oy = native ? rect512.y / scale : rect512.y * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = native
        ? sheet.get(ox + x, oy + y)
        : blockColor(sheet, ox + x * block, oy + y * block, block, alphaMin);
      out.px(x, y, c[3] < alphaMin ? [0, 0, 0, 0] : c);
    }
  }
  return out;
}

/**
 * The layout of one sheet: `main` is the layout itself (slots and the font),
 * `biomes` is `layout.sheets.biomes` (the biome terrain strips).
 */
export function sheetLayout(layout, id = 'main') {
  if (id === 'main') return layout;
  const found = layout.sheets?.[id];
  if (!found)
    throw new Error(
      `layout has no sheet "${id}" (has: main${Object.keys(layout.sheets ?? {})
        .map((k) => `, ${k}`)
        .join('')})`,
    );
  return found;
}

/** Slice a decoded sheet into `{file, image}` pairs. `layout` is a sheet layout (see `sheetLayout`). */
export function sliceSheet(sheet, layout, { alphaMin = DEFAULT_ALPHA_MIN } = {}) {
  const native = sheet.w === layout.native.w && sheet.h === layout.native.h;
  let k = 1;
  if (!native) {
    if (sheet.w !== sheet.h || sheet.w % layout.sheet.w !== 0) {
      throw new Error(
        `sheet is ${sheet.w}x${sheet.h}: expected ${layout.native.w}x${layout.native.h} (1x) or ${layout.sheet.w}x${layout.sheet.h} (or a whole multiple of it)`,
      );
    }
    k = sheet.w / layout.sheet.w;
  }
  const scale = layout.scale;
  /** @type {Array<{file: string, image: ReturnType<typeof createImage>}>} */
  const out = [];
  for (const slot of layout.slots) {
    const frames = slot.cells.map((cell) => cutCell(sheet, cell.rect, k, scale, alphaMin, native));
    const image = createImage(slot.w * frames.length, slot.h);
    frames.forEach((frame, i) => {
      for (let y = 0; y < slot.h; y++)
        for (let x = 0; x < slot.w; x++) image.px(i * slot.w + x, y, frame.get(x, y));
    });
    out.push({ file: slot.file, image });
  }
  const font = layout.font;
  // The biomes sheet has no font.
  if (!font) return out;
  const fontImage = createImage(font.glyphs.length * font.cellW, font.cellH);
  // Version 2 layouts have one cell per glyph; version 1 had strips of glyphs side by side.
  if (font.cells) {
    for (const cell of font.cells) {
      const part = cutCell(sheet, cell.rect, k, scale, alphaMin, native);
      for (let y = 0; y < part.h; y++) {
        for (let x = 0; x < part.w; x++)
          fontImage.px(cell.index * font.cellW + x, y, part.get(x, y));
      }
    }
  } else {
    for (const row of font.rows) {
      const part = cutCell(sheet, row.rect, k, scale, alphaMin, native);
      for (let y = 0; y < part.h; y++) {
        for (let x = 0; x < part.w; x++)
          fontImage.px(row.glyphStart * font.cellW + x, y, part.get(x, y));
      }
    }
  }
  out.push({ file: font.file, image: fontImage });
  return out;
}

export function sliceFile(
  sheetPath,
  {
    outDir = ART_DIR,
    layoutPath = DEFAULT_LAYOUT,
    alphaMin = DEFAULT_ALPHA_MIN,
    dryRun = false,
    sheet: sheetId = /biomes/i.test(basename(sheetPath)) ? 'biomes' : 'main',
  } = {},
) {
  const layout = sheetLayout(JSON.parse(readFileSync(layoutPath, 'utf8')), sheetId);
  const sheet = decodePng(readFileSync(sheetPath));
  const files = sliceSheet(sheet, layout, { alphaMin });
  const manifestPath = join(outDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const known = new Set([
      ...Object.values(manifest.sprites).map((s) => s.file),
      manifest.font.file,
    ]);
    for (const { file } of files)
      if (!known.has(file)) console.warn(`warning: ${file} is not in manifest.json`);
  }
  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
    for (const { file, image } of files) writeFileSync(join(outDir, file), encodePng(image));
  }
  return files;
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
  };
  const sheetPath = args.find(
    (a, i) =>
      !a.startsWith('--') &&
      !['--out', '--layout', '--alpha-min', '--sheet'].includes(args[i - 1] ?? ''),
  );
  if (!sheetPath) {
    console.error(
      'usage: node tools/hud-day-cycle-slice.mjs <edited-sheet.png> [--out dir] [--layout layout.json] [--alpha-min 16] [--sheet main|biomes] [--dry-run]',
    );
    process.exit(1);
  }
  try {
    const files = sliceFile(resolve(sheetPath), {
      outDir: opt('--out') ? resolve(opt('--out')) : ART_DIR,
      layoutPath: opt('--layout') ? resolve(opt('--layout')) : DEFAULT_LAYOUT,
      alphaMin: opt('--alpha-min') ? Number(opt('--alpha-min')) : DEFAULT_ALPHA_MIN,
      dryRun: args.includes('--dry-run'),
      ...(opt('--sheet') ? { sheet: opt('--sheet') } : {}),
    });
    console.log(`${args.includes('--dry-run') ? 'would write' : 'wrote'} ${files.length} files`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
