/**
 * Placeholder art for the biome terrain of the day-cycle HUD's sky strip.
 *
 * Every slot is a tileable 36 px wide strip, bottom aligned to the sky floor,
 * drawn in grays so the renderer can tint it (see `src/ui/day-cycle/biome-recipes.ts`):
 *   - BASE masks are the ground silhouette: flatland, grass, mountains, coast, dunes
 *     (the hills base is the original `terrain_mask`);
 *   - DETAIL overlays stand on the ground: pine, broadleaf, scrub, rocks, snowcaps,
 *     cactus, reeds, the sea band (drawn behind the base) and waves.
 * Light grays are lit faces, mid grays body, dark grays shade and trunks. Pure
 * white (#ffffff) is the specular: foam and snow take the tint's near-white.
 * Leftmost and rightmost columns continue into each other, so strips tile.
 */
import { createImage } from './ui-png.mjs';

export const STRIP_W = 36;

const gray = (v) => [v, v, v, 255];
const WHITE = [255, 255, 255, 255];
const RIM = 250;
const LIT = 226;
const BODY = 200;
const SHADE = 170;
const DEEP = 148;

/** Deterministic small noise in `[0, n)`. */
function hash(x, n) {
  let h = (x * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = (h * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) % n;
}

const wrap = (x) => ((x % STRIP_W) + STRIP_W) % STRIP_W;
const wrapDist = (a, b) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, STRIP_W - d);
};

/** Fill each column up from the floor to its height, shaded rim / lit / body / deep. */
function fromHeights(heights, H, shadeAt) {
  const img = createImage(STRIP_W, H);
  heights.forEach((h, x) => {
    for (let r = 0; r < h; r++) {
      const y = H - h + r;
      const v = shadeAt
        ? shadeAt(x, r, h)
        : r === 0
          ? RIM
          : r < 3
            ? LIT
            : r >= h - 2
              ? SHADE
              : BODY;
      img.px(x, y, gray(v));
    }
  });
  return img;
}

// ------------------------------------------------------------------ bases

function flatland() {
  const h = Array.from({ length: STRIP_W }, () => 3);
  for (const x of [4, 5, 15, 24, 25, 26, 33]) h[x] = 4;
  h[31] = 2;
  h[10] = 2;
  return fromHeights(h, 8);
}

function grass() {
  const h = Array.from({ length: STRIP_W }, (_, x) => {
    const t = (2 * Math.PI * x) / STRIP_W;
    const v = 4.2 + 1.2 * Math.sin(2 * t + 0.5) + 0.8 * Math.sin(3 * t + 2);
    return Math.max(3, Math.min(6, Math.round(v)));
  });
  return fromHeights(h, 8);
}

/** Peaks as [x, height]. Shared with the snowcaps so the caps sit on the summits. */
export const MOUNTAIN_PEAKS = [
  [5, 11],
  [14, 8],
  [22, 10],
  [31, 9],
];
const MOUNTAIN_H = 11;

function mountainHeights() {
  return Array.from({ length: STRIP_W }, (_, x) => {
    let best = 4;
    for (const [px, ph] of MOUNTAIN_PEAKS) {
      const d = wrapDist(x, px);
      best = Math.max(
        best,
        ph - Math.round(d * 0.95) - (d > 1 && hash(x * 3 + px, 5) === 0 ? 1 : 0),
      );
    }
    return Math.min(MOUNTAIN_H, best);
  });
}

/** Which side of its nearest peak a column is on: -1 lit (left), 0 summit, 1 shaded (right). */
function mountainSide(x) {
  let bestD = Infinity;
  let side = 0;
  for (const [px] of MOUNTAIN_PEAKS) {
    const d = wrapDist(x, px);
    if (d < bestD) {
      bestD = d;
      const signed = wrap(x - px) > STRIP_W / 2 ? wrap(x - px) - STRIP_W : wrap(x - px);
      side = Math.sign(signed);
    }
  }
  return side;
}

function mountains() {
  return fromHeights(mountainHeights(), MOUNTAIN_H, (x, r, h) => {
    if (r === 0) return RIM;
    const side = mountainSide(x);
    if (side <= 0) return r >= h - 1 ? BODY : LIT;
    return r >= h - 1 ? DEEP : SHADE;
  });
}

function coast() {
  const h = Array.from({ length: STRIP_W }, (_, x) =>
    Math.max(2, 6 - Math.round(wrapDist(x, 33) * 0.85)),
  );
  h[20] = 3;
  h[21] = 3;
  return fromHeights(h, 8);
}

