/**
 * Quadrant masks for city plans. A quadrant is an 8×8 block of fine tiles
 * (fine tiles are 8 m; a display tile is 16 fine tiles, so 2×2 quadrants).
 * Masks are plain coordinate lists so they can be cached and tested without a grid type.
 */
import type { Vec2 } from './models';

/** Fine tiles along one edge of a quadrant. */
export const FINE_PER_QUADRANT = 8;
/** Fine tiles along one edge of a display tile (128 m). */
export const FINE_PER_DISPLAY = 16;

const KEY_BIAS = 4096;
const KEY_STRIDE = 8192;

export function quadKey(x: number, y: number): number {
  return (x + KEY_BIAS) * KEY_STRIDE + (y + KEY_BIAS);
}

export function fineToQuadrant(fine: Vec2): Vec2 {
  return { x: Math.floor(fine.x / FINE_PER_QUADRANT), y: Math.floor(fine.y / FINE_PER_QUADRANT) };
}

/** Top-left fine tile of a quadrant. */
export function quadrantOrigin(quadrant: Vec2): Vec2 {
  return { x: quadrant.x * FINE_PER_QUADRANT, y: quadrant.y * FINE_PER_QUADRANT };
}

export function quadrantFineTiles(quadrant: Vec2): Vec2[] {
  const origin = quadrantOrigin(quadrant);
  const tiles: Vec2[] = [];
  for (let y = 0; y < FINE_PER_QUADRANT; y++) {
    for (let x = 0; x < FINE_PER_QUADRANT; x++) {
      tiles.push({ x: origin.x + x, y: origin.y + y });
    }
  }
  return tiles;
}

export function quadrantsToFine(quadrants: readonly Vec2[]): Vec2[] {
  const tiles: Vec2[] = [];
  const ordered = sortQuads(quadrants);
  for (const quadrant of ordered) tiles.push(...quadrantFineTiles(quadrant));
  return tiles;
}

export interface QuadBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Inclusive span, in quadrants. */
  w: number;
  h: number;
}

export function boundingBox(cells: readonly Vec2[]): QuadBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const cell of cells) {
    if (cell.x < x0) x0 = cell.x;
    if (cell.y < y0) y0 = cell.y;
    if (cell.x > x1) x1 = cell.x;
    if (cell.y > y1) y1 = cell.y;
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: -1, y1: -1, w: 0, h: 0 };
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function sortQuads(cells: readonly Vec2[]): Vec2[] {
  return cells.slice().sort((a, b) => a.y - b.y || a.x - b.x);
}

export function toKeySet(cells: readonly Vec2[]): Set<number> {
  const set = new Set<number>();
  for (const cell of cells) set.add(quadKey(cell.x, cell.y));
  return set;
}

const CARDINAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function components4(cells: readonly Vec2[]): Vec2[][] {
  const set = toKeySet(cells);
  const seen = new Set<number>();
  const components: Vec2[][] = [];
  const ordered = sortQuads(cells);
  for (const start of ordered) {
    const sk = quadKey(start.x, start.y);
    if (seen.has(sk)) continue;
    const component: Vec2[] = [];
    const stack = [start];
    seen.add(sk);
    while (stack.length) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const [dx, dy] of CARDINAL) {
        const x = cur.x + dx;
        const y = cur.y + dy;
        const key = quadKey(x, y);
        if (!set.has(key) || seen.has(key)) continue;
        seen.add(key);
        stack.push({ x, y });
      }
    }
    components.push(sortQuads(component));
  }
  return components;
}

export function isConnected4(cells: readonly Vec2[]): boolean {
  if (cells.length <= 1) return true;
  return components4(cells).length === 1;
}

/**
 * Fill 4-connected holes: empty quadrants that cannot reach the bounding box
 * exterior without crossing the mask. The exterior itself is not filled.
 */
export function fillHoles(cells: readonly Vec2[]): Vec2[] {
  if (!cells.length) return [];
  const box = boundingBox(cells);
  const set = toKeySet(cells);
  const x0 = box.x0 - 1;
  const y0 = box.y0 - 1;
  const x1 = box.x1 + 1;
  const y1 = box.y1 + 1;
  const outside = new Set<number>();
  const stack: Vec2[] = [];
  const push = (x: number, y: number) => {
    if (x < x0 || y < y0 || x > x1 || y > y1) return;
    const key = quadKey(x, y);
    if (set.has(key) || outside.has(key)) return;
    outside.add(key);
    stack.push({ x, y });
  };
  for (let x = x0; x <= x1; x++) {
    push(x, y0);
    push(x, y1);
  }
  for (let y = y0; y <= y1; y++) {
    push(x0, y);
    push(x1, y);
  }
  while (stack.length) {
    const cur = stack.pop()!;
    for (const [dx, dy] of CARDINAL) push(cur.x + dx, cur.y + dy);
  }
  const filled = cells.slice();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const key = quadKey(x, y);
      if (!set.has(key) && !outside.has(key)) filled.push({ x, y });
    }
  }
  return sortQuads(filled);
}

