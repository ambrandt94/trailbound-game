/**
 * Renders the day-cycle HUD to a plain RGBA image in Node, for the art
 * template's "sample" band.
 *
 * It runs the game's own renderer (`src/ui/day-cycle/render.ts`), bundled on
 * the fly, against a small software 2D context (`MiniContext`) and the PNGs in
 * `public/assets/ui/hud-day-cycle/`. So the sample is drawn by the same code
 * and the same math (bead positions, phase colours, sky, pill text) as the game,
 * not by a copy of it. The context only implements what the renderer calls:
 * nearest-neighbour `drawImage`, `fillRect`, `clearRect`, a rectangular clip,
 * `globalAlpha`, `source-in` for font tinting and `get/putImageData`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createImage, decodePng } from './ui-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ART_DIR = join(root, 'public', 'assets', 'ui', 'hud-day-cycle');

/** A sample moment: 84 TU left. Day, the sun is up, beads lit and drained, medallions on both sides. */
export const SAMPLE_FRAME = {
  tuRemaining: 84,
  day: 1,
  season: 'summer',
  fogUnits: 0,
  timeMs: 0,
  reducedMotion: true,
};

function parseColor(value) {
  const v = String(value).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  throw new Error(`preview: unsupported colour ${value}`);
}

/** Backing store shared by images and canvases: straight (non-premultiplied) RGBA. */
class Surface {
  constructor(width, height, data) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8ClampedArray(width * height * 4);
  }

  getContext() {
    return new MiniContext(this);
  }
}

class MiniContext {
  imageSmoothingEnabled = false;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  fillStyle = '#000';
  constructor(surface) {
    this.surface = surface;
    this.clipRect = null;
    this.path = null;
    this.stack = [];
  }

  save() {
    this.stack.push({
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      fillStyle: this.fillStyle,
      clipRect: this.clipRect,
    });
  }

  restore() {
    Object.assign(this, this.stack.pop());
  }

  beginPath() {
    this.path = null;
  }

  rect(x, y, w, h) {
    this.path = { x, y, w, h };
  }

  clip() {
    if (this.path) this.clipRect = this.path;
  }

  inClip(x, y) {
    const c = this.clipRect;
    return !c || (x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h);
  }

  /** Blend one source pixel (straight RGBA, alpha 0-255) onto the surface. */
  put(x, y, r, g, b, a) {
    const s = this.surface;
    if (x < 0 || y < 0 || x >= s.width || y >= s.height || !this.inClip(x, y)) return;
    const i = (y * s.width + x) * 4;
    const d = s.data;
    if (this.globalCompositeOperation === 'source-in') {
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = Math.round((d[i + 3] * a) / 255);
      return;
    }
    const sa = (a / 255) * this.globalAlpha;
    if (sa <= 0) return;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    d[i] = Math.round((r * sa + d[i] * da * (1 - sa)) / oa);
    d[i + 1] = Math.round((g * sa + d[i + 1] * da * (1 - sa)) / oa);
    d[i + 2] = Math.round((b * sa + d[i + 2] * da * (1 - sa)) / oa);
    d[i + 3] = Math.round(oa * 255);
  }

  fillRect(x, y, w, h) {
    const [r, g, b] = parseColor(this.fillStyle);
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) {
        if (this.globalCompositeOperation === 'source-in') {
          // Colour whatever is already drawn, keep its alpha.
          const s = this.surface;
          if (xx < 0 || yy < 0 || xx >= s.width || yy >= s.height || !this.inClip(xx, yy)) continue;
          const i = (yy * s.width + xx) * 4;
          s.data[i] = r;
          s.data[i + 1] = g;
          s.data[i + 2] = b;
        } else this.put(xx, yy, r, g, b, 255);
      }
  }

  clearRect(x, y, w, h) {
    const s = this.surface;
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || yy < 0 || xx >= s.width || yy >= s.height) continue;
        s.data.fill(0, (yy * s.width + xx) * 4, (yy * s.width + xx) * 4 + 4);
      }
  }

  drawImage(img, ...a) {
    let sx = 0;
    let sy = 0;
    let sw = img.width;
    let sh = img.height;
    let dx;
    let dy;
    let dw;
    let dh;
    if (a.length === 2) [dx, dy] = a;
    else if (a.length === 4) [dx, dy, dw, dh] = a;
    else [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    dw ??= sw;
    dh ??= sh;
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const px = sx + Math.floor(((x + 0.5) * sw) / dw);
        const py = sy + Math.floor(((y + 0.5) * sh) / dh);
        const i = (py * img.width + px) * 4;
        const alpha = img.data[i + 3];
        if (alpha === 0) continue;
        this.put(dx + x, dy + y, img.data[i], img.data[i + 1], img.data[i + 2], alpha);
      }
    }
  }

  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        const i = ((y + yy) * this.surface.width + x + xx) * 4;
        out.set(this.surface.data.subarray(i, i + 4), (yy * w + xx) * 4);
      }
    return { width: w, height: h, data: out };
  }

  putImageData(img, x, y) {
    for (let yy = 0; yy < img.height; yy++)
      for (let xx = 0; xx < img.width; xx++) {
        const i = ((y + yy) * this.surface.width + x + xx) * 4;
        this.surface.data.set(
          img.data.subarray((yy * img.width + xx) * 4, (yy * img.width + xx) * 4 + 4),
          i,
        );
      }
  }
}
function toSurface(png) {
  return new Surface(png.w, png.h, new Uint8ClampedArray(png.data));
}

