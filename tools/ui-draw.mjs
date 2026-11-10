import { fillRect, createImage } from './ui-png.mjs';

const C = {
  ink: [58, 36, 24, 255],
  wood: [132, 84, 55, 255],
  woodLt: [176, 122, 78, 255],
  woodDk: [90, 52, 32, 255],
  leather: [122, 58, 38, 255],
  leatherDk: [92, 42, 28, 255],
  hover: [107, 50, 31, 255],
  cream: [255, 241, 210, 255],
  creamDk: [241, 215, 174, 255],
  parchment: [236, 214, 176, 255],
  disabled: [210, 192, 164, 255],
  disabledEdge: [154, 132, 110, 255],
  brass: [222, 180, 74, 255],
  brassLt: [244, 214, 130, 255],
  brassDk: [168, 124, 40, 255],
  stitch: [236, 210, 168, 255],
  moss: [63, 125, 85, 255],
  mossDk: [36, 92, 58, 255],
};

const FACES = {
  cream: C.cream,
  parchment: C.parchment,
  leather: C.leather,
  hover: C.hover,
  press: C.leatherDk,
  disabled: C.disabled,
};

/** @param {import('./ui-catalog.mjs').SpriteDef} spec */
export function drawSprite(spec) {
  const img = createImage(spec.w, spec.h);
  switch (spec.kind) {
    case 'frame':
    case 'title':
      drawFrame(img, spec);
      break;
    case 'panel':
      drawPanel(img, spec);
      break;
    case 'header':
      drawHeader(img);
      break;
    case 'canvas':
      drawCanvas(img);
      break;
    case 'button':
    case 'tab':
    case 'slot':
    case 'chip':
      drawFace(img, spec);
      break;
    case 'badge':
      drawBadge(img);
      break;
    case 'tooltip':
      drawTooltip(img, spec);
      break;
    case 'card':
      drawCard(img, spec);
      break;
    case 'scroll_track':
      drawScrollTrack(img);
      break;
    case 'scroll_thumb':
      drawScrollThumb(img);
      break;
    case 'scroll_cap':
      drawScrollCap(img, spec.state === 'up' ? -1 : 1);
      break;
    case 'check':
      drawCheck(img, spec.state === 'on');
      break;
    case 'toggle':
      drawToggle(img, spec.state === 'on');
      break;
    case 'slider_track':
      drawSliderTrack(img);
      break;
    case 'slider_thumb':
      drawSliderThumb(img);
      break;
    case 'swatch':
      drawSwatch(img, spec.state === 'selected');
      break;
    case 'cell':
      drawCell(img, spec);
      break;
    case 'floor':
      drawFloor(img, spec.state === 'ghost');
      break;
    case 'icon':
      drawIcon(img, spec.icon ?? 'close');
      break;
    case 'pin':
      drawPin(img, spec.state === 'active');
      break;
    default:
      fillRect(img, 0, 0, img.w, img.h, C.cream);
  }
  return img;
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {import('./ui-catalog.mjs').SpriteDef} spec
 */
function drawFrame(img, spec) {
  const face = spec.kind === 'title' ? C.leather : C.cream;
  fillRect(img, 0, 0, img.w, img.h, face);
  const b = spec.borders;
  paintRing(img, b, C.wood);
  outline(img, 2, C.ink);
  innerLip(img, b);
  plankSeam(img, b);
  brassCorners(img, b);
  if (spec.kind === 'title') rope(img, b);
  if (spec.light) thinCaps(img, b);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {import('./ui-catalog.mjs').SpriteDef} spec
 */
function drawPanel(img, spec) {
  fillRect(img, 0, 0, img.w, img.h, C.parchment);
  paintRing(img, spec.borders, C.wood);
  outline(img, 2, C.ink);
  innerLip(img, spec.borders);
  hem(img, spec.borders);
}

/** @param {ReturnType<typeof createImage>} img */
function drawHeader(img) {
  fillRect(img, 0, 0, img.w, img.h, C.leather);
  for (let x = 0; x < img.w; x++) {
    img.px(x, 0, C.ink);
    img.px(x, img.h - 1, C.ink);
    img.px(x, 1, C.leatherDk);
    img.px(x, img.h - 2, C.leatherDk);
    if (x % 8 < 3) {
      img.px(x, 2, C.stitch);
      img.px(x, img.h - 3, C.stitch);
    }
  }
}

/** @param {ReturnType<typeof createImage>} img */
function drawCanvas(img) {
  fillRect(img, 0, 0, img.w, img.h, C.parchment);
  for (let y = 6; y < img.h; y += 8) {
    for (let x = 0; x < img.w; x++) img.px(x, y, C.creamDk);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {import('./ui-catalog.mjs').SpriteDef} spec
 */
function drawFace(img, spec) {
  const face = FACES[spec.face ?? 'cream'] ?? C.cream;
  fillRect(img, 0, 0, img.w, img.h, face);
  const edge =
    spec.face === 'disabled'
      ? C.disabledEdge
      : spec.face === 'cream' || spec.face === 'parchment'
        ? C.leather
        : C.leatherDk;
  paintRing(img, spec.borders, edge);
  outline(img, 2, spec.face === 'disabled' ? C.disabledEdge : C.ink);
  if (spec.face !== 'disabled')
    stitches(img, spec.borders, spec.face === 'cream' ? C.stitch : C.creamDk);
  if (spec.face === 'leather' || spec.face === 'hover' || spec.face === 'press') {
    brassCorners(img, spec.borders);
  }
  if (spec.face === 'hover') topShine(img, spec.borders, C.brass);
  if (spec.face === 'press') topShine(img, spec.borders, C.ink);
}

/** @param {ReturnType<typeof createImage>} img */
function drawBadge(img) {
  fillRect(img, 0, 0, img.w, img.h, C.parchment);
  outline(img, 1, C.ink);
  for (let x = 3; x < img.w - 3; x += 4) {
    img.px(x, 2, C.leather);
    img.px(x, img.h - 3, C.leather);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {import('./ui-catalog.mjs').SpriteDef} spec
 */
function drawTooltip(img, spec) {
  fillRect(img, 0, 0, img.w, img.h, C.cream);
  paintRing(img, spec.borders, C.wood);
  outline(img, 2, C.ink);
  innerLip(img, spec.borders);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {import('./ui-catalog.mjs').SpriteDef} spec
 */
function drawCard(img, spec) {
  fillRect(img, 0, 0, img.w, img.h, C.cream);
  paintRing(img, spec.borders, C.moss);
  outline(img, 2, C.mossDk);
  innerLip(img, spec.borders);
  brassCorners(img, spec.borders);
}

/** @param {ReturnType<typeof createImage>} img */
function drawScrollTrack(img) {
  fillRect(img, 0, 0, img.w, img.h, C.creamDk);
  for (let y = 0; y < img.h; y++) {
    img.px(0, y, C.ink);
    img.px(img.w - 1, y, C.ink);
    img.px(1, y, C.woodDk);
    img.px(img.w - 2, y, C.wood);
  }
}

/** @param {ReturnType<typeof createImage>} img */
function drawScrollThumb(img) {
  fillRect(img, 0, 0, img.w, img.h, C.leather);
  outline(img, 1, C.ink);
  for (let y = 4; y < img.h - 4; y += 4) {
    img.px(4, y, C.stitch);
    img.px(img.w - 5, y, C.stitch);
  }
  fillRect(img, 6, 4, 4, 3, C.brass);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} dir
 */
function drawScrollCap(img, dir) {
  fillRect(img, 0, 0, img.w, img.h, C.wood);
  outline(img, 1, C.ink);
  const mid = (img.w / 2) | 0;
  const y0 = dir < 0 ? 9 : 4;
  for (let i = 0; i < 4; i++) {
    const y = y0 + (dir < 0 ? -i : i);
    img.px(mid - i, y, C.cream);
    img.px(mid + i, y, C.cream);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {boolean} on
 */
function drawCheck(img, on) {
  fillRect(img, 0, 0, img.w, img.h, on ? C.leather : C.cream);
  outline(img, 2, C.ink);
  fillRect(img, 3, 3, 4, 4, C.brass);
  if (!on) return;
  const pts = [
    [8, 16],
    [9, 17],
    [10, 18],
    [11, 19],
    [12, 18],
    [14, 16],
    [16, 14],
    [18, 12],
    [20, 10],
    [22, 8],
  ];
  for (const [x, y] of pts) {
    img.px(x, y, C.cream);
    img.px(x, y + 1, C.cream);
    img.px(x + 1, y, C.cream);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {boolean} on
 */
function drawToggle(img, on) {
  fillRect(img, 0, 0, img.w, img.h, on ? C.leather : C.disabled);
  outline(img, 2, C.ink);
  const knob = on ? img.w - 24 : 4;
  fillRect(img, knob, 4, 20, img.h - 8, C.cream);
  outlineRect(img, knob, 4, 20, img.h - 8, C.ink);
  if (on) fillRect(img, knob + 8, 8, 4, img.h - 16, C.brass);
}

/** @param {ReturnType<typeof createImage>} img */
function drawSliderTrack(img) {
  fillRect(img, 0, 0, img.w, img.h, C.creamDk);
  outline(img, 2, C.ink);
  fillRect(img, 4, 6, img.w - 8, 4, C.wood);
}

/** @param {ReturnType<typeof createImage>} img */
function drawSliderThumb(img) {
  fillRect(img, 0, 0, img.w, img.h, C.leather);
  outline(img, 2, C.ink);
  fillRect(img, 4, 3, img.w - 8, 4, C.brass);
  for (let y = 10; y < img.h - 4; y += 4) {
    img.px(4, y, C.stitch);
    img.px(img.w - 5, y, C.stitch);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {boolean} selected
 */
function drawSwatch(img, selected) {
  const edge = selected ? C.brass : C.wood;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const ring = x < 4 || y < 4 || x >= img.w - 4 || y >= img.h - 4;
      if (!ring) continue;
      const edgePx = x < 2 || y < 2 || x >= img.w - 2 || y >= img.h - 2;
      img.px(x, y, edgePx ? C.ink : edge);
    }
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {import('./ui-catalog.mjs').SpriteDef} spec
 */
function drawCell(img, spec) {
  const pocket =
    spec.state === 'blocked'
      ? C.woodDk
      : spec.state === 'valid'
        ? C.moss
        : spec.state === 'ghost'
          ? C.disabled
          : C.cream;
  fillRect(img, 0, 0, img.w, img.h, pocket);
  paintRing(img, spec.borders, C.wood);
  outline(img, 2, spec.state === 'hover' ? C.brassDk : C.ink);
  if (spec.state === 'hover' || spec.state === 'valid') topShine(img, spec.borders, C.brass);
  if (spec.state === 'blocked') {
    for (let i = 10; i < img.w - 10; i++) {
      img.px(i, i, C.ink);
      img.px(i, img.h - 1 - i, C.ink);
    }
  }
  if (spec.state === 'ghost') {
    for (let x = 8; x < img.w - 8; x += 4) img.px(x, 8, C.ink);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {boolean} ghost
 */
function drawFloor(img, ghost) {
  fillRect(img, 0, 0, img.w, img.h, ghost ? C.disabled : C.cream);
  outline(img, 2, C.ink);
  for (let x = 4; x < img.w; x += 8) {
    for (let y = 4; y < img.h - 2; y++) img.px(x, y, ghost ? C.disabledEdge : C.wood);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {string} icon
 */
function drawIcon(img, icon) {
  fillRect(img, 0, 0, img.w, img.h, C.leather);
  outline(img, 2, C.ink);
  const m = (img.w / 2) | 0;
  const ink = C.cream;
  if (icon === 'close') cross(img, m, m, 7, ink);
  else if (icon === 'back') arrow(img, m, m, -1, 0, ink);
  else if (icon === 'down') arrow(img, m, m, 0, 1, ink);
  else if (icon === 'up') arrow(img, m, m, 0, -1, ink);
  else if (icon === 'rotate' || icon === 'rotL' || icon === 'rotR') {
    arcArrow(img, m, m, icon === 'rotL' ? -1 : 1, ink);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {boolean} active
 */
function drawPin(img, active) {
  const m = (img.w / 2) | 0;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const d = Math.abs(x - m) + Math.abs(y - m);
      if (d > 14) continue;
      if (d > 12) img.px(x, y, C.ink);
      else if (d > 10) img.px(x, y, active ? C.brass : C.cream);
      else if (d > 5) img.px(x, y, active ? C.leather : C.wood);
      else img.px(x, y, C.brassLt);
    }
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 * @param {readonly number[]} color
 */
function paintRing(img, b, color) {
  if (b.l + b.r === 0 && b.t + b.b === 0) return;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (x < b.l || y < b.t || x >= img.w - b.r || y >= img.h - b.b) img.px(x, y, color);
    }
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} thick
 * @param {readonly number[]} color
 */
function outline(img, thick, color) {
  for (let t = 0; t < thick; t++) {
    for (let x = 0; x < img.w; x++) {
      img.px(x, t, color);
      img.px(x, img.h - 1 - t, color);
    }
    for (let y = 0; y < img.h; y++) {
      img.px(t, y, color);
      img.px(img.w - 1 - t, y, color);
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
function outlineRect(img, x, y, w, h, color) {
  for (let i = 0; i < w; i++) {
    img.px(x + i, y, color);
    img.px(x + i, y + h - 1, color);
  }
  for (let i = 0; i < h; i++) {
    img.px(x, y + i, color);
    img.px(x + w - 1, y + i, color);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 */
function innerLip(img, b) {
  if (b.t < 4) return;
  for (let x = b.l; x < img.w - b.r; x++) {
    img.px(x, 2, C.woodLt);
    img.px(x, b.t - 1, C.woodDk);
  }
  for (let y = b.t; y < img.h - b.b; y++) {
    img.px(2, y, C.woodLt);
    img.px(b.l - 1, y, C.woodDk);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 */
function plankSeam(img, b) {
  if (b.t < 8) return;
  const y = (b.t / 2) | 0;
  for (let x = 4; x < img.w - 4; x++) {
    if (x % 10 === 0) continue;
    img.px(x, y, C.woodDk);
    img.px(x, img.h - 1 - y, C.woodDk);
  }
  const x = (b.l / 2) | 0;
  for (let yy = 4; yy < img.h - 4; yy++) {
    if (yy % 10 === 0) continue;
    img.px(x, yy, C.woodDk);
    img.px(img.w - 1 - x, yy, C.woodDk);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 */
function brassCorners(img, b) {
  const n = Math.min(b.l, b.t, b.r, b.b, 8);
  if (n < 4) return;
  corner(img, 2, 2, 1, 1, n - 2);
  corner(img, img.w - 3, 2, -1, 1, n - 2);
  corner(img, 2, img.h - 3, 1, -1, n - 2);
  corner(img, img.w - 3, img.h - 3, -1, -1, n - 2);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} x
 * @param {number} y
 * @param {number} sx
 * @param {number} sy
 * @param {number} len
 */
function corner(img, x, y, sx, sy, len) {
  for (let i = 0; i < len; i++) {
    img.px(x + sx * i, y, C.brass);
    img.px(x + sx * i, y + sy, C.brassDk);
    img.px(x, y + sy * i, C.brass);
    img.px(x + sx, y + sy * i, C.brassDk);
  }
  img.px(x + sx * 3, y + sy * 3, C.brassLt);
  img.px(x + sx * 4, y + sy * 3, C.brassLt);
  img.px(x + sx * 3, y + sy * 4, C.brassLt);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 */
function rope(img, b) {
  const y = img.h - b.b + 3;
  for (let x = b.l; x < img.w - b.r; x++) {
    img.px(x, y, x % 4 < 2 ? C.brassDk : C.brass);
    img.px(x, y + 1, C.woodDk);
  }
  wheel(img, 6, img.h - 14);
  wheel(img, img.w - 14, img.h - 14);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} x
 * @param {number} y
 */
function wheel(img, x, y) {
  for (let yy = 0; yy < 8; yy++) {
    for (let xx = 0; xx < 8; xx++) {
      const d = Math.abs(xx - 3.5) + Math.abs(yy - 3.5);
      if (d > 4) continue;
      img.px(x + xx, y + yy, d > 2.5 ? C.ink : C.woodLt);
    }
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 */
function thinCaps(img, b) {
  fillRect(img, 2, 2, 3, 3, C.brass);
  fillRect(img, img.w - 5, 2, 3, 3, C.brass);
  fillRect(img, 2, img.h - 5, 3, 3, C.brass);
  fillRect(img, img.w - 5, img.h - 5, 3, 3, C.brass);
  void b;
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 */
function hem(img, b) {
  for (let x = b.l + 2; x < img.w - b.r - 2; x += 4) {
    img.px(x, b.t, C.stitch);
    img.px(x, img.h - b.b - 1, C.stitch);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 * @param {readonly number[]} color
 */
function stitches(img, b, color) {
  const step = 6;
  if (b.t >= 4) {
    for (let x = b.l + 1; x < img.w - b.r - 1; x += step) {
      img.px(x, b.t - 2, color);
      img.px(x + 1, b.t - 2, color);
      img.px(x, img.h - b.b + 1, color);
      img.px(x + 1, img.h - b.b + 1, color);
    }
  }
  if (b.l >= 4) {
    for (let y = b.t + 1; y < img.h - b.b - 1; y += step) {
      img.px(b.l - 2, y, color);
      img.px(b.l - 2, y + 1, color);
      img.px(img.w - b.r + 1, y, color);
      img.px(img.w - b.r + 1, y + 1, color);
    }
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {{ l: number, t: number, r: number, b: number }} b
 * @param {readonly number[]} color
 */
function topShine(img, b, color) {
  for (let x = b.l; x < img.w - b.r; x++) img.px(x, b.t, color);
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} cx
 * @param {number} cy
 * @param {number} n
 * @param {readonly number[]} color
 */
function cross(img, cx, cy, n, color) {
  for (let i = -n; i <= n; i++) {
    img.px(cx + i, cy + i, color);
    img.px(cx + i, cy - i, color);
    img.px(cx + i + 1, cy + i, color);
    img.px(cx + i, cy - i + 1, color);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} cx
 * @param {number} cy
 * @param {number} dx
 * @param {number} dy
 * @param {readonly number[]} color
 */
function arrow(img, cx, cy, dx, dy, color) {
  for (let i = -6; i <= 6; i++) img.px(cx + dx * i, cy + dy * i, color);
  for (let i = 0; i < 5; i++) {
    img.px(cx + dx * (6 - i), cy + dy * (6 - i) + (dx === 0 ? i : 0) * 0, color);
    const hx = cx + dx * 6;
    const hy = cy + dy * 6;
    img.px(hx - dy * i - dx * i, hy - dx * i - dy * i, color);
    img.px(hx + dy * i - dx * i, hy + dx * i - dy * i, color);
  }
}

/**
 * @param {ReturnType<typeof createImage>} img
 * @param {number} cx
 * @param {number} cy
 * @param {number} dir
 * @param {readonly number[]} color
 */
function arcArrow(img, cx, cy, dir, color) {
  for (let a = 0; a < 12; a++) {
    const t = (a / 12) * Math.PI * 1.4 - 0.6;
    const x = Math.round(cx + Math.cos(t) * 8 * dir);
    const y = Math.round(cy + Math.sin(t) * 7);
    img.px(cx + Math.round(Math.cos(t) * 8), y, color);
    img.px(x, y, color);
  }
  img.px(cx + dir * 6, cy - 6, color);
  img.px(cx + dir * 8, cy - 4, color);
  img.px(cx + dir * 4, cy - 4, color);
}