function dunes() {
  const period = STRIP_W / 2;
  const h = Array.from({ length: STRIP_W }, (_, x) => {
    const p = x % period;
    const rise =
      p < 12 ? Math.sin((p / 12) * (Math.PI / 2)) : Math.cos(((p - 12) / 6) * (Math.PI / 2));
    return Math.max(3, Math.round(3 + 3 * rise));
  });
  return fromHeights(h, 8, (x, r, hh) => {
    const lee = x % period >= 12;
    if (r === 0) return RIM;
    if (lee) return r >= hh - 1 ? DEEP : SHADE;
    return r < 2 ? LIT : r >= hh - 1 ? SHADE : BODY;
  });
}

// ---------------------------------------------------------------- details

function put(img, x, y, v) {
  if (y < 0 || y >= img.h) return;
  img.px(wrap(x), y, Array.isArray(v) ? v : gray(v));
}

function pine() {
  const H = 12;
  const img = createImage(STRIP_W, H);
  const trees = [
    [3, 9, 3],
    [9, 12, 3],
    [15, 8, 2],
    [21, 11, 3],
    [27, 9, 3],
    [33, 10, 3],
  ];
  for (const [cx, height, hw] of trees) {
    const top = H - height;
    const body = height - 1;
    for (let r = 0; r < body; r++) {
      let half = Math.min(hw, Math.floor((r + 1) / 2));
      if (r > 1 && r % 3 === 0) half = Math.max(0, half - 1);
      for (let dx = -half; dx <= half; dx++) {
        const v = r === 0 ? RIM : dx < 0 ? LIT : dx === 0 ? BODY : SHADE;
        put(img, cx + dx, top + r, v);
      }
    }
    put(img, cx, H - 1, 118);
  }
  return img;
}

function broadleaf() {
  const H = 11;
  const img = createImage(STRIP_W, H);
  const trees = [
    [4, 4],
    [13, 3],
    [21, 4],
    [29, 3],
  ];
  for (const [cx, r] of trees) {
    const cy = H - 3 - r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r * 0.6) continue;
        const k = dx + dy;
        const v = k < -r * 0.3 ? RIM : k > r * 0.6 ? SHADE : k > 0 ? BODY : LIT;
        put(img, cx + dx, cy + dy, v);
      }
    }
    put(img, cx, H - 3, 110);
    put(img, cx, H - 2, 110);
    put(img, cx, H - 1, 110);
  }
  return img;
}

function scrub() {
  const H = 5;
  const img = createImage(STRIP_W, H);
  for (const [cx, w] of [
    [2, 3],
    [8, 2],
    [15, 4],
    [21, 3],
    [28, 2],
    [33, 4],
  ]) {
    const hgt = Math.min(3, Math.ceil(w * 0.7));
    for (let r = 0; r < hgt; r++) {
      const half = Math.max(0, Math.floor((w * (r + 1.5)) / (hgt + 1.5) / 2));
      for (let dx = -half; dx <= half; dx++)
        put(img, cx + dx, H - hgt + r, r === 0 ? RIM : dx > 0 ? SHADE : BODY);
    }
  }
  return img;
}

function rocks() {
  const H = 5;
  const img = createImage(STRIP_W, H);
  for (const [cx, w, h] of [
    [3, 5, 3],
    [11, 3, 2],
    [18, 6, 4],
    [27, 4, 3],
    [32, 3, 2],
  ]) {
    for (let r = 0; r < h; r++) {
      const half = Math.max(0, Math.floor(((r + 1) * w) / h / 2) - (r === 0 ? 1 : 0));
      for (let dx = -half; dx <= half; dx++) {
        const lit = dx <= 0 && r < h - 1;
        put(img, cx + dx, H - h + r, r === 0 ? RIM : lit ? LIT : r === h - 1 ? DEEP : SHADE);
      }
    }
  }
  return img;
}

function snowcaps() {
  const H = MOUNTAIN_H;
  const img = createImage(STRIP_W, H);
  const heights = mountainHeights();
  heights.forEach((h, x) => {
    if (h < 7) return;
    let depth = h - 6 + (hash(x, 3) === 0 ? 1 : 0) - (hash(x + 9, 4) === 0 ? 1 : 0);
    depth = Math.max(1, depth);
    const side = mountainSide(x);
    for (let r = 0; r < depth; r++) put(img, x, H - h + r, side <= 0 ? WHITE : gray(228));
  });
  return img;
}

