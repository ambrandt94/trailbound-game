import type { ChunkData, WorldData } from '../../core/world/models';
import { Biome } from '../../core/world/models';
import { DIRT_EDGE_BASE, EDGE_INDEX, SANDSTONE_ROAD } from './biome-table';
import { pickCell } from './terrain-pick';

const TILE = 48;
const COLS = 16;

export interface TrailboundImages {
  atlas: HTMLImageElement;
  mask: HTMLImageElement;
  deep: HTMLImageElement[];
  shallow: HTMLImageElement[];
  foam: HTMLImageElement[];
  wetBand: HTMLImageElement;
  bankGrass: HTMLImageElement;
  bankMud: HTMLImageElement;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export class TrailboundTiles {
  readonly tiles: HTMLCanvasElement[] = [];
  readonly masks: HTMLCanvasElement[] = [];
  readonly tileData: ImageData[] = [];
  readonly maskData: ImageData[] = [];
  waterMask: HTMLCanvasElement | null = null;
  step = 1;
  frame = 0;
  private readonly scratch: HTMLCanvasElement;
  private readonly scratchCtx: CanvasRenderingContext2D;

  constructor(private readonly images: TrailboundImages) {
    this.tiles = sliceSheet(images.atlas, COLS, 6, TILE);
    this.masks = sliceSheet(images.mask, 12, 1, TILE);
    this.tileData = this.tiles.map((canvas) => readData(canvas));
    this.maskData = this.masks.map((canvas) => readData(canvas));
    this.scratch = document.createElement('canvas');
    this.scratch.width = TILE;
    this.scratch.height = TILE;
    const ctx = this.scratch.getContext('2d');
    if (!ctx) throw new Error('trailbound scratch canvas unavailable');
    this.scratchCtx = ctx;
  }

  waterFrame(kind: 'deep' | 'shallow'): HTMLImageElement | null {
    const list = kind === 'deep' ? this.images.deep : this.images.shallow;
    return list[this.frame % Math.max(1, list.length)] ?? list[0] ?? null;
  }

  bakeWorld(world: WorldData, maxCells = 384): HTMLCanvasElement {
    const step = divisorStep(world.width, maxCells);
    this.step = step;
    const cols = Math.ceil(world.width / step);
    const rows = Math.ceil(world.height / step);
    const stamp = 16;
    const canvas = document.createElement('canvas');
    canvas.width = cols * stamp;
    canvas.height = rows * stamp;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.imageSmoothingEnabled = false;
    const biomes = new Uint8Array(cols * rows);
    const water = new Uint8Array(cols * rows);
    const paths = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const sample = sampleCell(world, cx, cy, step);
        const i = cx + cy * cols;
        biomes[i] = sample.center;
        paths[i] = sample.path;
        water[i] = sample.center === Biome.Water ? 1 : 0;
      }
    }
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        this.paintCell(ctx, world, cx, cy, step, stamp, biomes, water, paths, cols, rows);
      }
    }
    this.waterMask = maskCanvas(water, cols, rows);
    return canvas;
  }

  /** One atlas tile per world tile, for the visible window above kingdom zoom. */
  bakeRegion(
    world: WorldData,
    x0: number,
    y0: number,
    span: number,
    stamp: number,
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, span * stamp);
    canvas.height = Math.max(1, span * stamp);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.imageSmoothingEnabled = false;
    const biomeAt = (x: number, y: number): number => {
      if (y < 0 || y >= world.height) return Biome.Water;
      const wx = ((x % world.width) + world.width) % world.width;
      return world.biomes[wx + y * world.width] ?? Biome.Water;
    };
    const pathAt = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
      return world.paths[x + y * world.width] === 1;
    };
    for (let y = 0; y < span; y++) {
      const wy = y0 + y;
      if (wy < 0 || wy >= world.height) continue;
      for (let x = 0; x < span; x++) {
        const wx = x0 + x;
        const center = biomeAt(wx, wy);
        const north = biomeAt(wx, wy - 1) === Biome.Water;
        const east = biomeAt(wx + 1, wy) === Biome.Water;
        const south = biomeAt(wx, wy + 1) === Biome.Water;
        const west = biomeAt(wx - 1, wy) === Biome.Water;
        const open = center === Biome.Water && north && east && south && west;
        const pick = pickCell(
          [center, biomeAt(wx + 1, wy), biomeAt(wx + 1, wy + 1), biomeAt(wx, wy + 1)],
          wx,
          wy,
          world.seed,
          center === Biome.Water,
          open,
        );
        const dx = x * stamp;
        const dy = y * stamp;
        this.blitPick(ctx, pick, dx, dy, stamp);
        if (pathAt(wx, wy) && center !== Biome.Water) {
          this.blitRoad(
            ctx,
            pathAt(wx, wy - 1),
            pathAt(wx + 1, wy),
            pathAt(wx, wy + 1),
            pathAt(wx - 1, wy),
            dx,
            dy,
            stamp,
          );
        }
        this.blitShores(
          ctx,
          center === Biome.Water,
          [north, east, south, west],
          dx,
          dy,
          stamp,
          center,
        );
      }
    }
    return canvas;
  }

  bakeChunk(chunk: ChunkData, world: WorldData): HTMLCanvasElement {
    const stamp = TILE;
    const size = chunk.size;
    const canvas = document.createElement('canvas');
    canvas.width = size * stamp;
    canvas.height = size * stamp;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.imageSmoothingEnabled = false;
    const at = (lx: number, ly: number): number => {
      if (lx >= 0 && ly >= 0 && lx < size && ly < size) {
        return chunk.tiles[lx + ly * size] ?? Biome.Plains;
      }
      const wx = chunk.wx + (lx < 0 ? -1 : lx >= size ? 1 : 0);
      const wy = chunk.wy + (ly < 0 ? -1 : ly >= size ? 1 : 0);
      if (wx < 0 || wy < 0 || wx >= world.width || wy >= world.height) return Biome.Water;
      return world.biomes[wx + wy * world.width] ?? Biome.Water;
    };
    for (let ly = 0; ly < size; ly++) {
      for (let lx = 0; lx < size; lx++) {
        const center = at(lx, ly);
        const nw = at(lx, ly);
        const ne = at(lx + 1, ly);
        const se = at(lx + 1, ly + 1);
        const sw = at(lx, ly + 1);
        const neighbors = [at(lx, ly - 1), at(lx + 1, ly), at(lx, ly + 1), at(lx - 1, ly)];
        const open = center === Biome.Water && neighbors.every((biome) => biome === Biome.Water);
        const pick = pickCell(
          [nw, ne, se, sw],
          chunk.wx * size + lx,
          chunk.wy * size + ly,
          world.seed,
          center === Biome.Water,
          open,
        );
        this.blitPick(ctx, pick, lx * stamp, ly * stamp, stamp);
        const path = chunk.paths[lx + ly * size] === 1 && center !== Biome.Water;
        if (path) {
          const pn = ly > 0 && chunk.paths[lx + (ly - 1) * size] === 1;
          const pe = lx + 1 < size && chunk.paths[lx + 1 + ly * size] === 1;
          const ps = ly + 1 < size && chunk.paths[lx + (ly + 1) * size] === 1;
          const pw = lx > 0 && chunk.paths[lx - 1 + ly * size] === 1;
          this.blitRoad(ctx, pn, pe, ps, pw, lx * stamp, ly * stamp, stamp);
        }
        this.blitShores(
          ctx,
          center === Biome.Water,
          neighbors.map((biome) => biome === Biome.Water) as [boolean, boolean, boolean, boolean],
          lx * stamp,
          ly * stamp,
          stamp,
          center,
        );
      }
    }
    return canvas;
  }

  private paintCell(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    cx: number,
    cy: number,
    step: number,
    stamp: number,
    biomes: Uint8Array,
    water: Uint8Array,
    paths: Uint8Array,
    cols: number,
    rows: number,
  ): void {
    const center = biomes[cx + cy * cols] ?? Biome.Water;
    const at = (x: number, y: number): number => {
      if (y < 0 || y >= rows) return Biome.Water;
      const wx = ((x % cols) + cols) % cols;
      return biomes[wx + y * cols] ?? Biome.Water;
    };
    const nw = center;
    const ne = at(cx + 1, cy);
    const se = at(cx + 1, cy + 1);
    const sw = at(cx, cy + 1);
    const n = at(cx, cy - 1) === Biome.Water;
    const e = at(cx + 1, cy) === Biome.Water;
    const s = at(cx, cy + 1) === Biome.Water;
    const w = at(cx - 1, cy) === Biome.Water;
    const open = center === Biome.Water && n && e && s && w;
    const pick = pickCell([nw, ne, se, sw], cx, cy, world.seed, center === Biome.Water, open);
    this.blitPick(ctx, pick, cx * stamp, cy * stamp, stamp);
    if (paths[cx + cy * cols] && center !== Biome.Water) {
      const pn = cy > 0 && paths[cx + (cy - 1) * cols] === 1;
      const pe = paths[((cx + 1) % cols) + cy * cols] === 1;
      const ps = cy + 1 < rows && paths[cx + (cy + 1) * cols] === 1;
      const pw = paths[((cx - 1 + cols) % cols) + cy * cols] === 1;
      this.blitRoad(ctx, pn, pe, ps, pw, cx * stamp, cy * stamp, stamp);
    }
    this.blitShores(
      ctx,
      center === Biome.Water,
      [n, e, s, w],
      cx * stamp,
      cy * stamp,
      stamp,
      center,
    );
  }

  private blitPick(
    ctx: CanvasRenderingContext2D,
    pick: ReturnType<typeof pickCell>,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    if (pick.mask) {
      this.blitMask(
        pick.atlasId,
        pick.mask.bgId,
        pick.mask.maskIndex,
        pick.mask.rim,
        dx,
        dy,
        stamp,
        ctx,
      );
    } else {
      this.blitTile(ctx, pick.atlasId, dx, dy, stamp);
    }
    if (pick.water !== 'none') {
      const img = this.waterFrame(pick.water);
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, dx, dy, stamp, stamp);
      }
    }
  }

  private blitTile(
    ctx: CanvasRenderingContext2D,
    id: number,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    const tile = this.tiles[id] ?? this.tiles[0];
    if (!tile) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, dx, dy, stamp, stamp);
  }

  private blitMask(
    fgId: number,
    bgId: number,
    maskIndex: number,
    rim: { lit: string; shaded: string; shadow: string },
    dx: number,
    dy: number,
    stamp: number,
    ctx: CanvasRenderingContext2D,
  ): void {
    const fg = this.tileData[fgId] ?? this.tileData[0];
    const bg = this.tileData[bgId] ?? this.tileData[0];
    const mask = this.maskData[maskIndex] ?? this.maskData[0];
    if (!fg || !bg || !mask) {
      this.blitTile(ctx, fgId, dx, dy, stamp);
      return;
    }
    const out = this.scratchCtx.createImageData(TILE, TILE);
    const lit = rgb(rim.lit);
    const shaded = rgb(rim.shaded);
    const shadow = rgb(rim.shadow);
    const fd = fg.data;
    const bd = bg.data;
    const md = mask.data;
    const od = out.data;
    for (let i = 0; i < TILE * TILE; i++) {
      const m = md[i * 4] ?? 0;
      const o = i * 4;
      const src = m >= 224 ? fd : m === 0 ? bd : null;
      if (src) {
        od[o] = src[o] ?? 0;
        od[o + 1] = src[o + 1] ?? 0;
        od[o + 2] = src[o + 2] ?? 0;
        od[o + 3] = 255;
      } else {
        const tone = m >= 160 ? lit : m >= 96 ? shaded : shadow;
        od[o] = tone.r;
        od[o + 1] = tone.g;
        od[o + 2] = tone.b;
        od[o + 3] = 255;
      }
    }
    this.scratchCtx.putImageData(out, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.scratch, dx, dy, stamp, stamp);
  }

  private blitRoad(
    ctx: CanvasRenderingContext2D,
    n: boolean,
    e: boolean,
    s: boolean,
    w: boolean,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    const bits = (n ? 8 : 0) | (e ? 4 : 0) | (s ? 2 : 0) | (w ? 1 : 0);
    if (bits === 15 || bits === 0) {
      this.blitTile(ctx, SANDSTONE_ROAD, dx, dy, stamp);
      return;
    }
    const edge = EDGE_INDEX.get(bits);
    this.blitTile(ctx, edge === undefined ? SANDSTONE_ROAD : DIRT_EDGE_BASE + edge, dx, dy, stamp);
  }

  private blitShores(
    ctx: CanvasRenderingContext2D,
    water: boolean,
    neighbors: [boolean, boolean, boolean, boolean],
    dx: number,
    dy: number,
    stamp: number,
    center: number,
  ): void {
    if (water) return;
    const [n, e, s, w] = neighbors;
    const band =
      stamp >= 32 ? Math.max(8, Math.round(stamp / 5)) : Math.max(3, Math.round(stamp / 4));
    const foam =
      this.images.foam[this.frame % Math.max(1, this.images.foam.length)] ?? this.images.foam[0];
    const bank =
      center === Biome.Marsh || center === Biome.Sand ? this.images.bankMud : this.images.bankGrass;
    const wet = this.images.wetBand;
    if (n && foam) drawRibbon(ctx, foam, dx, dy, stamp, band, 'n');
    if (s && foam) drawRibbon(ctx, wet, dx, dy, stamp, band, 's');
    if (w && bank) drawRibbon(ctx, bank, dx, dy, stamp, band, 'w');
    if (e && bank) drawRibbon(ctx, this.images.wetBand, dx, dy, stamp, band, 'e');
  }
}

