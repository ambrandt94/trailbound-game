/**
 * Placeholder pixel art for the 100-TU serpentine day-cycle HUD.
 *
 * `node tools/hud-day-cycle-sprites.mjs` redraws every PNG in
 * `public/assets/ui/hud-day-cycle/`. It writes `manifest.json` only when that
 * file is missing or `--manifest` is passed, so hand edits to the manifest
 * survive. To swap in real art, drop new PNGs over the placeholders (keeping
 * the sizes in the manifest, or editing the manifest) and do not rerun this.
 *
 * Tint rule the renderer applies to every sprite marked "tint": neutral gray
 * pixels (R = G = B) are multiplied by the phase colour, pure white
 * (#ffffff) is a specular pixel that stays near white, every other pixel is
 * drawn as-is. Draw frames in colour and the tintable bits in gray.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BIOME_SLOTS } from './hud-day-cycle-biome-art.mjs';
import { createImage, encodePng } from './ui-png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(root, 'public', 'assets', 'ui', 'hud-day-cycle');

/** @param {string} hex @param {number} [a] */
function rgba(hex, a = 255) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

const PAL = {
  '.': null,
  O: rgba('#1c1610'), // frame outline (warm dark, not black)
  d: rgba('#6e4e24'), // frame dark
  m: rgba('#b58938'), // frame mid
  l: rgba('#f3cf7a'), // frame light
  w: rgba('#0c0e16'), // well
  s: rgba('#3b4568'), // empty socket (slate, not black)
  S: rgba('#2e3858'), // empty socket, shaded
  q: rgba('#54425e'), // empty socket outline (plum, not black)
  W: rgba('#ffffff'), // specular
  G: rgba('#f4f4f4'), // tint body
  g: rgba('#c8c8c8'), // tint shade
  a: rgba('#dcdcdc'), // tint mid
  c: rgba('#fb923c'), // dawn coral
  y: rgba('#fde047'), // gold
  f: rgba('#fef9c3'), // pale sun
  o: rgba('#f97316'), // orange
  v: rgba('#7c3aed'), // violet
  p: rgba('#312e81'), // pre-dawn indigo
  n: rgba('#090d1f'), // moon well
  N: rgba('#161c40'), // moon well, lower
  b: rgba('#93c5fd'), // moon blue
  B: rgba('#dbeafe'), // moon pale
  i: rgba('#1e1b4b'), // dawn well
  e: rgba('#e0f2fe'), // sky moon pale
  E: rgba('#a5c4e0'), // sky moon shade
  u: rgba('#7ea0c8'), // sky moon darker edge
  k: rgba('#14111f'), // pill ink
};

/** @param {readonly string[]} rows @param {Record<string, number[] | null>} [extra] */
function grid(rows, extra = {}) {
  const w = rows[0].length;
  const img = createImage(w, rows.length);
  const pal = { ...PAL, ...extra };
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`ragged row ${y}: ${row}`);
    [...row].forEach((ch, x) => {
      if (!(ch in pal)) throw new Error(`no colour for '${ch}'`);
      const c = pal[ch];
      if (c) img.px(x, y, c);
    });
  });
  return img;
}

/** @param {ReturnType<typeof createImage>[]} frames */
function sheet(frames) {
  const w = frames[0].w;
  const h = frames[0].h;
  const out = createImage(w * frames.length, h);
  frames.forEach((f, i) => {
    if (f.w !== w || f.h !== h) throw new Error('frame size mismatch');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.px(i * w + x, y, f.get(x, y));
  });
  return out;
}

/** Dim a lit sprite toward a cold desaturated brown so it reads as "spent". */
function drained(src) {
  const out = createImage(src.w, src.h);
  const tone = [64, 58, 70];
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const [r, g, b, a] = src.get(x, y);
      if (a === 0) continue;
      const lum = r * 0.3 + g * 0.5 + b * 0.2;
      const k = 0.5;
      out.px(x, y, [
        Math.round(lum * 0.42 * (1 - k) + tone[0] * k * 0.9),
        Math.round(lum * 0.4 * (1 - k) + tone[1] * k * 0.9),
        Math.round(lum * 0.45 * (1 - k) + tone[2] * k * 0.95),
        a,
      ]);
    }
  }
  return out;
}

