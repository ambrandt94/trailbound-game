import { TILE, type CameraState, type WorldData, Biome } from '../../core/world/models';

/** Screen pixels per world tile. Finer levels are for closer zoom. */
const LOD_PX = [48, 12, 3] as const;

/**
 * 0 = street (full chunk bake), 1 = mid, 2 = near-mid, 3 = whole-world sheet.
 * Chosen only from how large a world tile is on screen.
 */
export function lodLevelForScreenPx(px: number): 0 | 1 | 2 | 3 {
  if (px >= LOD_PX[0]) return 0;
  if (px >= LOD_PX[1]) return 1;
  if (px >= LOD_PX[2]) return 2;
  return 3;
}

/** World tile must cover this many screen pixels before inner-tile streets are drawn. */
export const CHUNK_SCREEN_PX = 48;

export function chunkDetailWanted(scale: number, tile = TILE): boolean {
  return scale * tile >= CHUNK_SCREEN_PX;
}

export const MIP_FACTORS = [1, 2, 4, 8] as const;

/** Largest downsample that is still at least as fine as the on-screen tile. */
export function mipFactorFor(
  sourcePx: number,
  destPx: number,
  factors: readonly number[] = MIP_FACTORS,
): number {
  const needed = sourcePx / Math.max(1, destPx);
  let best = 0;
  for (const factor of factors) {
    if (factor <= needed + 1e-6 && factor > best) best = factor;
  }
  if (best > 0) return best;
  return factors.reduce((min, factor) => Math.min(min, factor), factors[0] ?? 1);
}

export function nonBlack(
  r: number,
  g: number,
  b: number,
  fallback: readonly [number, number, number],
): [number, number, number] {
  if (r + g + b < 18) return [fallback[0], fallback[1], fallback[2]];
  return [r, g, b];
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface GroundPalette {
  /** RGB triples indexed by biome id. */
  ground: Uint8Array;
  road: Rgb;
}

export function solidPalette(biomeCount: number, land: Rgb, road: Rgb, water: Rgb): GroundPalette {
  const ground = new Uint8Array(Math.max(1, biomeCount) * 3);
  for (let biome = 0; biome < biomeCount; biome++) {
    const src = biome === Biome.Water ? water : land;
    ground[biome * 3] = src.r;
    ground[biome * 3 + 1] = src.g;
    ground[biome * 3 + 2] = src.b;
  }
  return { ground, road };
}

/** Average colour of one source tile, with a land fallback when the sample is empty. */
export function averageTileColor(
  source: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  fallback: readonly [number, number, number] = [127, 175, 114],
): [number, number, number] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx || sw < 1 || sh < 1) return [fallback[0], fallback[1], fallback[2]];
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 1, 1);
  const px = ctx.getImageData(0, 0, 1, 1).data;
  return nonBlack(px[0] ?? 0, px[1] ?? 0, px[2] ?? 0, fallback);
}

/** One world tile per texel. A 16× world is a few dozen megabytes, not a full-res atlas. */
export const FAR_BLOCK = 256;

interface FarBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  canvas: HTMLCanvasElement | null;
  pixels: Uint8ClampedArray;
}

/**
 * Lazy 1:1 downsample of the detailed ground: each world tile's colour is the
 * average of its skin tile, and a path tile keeps the road colour.
 * The coarse kingdom bake stays on screen only where a block is not ready.
 */
export class FarSheet {
  private palette: GroundPalette;
  private readonly blocks = new Map<string, FarBlock>();
  private pending: Array<Omit<FarBlock, 'canvas' | 'pixels'>> = [];
  private worldKey = '';
  private planned = false;
  bytes = 0;

  constructor(palette: GroundPalette) {
    this.palette = palette;
  }

  setPalette(palette: GroundPalette): void {
    this.palette = palette;
    this.clear();
  }

  clear(): void {
    this.blocks.clear();
    this.pending = [];
    this.worldKey = '';
    this.planned = false;
    this.bytes = 0;
  }

  get ready(): boolean {
    return this.planned && this.pending.length === 0;
  }

  blockCount(world: WorldData): number {
    return Math.ceil(world.width / FAR_BLOCK) * Math.ceil(world.height / FAR_BLOCK);
  }

  /** Paint the closest unfinished blocks until the budget runs out. */
  step(world: WorldData, focusX: number, focusY: number, budgetMs: number): boolean {
    this.plan(world);
    const started = performance.now();
    let painted = 0;
    while (this.pending.length > 0 && (painted === 0 || performance.now() - started < budgetMs)) {
      const index = this.closest(focusX, focusY);
      const spec = this.pending[index];
      if (!spec) break;
      this.pending.splice(index, 1);
      this.paint(world, spec);
      painted += 1;
    }
    return this.pending.length === 0;
  }

