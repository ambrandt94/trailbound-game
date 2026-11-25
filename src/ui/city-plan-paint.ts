/**
 * Raster of the city-plan debug overlay. No DOM, so tests and the panel share it.
 */
import type { CityPlan } from '../core/world/city-plan';
import { boundingBox, quadKey, toKeySet } from '../core/world/city-mask';
import type { Vec2 } from '../core/world/models';

const CELL = 14;
const PAD = 28;

const FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  a: ['010', '101', '111', '101', '101'],
  c: ['111', '100', '100', '100', '111'],
  d: ['011', '101', '101', '101', '011'],
  e: ['111', '100', '110', '100', '111'],
  h: ['101', '101', '111', '101', '101'],
  i: ['111', '010', '010', '010', '111'],
  l: ['100', '100', '100', '100', '111'],
  m: ['101', '111', '111', '101', '101'],
  n: ['110', '101', '101', '101', '101'],
  o: ['111', '101', '101', '101', '111'],
  p: ['111', '101', '111', '100', '100'],
  r: ['110', '101', '110', '101', '101'],
  s: ['111', '100', '111', '001', '111'],
  t: ['111', '010', '010', '010', '010'],
  v: ['101', '101', '101', '101', '010'],
  w: ['101', '101', '111', '111', '101'],
  y: ['101', '101', '111', '001', '111'],
  ' ': ['000', '000', '000', '000', '000'],
};

export interface CityRaster {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export function paintCityPlan(plan: CityPlan, cell = CELL): CityRaster {
  const box = boundingBox(plan.quadrants.length ? plan.quadrants : [{ x: 0, y: 0 }]);
  const cols = Math.max(1, box.w);
  const rows = Math.max(1, box.h);
  const width = cols * cell + PAD * 2;
  const height = rows * cell + PAD * 2 + 22;
  const rgba = new Uint8ClampedArray(width * height * 4);
  fill(rgba, width, height, 22, 32, 44, 255);

  const wardAt = new Map<number, number>();
  for (const ward of plan.wards) {
    for (const quadrant of ward.quadrants) wardAt.set(quadKey(quadrant.x, quadrant.y), ward.wardId);
  }
  const core = toKeySet(fineToQuadrants(plan.core));
  const outskirts = toKeySet(fineToQuadrants(plan.outskirts));
  const docks = toKeySet(fineToQuadrants(plan.docks));
  const originX = (q: number) => PAD + (q - box.x0) * cell;
  const originY = (q: number) => PAD + (q - box.y0) * cell;

  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      const key = quadKey(x, y);
      const id = wardAt.get(key);
      const px = originX(x);
      const py = originY(y);
      if (id === undefined) {
        strokeRect(rgba, width, height, px, py, cell, cell, 40, 52, 64, 255);
        continue;
      }
      const [r, g, b] = wardColor(id);
      fillRect(rgba, width, height, px + 1, py + 1, cell - 2, cell - 2, r, g, b, 255);
      if (core.has(key))
        fillRect(rgba, width, height, px + 4, py + 4, cell - 8, cell - 8, 90, 150, 220, 180);
      else if (docks.has(key))
        fillRect(rgba, width, height, px + 3, py + 3, 5, 5, 80, 210, 190, 230);
      else if (outskirts.has(key))
        fillRect(rgba, width, height, px + cell - 7, py + 3, 4, 4, 210, 170, 90, 220);
      strokeRect(rgba, width, height, px, py, cell, cell, 18, 24, 32, 180);
    }
  }

  const wall = plan.wall;
  for (let i = 1; i < wall.length; i++) {
    const a = wall[i - 1]!;
    const b = wall[i]!;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 3) continue;
    line(
      rgba,
      width,
      height,
      originX(a.x) + cell / 2,
      originY(a.y) + cell / 2,
      originX(b.x) + cell / 2,
      originY(b.y) + cell / 2,
      245,
      240,
      230,
      255,
    );
  }
  for (const gate of plan.gates) {
    const px = originX(gate.x) + cell / 2 - 3;
    const py = originY(gate.y) + cell / 2 - 3;
    fillRect(rgba, width, height, px, py, 6, 6, 240, 190, 40, 255);
  }

  for (const ward of plan.wards) {
    const centroid = mean(ward.quadrants);
    const label = String(ward.wardId);
    blitText(
      rgba,
      width,
      height,
      label,
      originX(centroid.x) + 2,
      originY(centroid.y) + 2,
      255,
      255,
      255,
      230,
    );
  }
  for (const warning of plan.warnings) {
    const px = originX(warning.quadrant.x) + cell / 2;
    const py = originY(warning.quadrant.y) + cell / 2;
    fillRect(rgba, width, height, px - 3, py - 3, 6, 6, 220, 40, 40, 255);
  }

  const caption = `${plan.settlementClass} seed ${plan.seed}`;
  blitText(rgba, width, height, caption, 8, height - 16, 230, 224, 210, 255);
  return { width, height, rgba };
}

function fineToQuadrants(tiles: readonly Vec2[]): Vec2[] {
  const seen = new Set<number>();
  const out: Vec2[] = [];
  for (const tile of tiles) {
    const x = Math.floor(tile.x / 8);
    const y = Math.floor(tile.y / 8);
    const key = quadKey(x, y);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x, y });
  }
  return out;
}

function mean(cells: readonly Vec2[]): Vec2 {
  if (!cells.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const cell of cells) {
    x += cell.x;
    y += cell.y;
  }
  return { x: x / cells.length, y: y / cells.length };
}

export function wardColor(id: number): [number, number, number] {
  const hue = (id * 137.508) % 360;
  return hsl(hue, 0.55, 0.58);
}

function hsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function fill(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
}

function fillRect(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(width, Math.ceil(x + w));
  const y1 = Math.min(height, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) blend(rgba, width, px, py, r, g, b, a);
  }
}

function strokeRect(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  fillRect(rgba, width, height, x, y, w, 1, r, g, b, a);
  fillRect(rgba, width, height, x, y + h - 1, w, 1, r, g, b, a);
  fillRect(rgba, width, height, x, y, 1, h, r, g, b, a);
  fillRect(rgba, width, height, x + w - 1, y, 1, h, r, g, b, a);
}

function line(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    fillRect(rgba, width, height, x - 1, y - 1, 3, 3, r, g, b, a);
  }
}

function blend(
  rgba: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const i = (y * width + x) * 4;
  const srcA = a / 255;
  const dstA = (rgba[i + 3] ?? 0) / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  rgba[i] = Math.round((r * srcA + (rgba[i] ?? 0) * dstA * (1 - srcA)) / outA);
  rgba[i + 1] = Math.round((g * srcA + (rgba[i + 1] ?? 0) * dstA * (1 - srcA)) / outA);
  rgba[i + 2] = Math.round((b * srcA + (rgba[i + 2] ?? 0) * dstA * (1 - srcA)) / outA);
  rgba[i + 3] = Math.round(outA * 255);
}

function blitText(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  let cursor = Math.round(x);
  for (const ch of text) {
    const glyph = FONT[ch];
    if (!glyph) {
      cursor += 4;
      continue;
    }
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] !== '1') continue;
        fillRect(rgba, width, height, cursor + gx, Math.round(y) + gy, 1, 1, r, g, b, a);
      }
    });
    cursor += 4;
  }
}