/** A framed medallion: outline, bevelled ring, then a well painted by `inner`. */
function medallion(size, ring, ringLight, wellRows) {
  const img = createImage(size, size);
  const px = (x, y, c) => img.px(x, y, c);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const corner = (x === 0 || x === size - 1) && (y === 0 || y === size - 1);
      const ringEdge = x === 1 || y === 1 || x === size - 2 || y === size - 2;
      if (corner) continue;
      if (edge) px(x, y, PAL.O);
      else if (ringEdge) {
        const light = (x === 1 || y === 1) && !(x === size - 2 || y === size - 2);
        px(x, y, light ? ringLight : ring);
      }
    }
  }
  const inset = 2;
  const n = size - inset * 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ch = wellRows[y][x];
      px(inset + x, inset + y, PAL[ch] ?? PAL.w);
    }
  }
  return img;
}

// ------------------------------------------------------------------ nodes

const nodeSocketEmpty = grid(['.qqq.', 'qSssq', 'qsssq', 'qsssq', '.qqq.']);

const nodeGemLit = grid(['.....', '.WGa.', '.GGg.', '.agg.', '.....']);

const pulseRing = (alpha, spark) => {
  const img = createImage(7, 7);
  const gold = rgba('#fde047', alpha);
  for (let i = 1; i < 6; i++) {
    img.px(i, 0, gold);
    img.px(i, 6, gold);
    img.px(0, i, gold);
    img.px(6, i, gold);
  }
  if (spark) {
    const white = rgba('#ffffff', 235);
    for (const [x, y] of [
      [0, 0],
      [6, 0],
      [0, 6],
      [6, 6],
    ])
      img.px(x, y, white);
  }
  return img;
};
const nodeLeadingPulse = sheet([
  pulseRing(235, false),
  pulseRing(255, true),
  pulseRing(150, false),
]);

const spineLink = grid(['.OOO.', 'OdddO', 'OdmdO', 'OdddO', '.OOO.']);

const fogShroud = (() => {
  const img = createImage(7, 7);
  const rows = ['..xXx..', '.xXXXx.', 'xXXXXXx', 'XXXXXXX', 'xXXXXXx', '.xXXXx.', '..xXx..'];
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === 'X') img.px(x, y, rgba('#1a1438', 200));
      if (ch === 'x') img.px(x, y, rgba('#1a1438', (x + y) % 2 ? 120 : 70));
    }),
  );
  return img;
})();

// ----------------------------------------------------------- end caps etc.

const moonRows = [
  'nnnnnnnnn',
  'nnnbBnnnn',
  'nnbBnnnyn',
  'nbBnnnnnn',
  'nbbnnnnnn',
  'nbBnnnnnn',
  'nnbbnnnnn',
  'nnnbbBnnn',
  'NNNNNNNNN',
];
const anchorLeftMoon = medallion(13, PAL.m, PAL.l, moonRows);

const dawnRows = [
  'iiiiiiiii',
  'iiiiiiiii',
  'iiiiffiii',
  'iiiyyyyii',
  'iiyyyyyyi',
  'ccccccccc',
  'cccccccoc',
  'ppppppppp',
  'ppppppppp',
];
const anchorRightDawn = medallion(13, PAL.m, PAL.l, dawnRows);

const sunsetRows = ['vvvvvvv', 'vvoooov', 'ooooooo', 'ooyyyoo', 'oyyyyyo', 'vvvvvvv', 'vvvvvvv'];
const sunsetLit = medallion(11, rgba('#fb923c'), rgba('#fdba74'), sunsetRows);
const medallionSunset = sheet([sunsetLit, drained(sunsetLit)]);

const sunriseRows = ['iiiii', 'iifii', 'iyyyi', 'ccccc', 'ppppp'];
const sunriseLit = medallion(9, rgba('#fde047'), rgba('#fef08a'), sunriseRows);
const medallionSunrise = sheet([sunriseLit, drained(sunriseLit)]);

const subRows = ['wwwww', 'wWGaw', 'wGGgw', 'waggw', 'wwwww'];
const subLit = medallion(9, PAL.m, PAL.l, subRows);
const subDrained = medallion(9, PAL.d, PAL.d, ['wwwww', 'wwwww', 'wwwww', 'wwwww', 'wwwww']);
const subNode = sheet([subLit, subDrained]);

// -------------------------------------------------------------------- sky

const skySun = grid(['...c...', '..ggg..', '.gWWWg.', 'cgWWWgc', '.gWWWg.', '..ggg..', '...c...'], {
  g: rgba('#fde047'),
  W: rgba('#ffffff'),
  c: rgba('#fb923c'),
});