  colorAt(x: number, y: number): Rgb | null {
    const bx = Math.floor(x / FAR_BLOCK) * FAR_BLOCK;
    const by = Math.floor(y / FAR_BLOCK) * FAR_BLOCK;
    const block = this.blocks.get(`${bx},${by}`);
    if (!block) return null;
    const lx = x - block.x;
    const ly = y - block.y;
    if (lx < 0 || ly < 0 || lx >= block.w || ly >= block.h) return null;
    const ctx = block.canvas?.getContext('2d');
    if (ctx) {
      const px = ctx.getImageData(lx, ly, 1, 1).data;
      return { r: px[0] ?? 0, g: px[1] ?? 0, b: px[2] ?? 0 };
    }
    const o = (ly * block.w + lx) * 4;
    return {
      r: block.pixels[o] ?? 0,
      g: block.pixels[o + 1] ?? 0,
      b: block.pixels[o + 2] ?? 0,
    };
  }

  draw(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    camera: CameraState,
    viewW: number,
    viewH: number,
  ): void {
    if (!this.blocks.size) return;
    const scale = Math.max(camera.scale, 1e-6);
    const halfW = viewW / (2 * scale) / TILE + 1;
    const halfH = viewH / (2 * scale) / TILE + 1;
    const viewTilesX = viewW / (scale * TILE);
    const shifts = [0];
    if (viewTilesX < world.width * 0.92) {
      if (camera.x - halfW < 0) shifts.push(-world.width);
      if (camera.x + halfW > world.width) shifts.push(world.width);
    }
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    for (const shift of shifts) {
      const x0 = camera.x - shift - halfW;
      const x1 = camera.x - shift + halfW;
      const y0 = camera.y - halfH;
      const y1 = camera.y + halfH;
      for (const block of this.blocks.values()) {
        if (block.x + block.w <= x0 || block.x >= x1 || block.y + block.h <= y0 || block.y >= y1) {
          continue;
        }
        if (!block.canvas) continue;
        ctx.drawImage(
          block.canvas,
          (block.x + shift) * TILE,
          block.y * TILE,
          block.w * TILE,
          block.h * TILE,
        );
      }
    }
    ctx.imageSmoothingEnabled = smooth;
  }

  private plan(world: WorldData): void {
    const key = `${world.seed}:${world.width}:${world.height}`;
    if (this.planned && key === this.worldKey) return;
    this.blocks.clear();
    this.bytes = 0;
    this.pending = [];
    this.worldKey = key;
    this.planned = true;
    for (let y = 0; y < world.height; y += FAR_BLOCK) {
      for (let x = 0; x < world.width; x += FAR_BLOCK) {
        this.pending.push({
          x,
          y,
          w: Math.min(FAR_BLOCK, world.width - x),
          h: Math.min(FAR_BLOCK, world.height - y),
        });
      }
    }
  }

  private closest(focusX: number, focusY: number): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.pending.length; i++) {
      const block = this.pending[i]!;
      const dx = block.x + block.w * 0.5 - focusX;
      const dy = block.y + block.h * 0.5 - focusY;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private paint(world: WorldData, spec: Omit<FarBlock, 'canvas' | 'pixels'>): void {
    const width = Math.max(1, spec.w);
    const height = Math.max(1, spec.h);
    const data = new Uint8ClampedArray(width * height * 4);
    const ground = this.palette.ground;
    const road = this.palette.road;
    const fallback = nonBlack(0, 0, 0, [127, 175, 114]);
    for (let ly = 0; ly < spec.h; ly++) {
      const wy = spec.y + ly;
      if (wy < 0 || wy >= world.height) continue;
      const row = wy * world.width;
      for (let lx = 0; lx < spec.w; lx++) {
        const wx = spec.x + lx;
        if (wx < 0 || wx >= world.width) continue;
        const index = row + wx;
        const biome = world.biomes[index] ?? Biome.Plains;
        const o = (ly * width + lx) * 4;
        if ((world.paths[index] ?? 0) > 0 && biome !== Biome.Water) {
          data[o] = road.r;
          data[o + 1] = road.g;
          data[o + 2] = road.b;
        } else {
          const p = biome * 3;
          const rgb = nonBlack(ground[p] ?? 0, ground[p + 1] ?? 0, ground[p + 2] ?? 0, fallback);
          data[o] = rgb[0];
          data[o + 1] = rgb[1];
          data[o + 2] = rgb[2];
        }
        data[o + 3] = 255;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const image = ctx.createImageData(width, height);
      image.data.set(data);
      ctx.putImageData(image, 0, 0);
    }
    this.blocks.set(`${spec.x},${spec.y}`, {
      ...spec,
      canvas: ctx ? canvas : null,
      pixels: ctx ? new Uint8ClampedArray(0) : data,
    });
    this.bytes += width * height * 4;
  }
}