export async function loadTrailbound(base: string): Promise<TrailboundTiles> {
  const root = `${base}assets/map/trailbound48/`;
  const water = `${root}water/`;
  const [atlas, mask, ...frames] = await Promise.all([
    loadImage(`${root}atlas_terrain.png`),
    loadImage(`${root}atlas_edgemask.png`),
    loadImage(`${water}water_deep_128_f0.png`),
    loadImage(`${water}water_deep_128_f1.png`),
    loadImage(`${water}water_deep_128_f2.png`),
    loadImage(`${water}water_deep_128_f3.png`),
    loadImage(`${water}water_shallow_128_f0.png`),
    loadImage(`${water}water_shallow_128_f1.png`),
    loadImage(`${water}water_shallow_128_f2.png`),
    loadImage(`${water}water_shallow_128_f3.png`),
    loadImage(`${water}shore_foam_64x16.png`),
    loadImage(`${water}shore_foam_64x16_f1.png`),
    loadImage(`${water}shore_wet_band_64x16.png`),
    loadImage(`${water}bank_grass_64x16.png`),
    loadImage(`${water}bank_mud_64x16.png`),
  ]);
  if (!atlas || !mask) throw new Error('trailbound atlas missing');
  return new TrailboundTiles({
    atlas,
    mask,
    deep: frames.slice(0, 4),
    shallow: frames.slice(4, 8),
    foam: frames.slice(8, 10),
    wetBand: frames[10]!,
    bankGrass: frames[11]!,
    bankMud: frames[12]!,
  });
}