const skyMoon = grid(['..eee..', '.eEe...', 'eEu....', 'eEu....', 'eEu....', '.eEu...', '..eEu..']);

const skyFrame = grid([
  '.OOOOOO.',
  'OllllllO',
  'Om....mO',
  'Om....mO',
  'Om....mO',
  'Om....mO',
  'OmmmmmmO',
  '.OOOOOO.',
]);

const terrain = (() => {
  const heights = [
    [5, 6, 7, 7, 8, 7, 6, 6, 5, 5, 6, 5],
    [5, 5, 6, 6, 6, 7, 7, 6, 5, 5, 5, 5],
    [6, 7, 8, 8, 7, 6, 5, 5, 6, 7, 6, 5],
  ].flat();
  const img = createImage(heights.length, 8);
  heights.forEach((h, x) => {
    for (let y = 8 - h; y < 8; y++) img.px(x, y, [250, 250, 250, 255]);
  });
  return img;
})();

// ---------------------------------------------------------- tooltip pill

function pill(border, fill) {
  const img = createImage(9, 9);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 9; x++) {
      const corner = (x === 0 || x === 8) && (y === 0 || y === 8);
      if (corner) continue;
      const edge = x === 0 || y === 0 || x === 8 || y === 8;
      img.px(x, y, edge ? border : fill);
    }
  }
  return img;
}
const pillDay = pill(rgba('#eab308'), PAL.k);
const pillNight = pill(rgba('#8b5cf6'), PAL.k);

function stem(color) {
  const img = createImage(1, 6);
  for (let y = 0; y < 6; y++) img.px(0, y, color);
  return img;
}

// ------------------------------------------------------------------- font

const GLYPHS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  ':': ['0', '1', '0', '1', '0'],
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '101', '101', '101'],
  N: ['110', '101', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '111', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  '-': ['000', '000', '111', '000', '000'],
  '.': ['0', '0', '0', '0', '1'],
  '/': ['001', '001', '010', '100', '100'],
  ' ': ['00', '00', '00', '00', '00'],
};
export const FONT_GLYPHS = Object.keys(GLYPHS).join('');
const FONT_WIDTHS = Object.fromEntries(
  Object.entries(GLYPHS)
    .filter(([, rows]) => rows[0].length !== 3)
    .map(([ch, rows]) => [ch, rows[0].length]),
);
const font = (() => {
  const chars = Object.keys(GLYPHS);
  const img = createImage(chars.length * 3, 5);
  chars.forEach((ch, i) => {
    GLYPHS[ch].forEach((row, y) =>
      [...row].forEach((bit, x) => {
        if (bit === '1') img.px(i * 3 + x, y, [255, 255, 255, 255]);
      }),
    );
  });
  return img;
})();

// --------------------------------------------------------------- catalogue

/**
 * Every slot: the art, plus the manifest entry (single-frame size, anchor in
 * that frame, named states laid out left to right, optional 9-slice insets,
 * whether the renderer tints it, and a note for the Artist).
 */