/** Bundle the game's renderer and the day-cycle maths into one temp ES module and load it. */
let gameModules = null;
function loadGameModules() {
  gameModules ??= bundleGameModules();
  return gameModules;
}

async function bundleGameModules() {
  const { rolldown } = await import('rolldown');
  const dir = mkdtempSync(join(tmpdir(), 'hud-preview-'));
  try {
    const src = (p) => JSON.stringify(join(root, 'src', p).replace(/\\/g, '/'));
    const entry = join(dir, 'entry.ts');
    writeFileSync(
      entry,
      [
        `export { DayCycleRenderer } from ${src('ui/day-cycle/render.ts')};`,
        `export { HUD_NATIVE_H, HUD_NATIVE_W, NODE_LAYOUT, SKY_RECT } from ${src('ui/day-cycle/layout.ts')};`,
        `export { parseManifest } from ${src('ui/day-cycle/manifest.ts')};`,
        `export { bakeNodes } from ${src('core/sim/day-cycle.ts')};`,
      ].join('\n'),
    );
    const bundle = await rolldown({ input: entry, logLevel: 'silent' });
    const { output } = await bundle.generate({ format: 'esm' });
    const file = join(dir, 'game.mjs');
    writeFileSync(file, output[0].code);
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Draw the HUD at native size with the game's renderer.
 * Returns `{ image, nodes, layout }`: a `ui-png` image (361 x 66 at the time of
 * writing) plus the bead positions the game computed.
 */
export async function renderHud(artDir = ART_DIR, frame = SAMPLE_FRAME) {
  const game = await loadGameModules();
  globalThis.document = { createElement: () => new Surface(1, 1) };
  // The renderer makes canvases as `canvas.width = ..; canvas.height = ..`, so size on assignment.
  globalThis.document.createElement = () => {
    const s = new Surface(0, 0);
    let w = 0;
    let h = 0;
    const realloc = () => {
      s.data = new Uint8ClampedArray(w * h * 4);
    };
    Object.defineProperty(s, 'width', {
      get: () => w,
      set: (v) => {
        w = v;
        realloc();
      },
    });
    Object.defineProperty(s, 'height', {
      get: () => h,
      set: (v) => {
        h = v;
        realloc();
      },
    });
    return s;
  };
  try {
    const manifest = game.parseManifest(
      JSON.parse(readFileSync(join(artDir, 'manifest.json'), 'utf8')),
    );
    const sprites = {};
    for (const [id, def] of Object.entries(manifest.sprites))
      sprites[id] = { id, def, image: toSurface(decodePng(readFileSync(join(artDir, def.file)))) };
    const art = {
      manifest,
      sprites,
      font: {
        def: manifest.font,
        image: toSurface(decodePng(readFileSync(join(artDir, manifest.font.file)))),
      },
    };
    const canvas = new Surface(game.HUD_NATIVE_W, game.HUD_NATIVE_H);
    new game.DayCycleRenderer(art).draw(canvas.getContext(), frame);
    const image = createImage(canvas.width, canvas.height);
    image.data.set(canvas.data);
    return {
      image,
      nodes: game.bakeNodes(game.NODE_LAYOUT, 1),
      layout: { w: game.HUD_NATIVE_W, h: game.HUD_NATIVE_H, sky: game.SKY_RECT },
    };
  } finally {
    delete globalThis.document;
  }
}

/** The sample band: the right-hand end of the HUD, trimmed to what is drawn. */
export async function renderPreview(artDir = ART_DIR, frame = SAMPLE_FRAME, maxW = 128) {
  const { image, nodes } = await renderHud(artDir, frame);
  // End on the dawn end-cap (13 px wide, 4 px outside the last bead); start as far left as fits.
  const last = nodes[nodes.length - 1];
  const right = Math.min(image.w, Math.round(last.x + 4) + 7);
  const left = Math.max(0, right - maxW);
  let top = image.h;
  let bottom = 0;
  for (let y = 0; y < image.h; y++)
    for (let x = left; x < right; x++)
      if (image.get(x, y)[3] > 0) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + 1);
      }
  const out = createImage(right - left, bottom - top);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) out.px(x, y, image.get(left + x, top + y));
  return { image: out, tuRemaining: frame.tuRemaining, crop: { left, top, right, bottom } };
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  // node tools/hud-day-cycle-preview.mjs [out-dir]: writes hud-full.png and hud-sample.png (native size).
  const { encodePng } = await import('./ui-png.mjs');
  const out = process.argv[2] ?? '.';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'hud-full.png'), encodePng((await renderHud()).image));
  const { image } = await renderPreview();
  writeFileSync(join(out, 'hud-sample.png'), encodePng(image));
  console.log(`wrote hud-full.png and hud-sample.png (${image.w}x${image.h}) to ${out}`);
}