function sampleCell(
  world: WorldData,
  cx: number,
  cy: number,
  step: number,
): { center: number; path: number } {
  const x0 = cx * step;
  const y0 = cy * step;
  const x1 = Math.min(world.width, x0 + step);
  const y1 = Math.min(world.height, y0 + step);
  const counts = new Uint16Array(15);
  let pathN = 0;
  let landN = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const biome = world.biomes[x + y * world.width] ?? Biome.Water;
      counts[biome] = (counts[biome] ?? 0) + 1;
      if (biome !== Biome.Water) {
        landN++;
        if (world.paths[x + y * world.width]) pathN++;
      }
    }
  }
  let best = Biome.Water;
  let bestN = -1;
  for (let b = 0; b < counts.length; b++) {
    const n = counts[b] ?? 0;
    if (n > bestN) {
      bestN = n;
      best = b;
    }
  }
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  if ((counts[Biome.Water] ?? 0) / area >= 0.22) best = Biome.Water;
  return { center: best, path: landN && pathN / Math.max(1, landN) > 0.08 ? 1 : 0 };
}

function maskCanvas(water: Uint8Array, cols: number, rows: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.createImageData(cols, rows);
  for (let i = 0; i < water.length; i++) {
    const o = i * 4;
    const on = water[i] === 1;
    img.data[o] = 255;
    img.data[o + 1] = 255;
    img.data[o + 2] = 255;
    img.data[o + 3] = on ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function divisorStep(width: number, maxCells: number): number {
  const minStep = Math.max(1, Math.ceil(width / maxCells));
  for (let s = minStep; s <= width; s++) {
    if (width % s === 0) return s;
  }
  return minStep;
}

function sliceSheet(
  image: HTMLImageElement,
  cols: number,
  rows: number,
  tile: number,
): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const canvas = document.createElement('canvas');
      canvas.width = tile;
      canvas.height = tile;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, col * tile, row * tile, tile, tile, 0, 0, tile, tile);
      out.push(canvas);
    }
  }
  return out;
}

function readData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('missing 2d context');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function drawRibbon(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  stamp: number,
  band: number,
  side: 'n' | 'e' | 's' | 'w',
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (side === 'n') ctx.drawImage(image, x, y, stamp, band);
  else if (side === 's') ctx.drawImage(image, x, y + stamp - band, stamp, band);
  else if (side === 'w') {
    ctx.translate(x + band, y);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, 0, 0, stamp, band);
  } else {
    ctx.translate(x + stamp, y + band);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, 0, -band, stamp, band);
  }
  ctx.restore();
}

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}