export const SLOTS = [
  {
    id: 'node_socket_empty',
    img: nodeSocketEmpty,
    states: ['default'],
    anchor: [2, 2],
    note: 'Recessed bezel under every bead. Shows once a TU has drained.',
  },
  {
    id: 'node_gem_lit',
    img: nodeGemLit,
    states: ['default'],
    anchor: [2, 2],
    tint: true,
    note: 'Lit bead. Gray pixels take the phase colour, pure white is the specular pixel. Drawn over the socket.',
  },
  {
    id: 'node_leading_pulse',
    img: nodeLeadingPulse,
    states: ['f0', 'f1', 'f2'],
    anchor: [3, 3],
    fps: 7,
    note: 'Highlight ring drawn over the active bead. Frames loop.',
  },
  {
    id: 'spine_link',
    img: spineLink,
    states: ['default'],
    anchor: [2, 2],
    note: 'Brass chain link, stamped 5 times between beads.',
  },
  {
    id: 'fog_shroud',
    img: fogShroud,
    states: ['default'],
    anchor: [3, 3],
    note: 'Wispy mist over a bead when pre-dawn fog is on. Translucent.',
  },
  {
    id: 'anchor_left_moon',
    img: anchorLeftMoon,
    states: ['default'],
    anchor: [6, 6],
    note: 'Left end-cap: 0 TU, the wrap back to 05:00.',
  },
  {
    id: 'anchor_right_dawn',
    img: anchorRightDawn,
    states: ['default'],
    anchor: [6, 6],
    note: 'Right end-cap: 100 TU, the 05:00 start of the day.',
  },
  {
    id: 'medallion_sunset',
    img: medallionSunset,
    states: ['lit', 'drained'],
    anchor: [5, 5],
    note: 'Sits on the sunset bead.',
  },
  {
    id: 'medallion_sunrise',
    img: medallionSunrise,
    states: ['lit', 'drained'],
    anchor: [4, 4],
    note: 'Sits on the sunrise bead.',
  },
  {
    id: 'sub_node',
    img: subNode,
    states: ['lit', 'drained'],
    anchor: [4, 4],
    tint: true,
    note: 'Solar noon and midnight beads. The lit well is gray and takes the phase colour.',
  },
  {
    id: 'sky_sun',
    img: skySun,
    states: ['default'],
    anchor: [3, 3],
    note: 'Glides across the sky strip while it is day.',
  },
  {
    id: 'sky_moon',
    img: skyMoon,
    states: ['default'],
    anchor: [3, 3],
    note: 'Glides across the sky strip at night. A lunar phase sheet can replace it later.',
  },
  {
    id: 'sky_frame',
    img: skyFrame,
    states: ['default'],
    anchor: [0, 0],
    slice: [2, 2, 2, 2],
    note: '9-slice border around the sky strip. Centre is transparent.',
  },
  {
    id: 'terrain_mask',
    img: terrain,
    states: ['default'],
    anchor: [0, 0],
    tint: true,
    tile: true,
    note: 'Tileable hills silhouette along the bottom of the sky. Gray, tinted by the ground colour of the hour.',
  },
  {
    id: 'cursor_pill_day',
    img: pillDay,
    states: ['default'],
    anchor: [4, 4],
    slice: [3, 3, 3, 3],
    note: 'Tooltip box by day, 9-slice. Text sits inside.',
  },
  {
    id: 'cursor_pill_night',
    img: pillNight,
    states: ['default'],
    anchor: [4, 4],
    slice: [3, 3, 3, 3],
    note: 'Tooltip box by night (violet), 9-slice.',
  },
  {
    id: 'cursor_stem_day',
    img: stem(rgba('#fde047')),
    states: ['default'],
    anchor: [0, 0],
    note: '1 px stem from the pill down to the active bead. Stretched vertically.',
  },
  {
    id: 'cursor_stem_night',
    img: stem(rgba('#a78bfa')),
    states: ['default'],
    anchor: [0, 0],
    note: 'Night stem (violet).',
  },
  // Biome terrain strips for the sky strip: bases and details. See hud-day-cycle-biome-art.mjs.
  ...BIOME_SLOTS,
];

/** Build the manifest object from the slots. */
export function buildManifest() {
  const sprites = {};
  for (const slot of SLOTS) {
    const w = slot.img.w / slot.states.length;
    sprites[slot.id] = {
      file: `${slot.id}.png`,
      w,
      h: slot.img.h,
      anchor: slot.anchor,
      states: slot.states,
      ...(slot.slice ? { slice: slot.slice } : {}),
      ...(slot.tint ? { tint: true } : {}),
      ...(slot.tile ? { tile: true } : {}),
      ...(slot.sheet ? { sheet: slot.sheet } : {}),
      ...(slot.fps ? { fps: slot.fps } : {}),
      note: slot.note,
    };
  }
  return {
    version: 1,
    note: 'Edit this file, or drop new PNGs over the placeholders. See README.md.',
    sprites,
    font: {
      file: 'pixel_font.png',
      cellW: 3,
      cellH: 5,
      spacing: 1,
      glyphs: FONT_GLYPHS,
      widths: FONT_WIDTHS,
      note: 'White glyphs on transparent, tinted at draw time. Cells are cellW wide in glyph order; widths overrides a glyph advance.',
    },
  };
}

export function writeAll(outDir = OUT_DIR, { manifest = false } = {}) {
  mkdirSync(outDir, { recursive: true });
  for (const slot of SLOTS) writeFileSync(join(outDir, `${slot.id}.png`), encodePng(slot.img));
  writeFileSync(join(outDir, 'pixel_font.png'), encodePng(font));
  const path = join(outDir, 'manifest.json');
  if (manifest || !existsSync(path)) {
    writeFileSync(path, `${JSON.stringify(buildManifest(), null, 2)}\n`);
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  writeAll(OUT_DIR, { manifest: process.argv.includes('--manifest') });
  console.log(`wrote ${SLOTS.length + 1} sprites to ${OUT_DIR}`);
}