function cactus() {
  const H = 8;
  const img = createImage(STRIP_W, H);
  for (const [cx, h, arms] of [
    [6, 8, true],
    [17, 6, false],
    [28, 7, true],
  ]) {
    const top = H - h;
    for (let y = top; y < H; y++) {
      put(img, cx, y, y === top ? RIM : LIT);
      put(img, cx + 1, y, SHADE);
    }
    if (arms) {
      const ay = top + 3;
      put(img, cx - 2, ay, LIT);
      put(img, cx - 1, ay, LIT);
      put(img, cx - 2, ay - 1, RIM);
      put(img, cx - 2, ay - 2, RIM);
      put(img, cx + 3, ay + 1, SHADE);
      put(img, cx + 2, ay + 1, SHADE);
      put(img, cx + 3, ay, SHADE);
      put(img, cx + 3, ay - 1, SHADE);
    }
  }
  return img;
}

function reeds() {
  const H = 7;
  const img = createImage(STRIP_W, H);
  const stems = [
    [1, 5],
    [3, 7],
    [4, 4],
    [8, 6],
    [10, 4],
    [11, 5],
    [16, 7],
    [18, 5],
    [19, 4],
    [24, 6],
    [26, 7],
    [27, 4],
    [31, 5],
    [33, 6],
    [34, 4],
  ];
  for (const [x, h] of stems) {
    for (let y = H - h; y < H; y++) put(img, x, y, y === H - h ? 120 : BODY);
    if (h >= 6) put(img, x, H - h + 1, 120);
    if (h === 7) put(img, x + 1, H - h + 2, LIT);
  }
  return img;
}

function water() {
  const H = 5;
  const img = createImage(STRIP_W, H);
  for (let x = 0; x < STRIP_W; x++) {
    put(img, x, 0, x % 4 < 2 ? 244 : RIM);
    put(img, x, 1, 210);
    put(img, x, 2, (x + 1) % 6 === 0 ? 226 : 196);
    put(img, x, 3, 190);
    put(img, x, 4, (x + 3) % 6 === 0 ? 176 : 182);
  }
  return img;
}

function waves() {
  const H = 5;
  const img = createImage(STRIP_W, H);
  for (const [x, y, len] of [
    [3, 1, 3],
    [8, 3, 2],
    [12, 2, 2],
    [20, 1, 4],
    [25, 3, 2],
    [29, 2, 3],
  ]) {
    for (let i = 0; i < len; i++) {
      put(img, x + i, y, WHITE);
      if (i > 0 && i < len - 1) put(img, x + i, y + 1, SHADE);
    }
  }
  return img;
}

const strip = (id, img, note) => ({
  id,
  img,
  states: ['default'],
  anchor: [0, 0],
  tint: true,
  tile: true,
  sheet: 'biomes',
  note,
});

/** Slots for the manifest and the PNGs, bases first. All on the `biomes` template sheet. */
export const BIOME_SLOTS = [
  strip(
    'ground_flat',
    flatland(),
    'BASE mask: flatland. Low, almost level ground, gray, tinted by the biome ground colour.',
  ),
  strip('ground_grass', grass(), 'BASE mask: grass. Gently rolling ground, 2 swells per tile.'),
  strip(
    'ground_mountains',
    mountains(),
    'BASE mask: mountains. Four peaks, lit face left, shaded right. The snowcaps strip sits on the same summits.',
  ),
  strip(
    'ground_coast',
    coast(),
    'BASE mask: coastline. Low beach with a headland wrapping the tile edge. The sea band (detail_water) draws behind it.',
  ),
  strip(
    'ground_dunes',
    dunes(),
    'BASE mask: dunes. Two wind-shaped dunes, slow windward slope, steep lee.',
  ),
  strip(
    'detail_pine',
    pine(),
    'DETAIL: pine and fir. Tree line standing on the ground; trunks are dark gray at the bottom row.',
  ),
  strip(
    'detail_broadleaf',
    broadleaf(),
    'DETAIL: broadleaf trees. Round canopies on short trunks.',
  ),
  strip('detail_scrub', scrub(), 'DETAIL: scrub and bushes, low clumps.'),
  strip('detail_rocks', rocks(), 'DETAIL: boulders, lit face left.'),
  strip(
    'detail_snowcaps',
    snowcaps(),
    'DETAIL: snow on the ground_mountains summits. Pure white is snow in light, gray 228 is snow in shade. Tinted by the accent colour.',
  ),
  strip('detail_cactus', cactus(), 'DETAIL: saguaro cactus.'),
  strip('detail_reeds', reeds(), 'DETAIL: reeds and cattails for marsh and fen.'),
  strip(
    'detail_water',
    water(),
    'DETAIL: sea or marsh water band. Drawn BEHIND the base mask, tinted by the water colour.',
  ),
  strip(
    'detail_waves',
    waves(),
    'DETAIL: foam crests over the water band. Pure white pixels take the water tint, gray is shade.',
  ),
];
