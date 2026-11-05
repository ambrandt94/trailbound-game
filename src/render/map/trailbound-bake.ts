import type { ChunkData, WorldData } from '../../core/world/models';
import { Biome } from '../../core/world/models';
import { BIOME_GROUND, DIRT_EDGE_BASE, EDGE_INDEX, SANDSTONE_ROAD } from './biome-table';
import { cellCorners, foamRuns, pickCell, waterBand, type FoamRun } from './terrain-pick';

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

export interface ShoreMark {
  lx: number;
  ly: number;
  bits: number;
}

export interface WaterMark {
  lx: number;
  ly: number;
  kind: 'shallow' | 'deep';
}

export interface RegionBake {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  shores: ShoreMark[];
  waters: WaterMark[];
}

type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface OverviewJob {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  cols: number;
  rows: number;
  step: number;
  stamp: number;
  row: number;
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
  private flatColorCache: string[] | null = null;

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

  /**
   * Flat biome colours, one cell per few dozen tiles. This is the first paint;
   * textured rows replace it while the game is idle.
   */
  bakeFast(world: WorldData, maxCells = 128): OverviewJob {
    const step = divisorStep(world.width, maxCells);
    this.step = step;
    const cols = Math.ceil(world.width / step);
    const rows = Math.ceil(world.height / step);
    const stamp = 8;
    const canvas = makeCanvas(cols * stamp, rows * stamp);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { canvas, cols, rows, step, stamp, row: rows };
    ctx.imageSmoothingEnabled = false;
    const colors = this.flatColors();
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const biome =
          world.biomes[sampleX(cx, step) + sampleY(cy, step, world.height) * world.width] ?? 0;
        ctx.fillStyle = colors[biome] ?? colors[2] ?? '#7faf72';
        ctx.fillRect(cx * stamp, cy * stamp, stamp, stamp);
      }
    }
    return { canvas, cols, rows, step, stamp, row: 0 };
  }

  /** Replace one overview row of flat colour with the nearest 48 px ground tile. */
  paintOverviewRow(world: WorldData, job: OverviewJob): void {
    if (job.row >= job.rows) return;
    const ctx = job.canvas.getContext('2d');
    if (!ctx) {
      job.row = job.rows;
      return;
    }
    ctx.imageSmoothingEnabled = false;
    const cy = job.row;
    for (let cx = 0; cx < job.cols; cx++) {
      const wx = Math.min(world.width - 1, cx * job.step + (job.step >> 1));
      const wy = Math.min(world.height - 1, cy * job.step + (job.step >> 1));
      const biome = world.biomes[wx + wy * world.width] ?? Biome.Water;
      const dx = cx * job.stamp;
      const dy = cy * job.stamp;
      if (biome === Biome.Water) {
        const kind = waterBand((x, y) => this.biomeAt(world, x, y), wx, wy);
        const img = this.waterFrame(kind);
        if (img) ctx.drawImage(img, dx, dy, job.stamp, job.stamp);
      } else {
        const pick = pickCell([biome, biome, biome, biome], cx, cy, world.seed, 'none');
        this.blitTile(ctx, pick.atlasId, dx, dy, job.stamp);
      }
    }
    job.row += 1;
  }

  /** One 48 px atlas tile per world tile, for the visible window above kingdom zoom. */
  bakeRegion(world: WorldData, x0: number, y0: number, span: number, stamp: number): RegionBake {
    const canvas = makeCanvas(Math.max(1, span * stamp), Math.max(1, span * stamp));
    const ctx = canvas.getContext('2d');
    const shores: ShoreMark[] = [];
    const waters: WaterMark[] = [];
    if (!ctx) return { canvas, shores, waters };
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#3c808e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const at = (x: number, y: number) => this.biomeAt(world, x, y);
    for (let y = 0; y < span; y++) {
      const wy = y0 + y;
      if (wy < 0 || wy >= world.height) continue;
      for (let x = 0; x < span; x++) {
        const wx = x0 + x;
        this.paintWorldTile(
          ctx,
          world,
          at,
          wx,
          wy,
          x * stamp,
          y * stamp,
          stamp,
          shores,
          waters,
          x,
          y,
        );
      }
    }
    return { canvas, shores, waters };
  }

  /** Foam and the current water frame, in the region's 48 px tile space. */
  paintOverlays(
    ctx: DrawCtx,
    shores: readonly ShoreMark[],
    waters: readonly WaterMark[],
    stamp: number,
  ): void {
    ctx.imageSmoothingEnabled = false;
    for (const water of waters) {
      const img = this.waterFrame(water.kind);
      if (!img) continue;
      ctx.drawImage(img, water.lx * stamp, water.ly * stamp, stamp, stamp);
    }
    const foam =
      this.images.foam[this.frame % Math.max(1, this.images.foam.length)] ?? this.images.foam[0];
    const wet = this.images.wetBand;
    if (!foam) return;
    for (const shore of shores) {
      for (const run of foamRuns(shore.bits)) {
        drawRun(ctx, foam, shore.lx * stamp, shore.ly * stamp, stamp, run);
        if (wet) drawRun(ctx, wet, shore.lx * stamp, shore.ly * stamp, stamp, run, 0.35);
      }
    }
  }

  bakeChunk(chunk: ChunkData, world: WorldData): HTMLCanvasElement | OffscreenCanvas {
    const stamp = TILE;
    const size = chunk.size;
    const canvas = makeCanvas(size * stamp, size * stamp);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.imageSmoothingEnabled = false;
    const at = (lx: number, ly: number): number => {
      if (lx >= 0 && ly >= 0 && lx < size && ly < size) {
        return chunk.tiles[lx + ly * size] ?? Biome.Plains;
      }
      const wx = chunk.wx + (lx < 0 ? -1 : lx >= size ? 1 : 0);
      const wy = chunk.wy + (ly < 0 ? -1 : ly >= size ? 1 : 0);
      return this.biomeAt(world, wx, wy);
    };
    const shores: ShoreMark[] = [];
    const waters: WaterMark[] = [];
    for (let ly = 0; ly < size; ly++) {
      for (let lx = 0; lx < size; lx++) {
        this.paintWorldTile(
          ctx,
          world,
          at,
          lx,
          ly,
          lx * stamp,
          ly * stamp,
          stamp,
          shores,
          waters,
          lx,
          ly,
          false,
        );
        const center = at(lx, ly);
        if (chunk.paths[lx + ly * size] === 1 && center !== Biome.Water) {
          const pn = ly > 0 && chunk.paths[lx + (ly - 1) * size] === 1;
          const pe = lx + 1 < size && chunk.paths[lx + 1 + ly * size] === 1;
          const ps = ly + 1 < size && chunk.paths[lx + (ly + 1) * size] === 1;
          const pw = lx > 0 && chunk.paths[lx - 1 + ly * size] === 1;
          this.blitRoad(ctx, pn, pe, ps, pw, lx * stamp, ly * stamp, stamp);
        }
      }
    }
    this.paintOverlays(ctx, shores, waters, stamp);
    return canvas;
  }

  private paintWorldTile(
    ctx: DrawCtx,
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stamp: number,
    shores: ShoreMark[],
    waters: WaterMark[],
    lx: number,
    ly: number,
    roads = true,
  ): void {
    const corners = cellCorners(at, x, y);
    const center = at(x, y);
    const mixed =
      corners[0] !== corners[1] || corners[1] !== corners[2] || corners[2] !== corners[3];
    const band = center === Biome.Water && !mixed ? waterBand(at, x, y) : 'none';
    const pick = pickCell(corners, x, y, world.seed, band);
    this.blitPick(ctx, pick, dx, dy, stamp);
    if (center === Biome.Water && !mixed) {
      waters.push({ lx, ly, kind: band === 'deep' ? 'deep' : 'shallow' });
    }
    const landAndWater =
      corners.some((corner) => corner === Biome.Water) &&
      corners.some((corner) => corner !== Biome.Water);
    if (landAndWater && pick.landBits !== 0 && pick.landBits !== 15) {
      shores.push({ lx, ly, bits: pick.landBits });
    }
    if (roads && this.pathAt(world, x, y) && center !== Biome.Water && !mixed) {
      this.blitRoad(
        ctx,
        this.pathAt(world, x, y - 1),
        this.pathAt(world, x + 1, y),
        this.pathAt(world, x, y + 1),
        this.pathAt(world, x - 1, y),
        dx,
        dy,
        stamp,
      );
    }
  }

  private biomeAt(world: WorldData, x: number, y: number): number {
    if (y < 0 || y >= world.height) return Biome.Water;
    const wx = ((x % world.width) + world.width) % world.width;
    return world.biomes[wx + y * world.width] ?? Biome.Water;
  }

  private pathAt(world: WorldData, x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) return false;
    return world.paths[x + y * world.width] === 1;
  }

  private flatColors(): string[] {
    if (this.flatColorCache) return this.flatColorCache;
    const colors: string[] = [];
    for (let biome = 0; biome < BIOME_GROUND.length; biome++) {
      const id = BIOME_GROUND[biome]?.atlas[0] ?? 0;
      const data = this.tileData[id];
      const pixel = (24 + 24 * TILE) * 4;
      const r = data?.data[pixel] ?? 120;
      const g = data?.data[pixel + 1] ?? 150;
      const b = data?.data[pixel + 2] ?? 90;
      colors.push(`rgb(${r}, ${g}, ${b})`);
    }
    this.flatColorCache = colors;
    return colors;
  }

  private blitPick(
    ctx: DrawCtx,
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
  }

  private blitTile(ctx: DrawCtx, id: number, dx: number, dy: number, stamp: number): void {
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
    ctx: DrawCtx,
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
      const m = quantizeMask(md[i * 4] ?? 0);
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
    ctx: DrawCtx,
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

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      /* The document canvas is the fallback when OffscreenCanvas rejects the size. */
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function quantizeMask(value: number): number {
  if (value >= 224) return 255;
  if (value >= 160) return 192;
  if (value >= 96) return 128;
  if (value >= 32) return 64;
  return 0;
}

function sampleX(cx: number, step: number): number {
  return cx * step + (step >> 1);
}

function sampleY(cy: number, step: number, height: number): number {
  return Math.min(height - 1, cy * step + (step >> 1));
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

function drawRun(
  ctx: DrawCtx,
  image: HTMLImageElement,
  dx: number,
  dy: number,
  stamp: number,
  run: FoamRun,
  shift = 0,
): void {
  const thick = Math.max(4, Math.round(stamp / 7));
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (run.axis === 'h') {
    const y = dy + (run.v + shift) * stamp - thick / 2;
    ctx.drawImage(image, dx + run.u * stamp, y, run.len * stamp, thick);
  } else {
    ctx.translate(dx + (run.u + shift) * stamp, dy + run.v * stamp);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(image, 0, -thick / 2, run.len * stamp, thick);
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