export function hasHole(cells: readonly Vec2[]): boolean {
  if (cells.length <= 3) return false;
  return fillHoles(cells).length !== dedupeCount(cells);
}

function dedupeCount(cells: readonly Vec2[]): number {
  return toKeySet(cells).size;
}

/** Top-left anchors of every fully occupied 2×2. Opening with this removes anything thinner than 2. */
function erodeBox(cells: readonly Vec2[]): Vec2[] {
  const set = toKeySet(cells);
  const out: Vec2[] = [];
  for (const cell of cells) {
    if (
      set.has(quadKey(cell.x + 1, cell.y)) &&
      set.has(quadKey(cell.x, cell.y + 1)) &&
      set.has(quadKey(cell.x + 1, cell.y + 1))
    ) {
      out.push(cell);
    }
  }
  return out;
}

function dilateBox(cells: readonly Vec2[]): Vec2[] {
  const out = new Map<number, Vec2>();
  for (const cell of cells) {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      out.set(quadKey(x, y), { x, y });
    }
  }
  return sortQuads([...out.values()]);
}

/**
 * Opening of radius 1 uses the 2×2 block, so a mask is unchanged exactly when
 * every quadrant sits in a 2×2. That is the “no 1-quadrant neck or spur” cut.
 * Larger radii repeat it.
 */
export function morphOpen(cells: readonly Vec2[], radius = 1): Vec2[] {
  let cur = cells.slice();
  const steps = Math.max(0, radius);
  for (let i = 0; i < steps; i++) cur = dilateBox(erodeBox(cur));
  return sortQuads(cur);
}

const BOX3: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function dilateBox3(cells: readonly Vec2[]): Vec2[] {
  const out = new Map<number, Vec2>();
  for (const cell of cells) {
    for (const [dx, dy] of BOX3) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      out.set(quadKey(x, y), { x, y });
    }
  }
  return [...out.values()];
}

function erodeBox3(cells: readonly Vec2[]): Vec2[] {
  const set = toKeySet(cells);
  const out: Vec2[] = [];
  for (const cell of cells) {
    let keep = true;
    for (const [dx, dy] of BOX3) {
      if (!set.has(quadKey(cell.x + dx, cell.y + dy))) {
        keep = false;
        break;
      }
    }
    if (keep) out.push(cell);
  }
  return out;
}

/** Closing of radius 1 uses the 3×3 square, which fills one-quadrant holes and gaps. */
export function morphClose(cells: readonly Vec2[], radius = 1): Vec2[] {
  let cur = cells.slice();
  const steps = Math.max(0, radius);
  for (let i = 0; i < steps; i++) cur = dilateBox3(cur);
  for (let i = 0; i < steps; i++) cur = erodeBox3(cur);
  return sortQuads(cur);
}

/**
 * 2 when every quadrant sits in a fully occupied 2×2 (no 1-quadrant neck or spur),
 * otherwise 1 for a non-empty mask and 0 for an empty one.
 */
export function thinnestWidth(cells: readonly Vec2[]): number {
  if (!cells.length) return 0;
  const set = toKeySet(cells);
  for (const cell of cells) {
    if (!inSolid2x2(cell.x, cell.y, set)) return 1;
  }
  return 2;
}

export function inSolid2x2(x: number, y: number, set: ReadonlySet<number>): boolean {
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1],
  ];
  for (const [dx, dy] of offsets) {
    const ox = x + dx;
    const oy = y + dy;
    if (
      set.has(quadKey(ox, oy)) &&
      set.has(quadKey(ox + 1, oy)) &&
      set.has(quadKey(ox, oy + 1)) &&
      set.has(quadKey(ox + 1, oy + 1))
    ) {
      return true;
    }
  }
  return false;
}

/** Drop quadrants that are not part of a 2×2, repeating so spurs uncovered by a removal go too. */
export function pruneThin(cells: readonly Vec2[]): Vec2[] {
  let cur = cells.slice();
  for (;;) {
    const set = toKeySet(cur);
    const next = cur.filter((cell) => inSolid2x2(cell.x, cell.y, set));
    if (next.length === cur.length) return sortQuads(next);
    cur = next;
  }
}
