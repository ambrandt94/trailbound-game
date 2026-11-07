import type { ChunkData, WorldData } from '../../core/world/models';
import { BIOME_COUNT, Biome, TILE as WORLD_TILE } from '../../core/world/models';
import { hash2 } from '../../core/world/noise';
import { BIOME_GROUND, SANDSTONE_ROAD } from './biome-table';
import { areaReduce, mipForScreenPx, orientedTexel, snowRotation, spanForMip } from './art-mip';
import { averageTileColor, type GroundPalette } from './detail-lod';
import { foamRuns, pickCell, waterBand, type FoamRun } from './terrain-pick';
import {
  FIELD_REACH,
  SUBCELLS,
  authoredEdge,
  classifyInto,
  displaced,
  sampleFieldInto,
  tileVariant,
  type FieldSample,
  type TileVariant,
} from './terrain-field';
import {
  averageOpaque,
  compositeRoadStraight,
  ownerTile,
  resolveRoad,
  resolveTile,
  waterBandSeam,
  waterKindAt,
  type Adj,
} from './tile-fill';

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
  ox: number;
  oy: number;
  flipX: boolean;
  flipY: boolean;
}

/** Foam along a curved shore. The water pixels themselves are already in the region. */
export interface CurvePatch {
  lx: number;
  ly: number;
  foam: readonly [CanvasImageSource, CanvasImageSource] | null;
}

export interface RegionBake {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  shores: ShoreMark[];
  waters: WaterMark[];
  curves: CurvePatch[];
  /** World origin of this region. */
  x0: number;
  y0: number;
  span: number;
  stamp: number;
  /** Next row to paint. Equal to span when the region is finished. */
  row: number;
  /** Next column inside the current row. */
  col: number;
  rowImage: ImageData | null;
  flats: Array<{
    x: number;
    y: number;
    biome: number;
    dx: number;
    dy: number;
    lx: number;
    ly: number;
    kind?: 'shallow' | 'deep';
  }>;
}

type DrawCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface SheetShift {
  ox: number;
  oy: number;
  flipX: boolean;
  flipY: boolean;
}

interface FlatJob {
  x: number;
  y: number;
  biome: number;
  dx: number;
  dy: number;
  lx: number;
  ly: number;
  kind?: 'shallow' | 'deep';
}

export interface OverviewJob {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  cols: number;
  rows: number;
  step: number;
  stamp: number;
  row: number;
}

interface MipJob {
  x: number;
  y: number;
  span: number;
  px: number;
  row: number;
  col: number;
  data: Uint8ClampedArray;
  canvas: HTMLCanvasElement | null;
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
  private readonly fieldOut: FieldSample = { biome: 0, base: 0 };
  private readonly cornerBiome = new Uint8Array((SUBCELLS + 3) * (SUBCELLS + 3));
  private readonly cornerBase = new Uint8Array((SUBCELLS + 3) * (SUBCELLS + 3));
  private readonly pixBiome = new Uint8Array(TILE * TILE);
  private readonly pixBase = new Uint8Array(TILE * TILE);
  private readonly pixDist = new Uint8Array(TILE * TILE);
  private readonly warpX = new Float32Array(9 * 9);
  private readonly warpY = new Float32Array(9 * 9);
  private regionPixels: Uint8ClampedArray | null = null;
  private regionStride = 0;
  private tileImage: ImageData | null = null;
  private foamPixels: ImageData[] | null = null;
  private waterPixels: { deep: ImageData[]; shallow: ImageData[] } | null = null;
  /** Derived transitions. Never written back onto the authored atlas. */
  private readonly derived = new Map<string, HTMLCanvasElement>();
  /** Whole world, one texel per tile, box-reduced from the real 48px art. */
  coarseMip: HTMLCanvasElement | null = null;
  private readonly repColor = new Map<number, Rgb>();
  private readonly reduced = new Map<string, Uint8ClampedArray>();
  private readonly mipJobs = new Map<string, MipJob>();
  private readonly tileCanvas: HTMLCanvasElement;
  private readonly tileCtx: CanvasRenderingContext2D;

  constructor(private readonly images: TrailboundImages) {
    this.tiles = sliceSheet(images.atlas, COLS, 6, TILE);
    this.masks = sliceSheet(images.mask, 12, 1, TILE);
    this.tileData = this.tiles.map((canvas) => readData(canvas));
    this.maskData = this.masks.map((canvas) => readData(canvas));
    this.scratch = document.createElement('canvas');
    this.scratch.width = TILE;
    this.scratch.height = TILE;
    const ctx = this.scratch.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('trailbound scratch canvas unavailable');
    this.scratchCtx = ctx;
    this.tileCanvas = document.createElement('canvas');
    this.tileCanvas.width = TILE;
    this.tileCanvas.height = TILE;
    const tileCtx = this.tileCanvas.getContext('2d', { willReadFrequently: true });
    if (!tileCtx) throw new Error('trailbound tile canvas unavailable');
    this.tileCtx = tileCtx;
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

  /**
   * Close-zoom terrain. World data stays on the tile grid; the pixels follow
   * a noise-displaced field so coasts and biome borders curve.
   * Painting is spread across frames so the first close view does not stall.
   */
  beginRegion(x0: number, y0: number, span: number, stamp: number): RegionBake {
    const canvas = makeCanvas(Math.max(1, span * stamp), Math.max(1, span * stamp));
    const ctx = canvas.getContext('2d');
    const shores: ShoreMark[] = [];
    const waters: WaterMark[] = [];
    const curves: CurvePatch[] = [];
    let rowImage: ImageData | null = null;
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#3c808e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      rowImage = ctx.createImageData(canvas.width, stamp);
    }
    return {
      canvas,
      shores,
      waters,
      curves,
      x0,
      y0,
      span,
      stamp,
      row: 0,
      col: 0,
      rowImage,
      flats: [],
    };
  }

  /** Paint tiles until the budget runs out. Returns true when the region is finished. */
  stepRegion(world: WorldData, job: RegionBake, budgetMs: number): boolean {
    // One 48px skin at every zoom. The displaced field reads as noise up close,
    // so a region is always whole tiles plus derived edge fills.
    if (job.stamp > 0) return this.stepFlatRegion(world, job, budgetMs);
    const ctx = job.canvas.getContext('2d');
    const rowImage = job.rowImage;
    if (!ctx || !rowImage || job.row >= job.span) return true;
    const started = performance.now();
    const at = (x: number, y: number) => this.biomeAt(world, x, y);
    while (job.row < job.span && performance.now() - started < budgetMs) {
      const wy = job.y0 + job.row;
      if (wy < 0 || wy >= world.height) {
        job.row += 1;
        job.col = 0;
        continue;
      }
      if (job.col === 0) this.clearRow(rowImage.data);
      this.regionPixels = rowImage.data;
      this.regionStride = job.canvas.width;
      const wx = job.x0 + job.col;
      this.paintCurvedTile(
        ctx,
        world,
        at,
        wx,
        wy,
        job.col * job.stamp,
        0,
        job.stamp,
        job.waters,
        job.curves,
        job.flats,
        job.col,
        job.row,
      );
      job.col += 1;
      if (job.col < job.span) continue;
      this.regionPixels = null;
      ctx.putImageData(rowImage, 0, job.row * job.stamp);
      for (const flat of job.flats) {
        this.paintFlat(
          ctx,
          world,
          flat.x,
          flat.y,
          flat.biome,
          flat.dx,
          flat.dy,
          job.stamp,
          flat.kind,
        );
      }
      job.flats.length = 0;
      job.col = 0;
      job.row += 1;
    }
    this.regionPixels = null;
    if (job.row >= job.span) job.rowImage = null;
    return job.row >= job.span;
  }

  /**
   * Same 48 px skin, one blit per world tile. Used below street zoom, where the
   * curved coast field costs more than the tiles can show.
   */
  private stepFlatRegion(world: WorldData, job: RegionBake, budgetMs: number): boolean {
    const ctx = job.canvas.getContext('2d');
    if (!ctx || job.row >= job.span) return true;
    ctx.imageSmoothingEnabled = false;
    const started = performance.now();
    let painted = 0;
    while (job.row < job.span && painted < 24 && performance.now() - started < budgetMs) {
      const wy = job.y0 + job.row;
      while (job.col < job.span && painted < 24 && performance.now() - started < budgetMs) {
        const wx = job.x0 + job.col;
        if (wy >= 0 && wy < world.height && wx >= 0 && wx < world.width) {
          this.paintFlat(
            ctx,
            world,
            wx,
            wy,
            this.biomeAt(world, wx, wy),
            job.col * job.stamp,
            job.row * job.stamp,
            job.stamp,
          );
        }
        job.col += 1;
        painted += 1;
      }
      if (job.col >= job.span) {
        job.col = 0;
        job.row += 1;
      }
    }
    return job.row >= job.span;
  }

  private clearRow(data: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 60;
      data[i + 1] = 128;
      data[i + 2] = 142;
      data[i + 3] = 255;
    }
  }

  /** Foam and the current water frame, in the region's 48 px tile space. */
  paintOverlays(
    ctx: DrawCtx,
    shores: readonly ShoreMark[],
    waters: readonly WaterMark[],
    stamp: number,
    curves: readonly CurvePatch[] = [],
  ): void {
    ctx.imageSmoothingEnabled = false;
    for (const water of waters) {
      const img = this.waterFrame(water.kind);
      if (!img) continue;
      this.blitSheet(ctx, img, water.lx * stamp, water.ly * stamp, stamp, water);
    }
    for (const curve of curves) {
      this.paintCurve(ctx, curve, stamp);
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
    // Neighbours past the chunk edge come from the world tile, not a one-tile stub.
    const at = (lx: number, ly: number): number =>
      this.biomeAt(world, chunk.wx + lx, chunk.wy + ly);
    const roadAt = (lx: number, ly: number): boolean => {
      if (lx >= 0 && ly >= 0 && lx < size && ly < size) {
        return chunk.paths[lx + ly * size] === 1;
      }
      return this.pathAt(world, chunk.wx + lx, chunk.wy + ly);
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
        if (roadAt(lx, ly) && center !== Biome.Water) {
          this.blitRoad(
            ctx,
            roadAt(lx, ly - 1),
            roadAt(lx + 1, ly),
            roadAt(lx, ly + 1),
            roadAt(lx - 1, ly),
            lx * stamp,
            ly * stamp,
            stamp,
          );
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
    _shores: ShoreMark[],
    waters: WaterMark[],
    lx: number,
    ly: number,
    roads = true,
  ): void {
    const center = at(x, y);
    this.paintGround(ctx, world, at, x, y, dx, dy, stamp, roads, center);
    const around = [
      at(x, y - 1),
      at(x + 1, y),
      at(x, y + 1),
      at(x - 1, y),
      at(x - 1, y - 1),
      at(x + 1, y - 1),
      at(x + 1, y + 1),
      at(x - 1, y + 1),
    ];
    if (center === Biome.Water && around.every((biome) => biome === Biome.Water)) {
      const flow = tileVariant(Biome.Water, x, y, world.seed, 128);
      const kind = waterBand(at, x, y);
      waters.push({
        lx,
        ly,
        kind,
        ox: flow.ox,
        oy: flow.oy,
        flipX: flow.flipX,
        flipY: flow.flipY,
      });
    }
  }

  private biomeAt(world: WorldData, x: number, y: number): number {
    if (y < 0 || y >= world.height) return Biome.Water;
    const wx = ((x % world.width) + world.width) % world.width;
    return world.biomes[wx + y * world.width] ?? Biome.Water;
  }

  private pathAt(world: WorldData, x: number, y: number): boolean {
    if (y < 0 || y >= world.height) return false;
    const wx = ((x % world.width) + world.width) % world.width;
    return world.paths[wx + y * world.width] === 1;
  }

  /** One average colour per biome, plus the road tile. Used by the far-zoom sheet. */
  groundPalette(): GroundPalette {
    const ground = new Uint8Array(BIOME_COUNT * 3);
    for (let biome = 0; biome < BIOME_COUNT; biome++) {
      const [r, g, b] = biome === Biome.Water ? this.waterSwatch('deep') : this.landSwatch(biome);
      ground[biome * 3] = r;
      ground[biome * 3 + 1] = g;
      ground[biome * 3 + 2] = b;
    }
    const roadTile = this.tiles[SANDSTONE_ROAD] ?? this.tiles[0];
    const [rr, rg, rb] = roadTile
      ? averageTileColor(roadTile, 0, 0, roadTile.width, roadTile.height, [196, 164, 108])
      : [196, 164, 108];
    return { ground, road: { r: rr, g: rg, b: rb } };
  }

  /** Centre texel of the ground art. Water uses the deep frame, not the wet-sand atlas cell. */
  private landSwatch(biome: number): [number, number, number] {
    const id = BIOME_GROUND[biome]?.atlas[0] ?? 0;
    const data = this.tileData[id];
    return swatchFrom(data?.data, data?.width ?? TILE, data?.height ?? TILE);
  }

  private waterSwatch(kind: 'deep' | 'shallow'): [number, number, number] {
    const img = this.waterFrame(kind);
    if (!img) return kind === 'deep' ? [62, 120, 178] : [74, 158, 178];
    const data = imageDataOf(img);
    return swatchFrom(data.data, data.width, data.height);
  }

  private flatColors(): string[] {
    if (this.flatColorCache) return this.flatColorCache;
    const colors: string[] = [];
    for (let biome = 0; biome < BIOME_GROUND.length; biome++) {
      const [r, g, b] = biome === Biome.Water ? this.waterSwatch('deep') : this.landSwatch(biome);
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
    void rim;
    const fd = fg.data;
    const bd = bg.data;
    const md = mask.data;
    const od = out.data;
    for (let i = 0; i < TILE * TILE; i++) {
      const m = quantizeMask(md[i * 4] ?? 0);
      const o = i * 4;
      const x = i % TILE;
      const y = (i / TILE) | 0;
      const bayer = ((y & 3) * 4 + (x & 3) * 3) & 15;
      const src = m >= 224 || (m > 0 && bayer < Math.round((m / 255) * 16)) ? fd : bd;
      od[o] = src[o] ?? 0;
      od[o + 1] = src[o + 1] ?? 0;
      od[o + 2] = src[o + 2] ?? 0;
      od[o + 3] = 255;
    }
    this.scratchCtx.putImageData(out, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.scratch, dx, dy, stamp, stamp);
  }

  /**
   * One world tile. Uniform neighbourhoods stay a single flipped blit.
   * Borders are classified per texel (coarse subcells first) so the edge
   * steps one source pixel at a time.
   */
  private paintCurvedTile(
    ctx: DrawCtx,
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stamp: number,
    waters: WaterMark[],
    curves: CurvePatch[],
    flats: FlatJob[],
    lx: number,
    ly: number,
  ): void {
    const center = at(x, y);
    const seed = world.seed;
    if (this.neighborhoodSame(at, x, y, FIELD_REACH)) {
      flats.push({ x, y, biome: center, dx, dy: ly * stamp, lx, ly });
      return;
    }
    if (center !== Biome.Water && this.fieldAgrees(at, x, y, center, seed)) {
      flats.push({ x, y, biome: center, dx, dy: ly * stamp, lx, ly });
      return;
    }
    if (
      center === Biome.Water &&
      this.fieldAgrees(at, x, y, center, seed) &&
      !this.shoreNear(at, x, y, seed)
    ) {
      flats.push({ x, y, biome: center, dx, dy: ly * stamp, lx, ly, kind: 'deep' });
      return;
    }
    this.rasterBorder(world, at, x, y, dx, dy, stamp, curves, flats, lx, ly);
  }

  /** Land close enough that this water tile still carries shallows or foam. */
  private shoreNear(
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    seed: number,
  ): boolean {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        if (at(x + ox, y + oy) !== Biome.Water) return true;
      }
    }
    const along = [0.15, 0.5, 0.85];
    for (const u of along) {
      const spots: Array<[number, number]> = [
        [x + u, y - 0.55],
        [x + u, y + 1.55],
        [x - 0.55, y + u],
        [x + 1.55, y + u],
      ];
      for (const [wx, wy] of spots) {
        sampleFieldInto(wx, wy, seed, at, this.fieldOut);
        if (this.fieldOut.biome !== Biome.Water) return true;
      }
    }
    return false;
  }

  /** True when a coarse set of field samples all stay on this tile's biome. */
  private fieldAgrees(
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    biome: number,
    seed: number,
  ): boolean {
    for (let iy = 0; iy < 5; iy++) {
      for (let ix = 0; ix < 5; ix++) {
        sampleFieldInto(x + ix / 4, y + iy / 4, seed, at, this.fieldOut);
        if (this.fieldOut.biome !== biome) return false;
      }
    }
    return true;
  }

  private paintFlat(
    ctx: DrawCtx,
    world: WorldData,
    x: number,
    y: number,
    biome: number,
    dx: number,
    dy: number,
    stamp: number,
    waterKind?: 'shallow' | 'deep',
  ): void {
    const at = (tx: number, ty: number) => this.biomeAt(world, tx, ty);
    this.paintGround(ctx, world, at, x, y, dx, dy, stamp, true, biome, waterKind);
  }

  private neighborhoodSame(
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    radius: number,
  ): boolean {
    const biome = at(x, y);
    for (let oy = -radius; oy <= radius; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (at(x + ox, y + oy) !== biome) return false;
      }
    }
    return true;
  }

  private rasterBorder(
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stamp: number,
    curves: CurvePatch[],
    flats: FlatJob[],
    lx: number,
    ly: number,
  ): void {
    const seed = world.seed;
    const stride = SUBCELLS + 3;
    const out = this.fieldOut;
    this.fillWarp(x, y, seed);
    for (let sy = -1; sy <= SUBCELLS + 1; sy++) {
      for (let sx = -1; sx <= SUBCELLS + 1; sx++) {
        const shifted = this.warped(sx * (TILE / SUBCELLS), sy * (TILE / SUBCELLS));
        classifyInto(shifted.x, shifted.y, seed, at, out);
        const index = (sy + 1) * stride + (sx + 1);
        this.cornerBiome[index] = out.biome;
        this.cornerBase[index] = out.base;
      }
    }
    const flat = this.flatCorner(stride);
    if (flat !== null && flat !== Biome.Water) {
      flats.push({ x, y, biome: flat, dx, dy: ly * stamp, lx, ly });
      return;
    }
    const cell = TILE / SUBCELLS;
    for (let sy = 0; sy < SUBCELLS; sy++) {
      for (let sx = 0; sx < SUBCELLS; sx++) {
        const c00 = this.cornerBiome[(sy + 1) * stride + (sx + 1)] ?? 0;
        const c10 = this.cornerBiome[(sy + 1) * stride + (sx + 2)] ?? 0;
        const c01 = this.cornerBiome[(sy + 2) * stride + (sx + 1)] ?? 0;
        const c11 = this.cornerBiome[(sy + 2) * stride + (sx + 2)] ?? 0;
        const b00 = this.cornerBase[(sy + 1) * stride + (sx + 1)] ?? 0;
        const uniform = c00 === c10 && c00 === c01 && c00 === c11 && b00 === c00;
        const x0 = sx * cell;
        const y0 = sy * cell;
        if (uniform) {
          for (let py = y0; py < y0 + cell; py++) {
            this.pixBiome.fill(c00, py * TILE + x0, py * TILE + x0 + cell);
            this.pixBase.fill(c00, py * TILE + x0, py * TILE + x0 + cell);
          }
          continue;
        }
        for (let py = y0; py < y0 + cell; py++) {
          for (let px = x0; px < x0 + cell; px++) {
            const shifted = this.warped(px + 0.5, py + 0.5);
            classifyInto(shifted.x, shifted.y, seed, at, out);
            const index = py * TILE + px;
            this.pixBiome[index] = out.biome;
            this.pixBase[index] = out.base;
          }
        }
      }
    }
    let hasWater = false;
    for (let i = 0; i < TILE * TILE; i++) {
      if ((this.pixBiome[i] ?? 0) === Biome.Water) {
        hasWater = true;
        break;
      }
    }
    if (hasWater) this.distanceToLand(at, x, y, seed);
    const variants = new Array<TileVariant | undefined>(BIOME_GROUND.length);
    const variantFor = (biome: number, span = TILE): TileVariant => {
      const cached = variants[biome];
      if (cached) return cached;
      const next = tileVariant(biome, x, y, seed, span);
      variants[biome] = next;
      return next;
    };
    const water = hasWater ? variantFor(Biome.Water, 128) : null;
    if (water) {
      water.ox = x * TILE;
      water.oy = y * TILE;
      water.flipX = false;
      water.flipY = false;
    }
    const sheets = hasWater ? this.ensureWaterPixels() : null;
    let foamCount = 0;
    const foamA = hasWater ? this.scratchCtx.createImageData(TILE, TILE) : null;
    const foamB = hasWater ? this.scratchCtx.createImageData(TILE, TILE) : null;
    const foamSheets = hasWater ? this.ensureFoamPixels() : null;
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const index = py * TILE + px;
        const biome = this.pixBiome[index] ?? 0;
        const base = this.pixBase[index] ?? biome;
        if (biome === Biome.Water && water && sheets && foamA && foamB) {
          const dist = this.pixDist[index] ?? 255;
          const kind = dist < 130 ? 'shallow' : 'deep';
          const sheet = kind === 'shallow' ? sheets.shallow[0] : sheets.deep[0];
          const rgb = sheet ? this.sampleSheet(sheet, px, py, water) : { r: 60, g: 128, b: 142 };
          this.plot(dx, dy, px, py, rgb.r, rgb.g, rgb.b);
          const foamCut = dist > 8 && hashCut(x * TILE + px, y * TILE + py, seed);
          if (dist > 0 && dist <= 16 && !foamCut && foamSheets) {
            const along = this.foamAlong(x, y, px, py, index);
            const a = foamSheets[0] ? this.sampleFoam(foamSheets[0], along) : null;
            const b = foamSheets[1] ? this.sampleFoam(foamSheets[1], along) : a;
            const foamIndex = index * 4;
            if (a && a.a >= 128) {
              this.writePixel(foamA.data, foamIndex, a.r, a.g, a.b);
              foamCount += 1;
            }
            if (b && b.a >= 128) this.writePixel(foamB.data, foamIndex, b.r, b.g, b.b);
          }
          continue;
        }
        const color = this.landTexel(biome, base, px, py, variantFor, seed, x, y);
        this.plot(dx, dy, px, py, color.r, color.g, color.b);
      }
    }
    this.frostSandEdge(dx, dy, variantFor);
    if (foamA && foamB && foamCount > 0) {
      curves.push({
        lx,
        ly,
        foam: [this.commitMask(foamA), this.commitMask(foamB)],
      });
    }
  }

  private landTexel(
    biome: number,
    base: number,
    px: number,
    py: number,
    variantFor: (biome: number, span?: number) => TileVariant,
    seed: number,
    tileX: number,
    tileY: number,
  ): Rgb {
    if (biome === Biome.Snow && base === Biome.Sand) {
      const sand = this.sampleVariant(variantFor(Biome.Sand), px, py);
      const speck = hash2(tileX * TILE + px, tileY * TILE + py, seed + 77) > 0.84;
      if (speck) return this.sampleVariant(variantFor(Biome.Snow), px, py);
      return {
        r: (sand.r * 5 + 0xe7 * 3) >> 3,
        g: (sand.g * 5 + 0xd7 * 3) >> 3,
        b: (sand.b * 4 + 0xf8 * 2 + 0xa4 * 2) >> 3,
      };
    }
    const edge = authoredEdge(biome, base);
    if (edge !== null && biome !== base) {
      const neighbors = this.otherNeighbors(px, py, biome);
      const row = neighbors > 0 ? Math.min(47, 18 + neighbors * 2) : 4 + ((px * 5 + py * 3) & 7);
      const variant = variantFor(biome);
      const u = (px + (variant.ox & 15)) % TILE;
      return this.texel(edge, u, row);
    }
    return this.sampleVariant(variantFor(biome), px, py);
  }

  /** A hard cool fringe on sand texels that touch snow. */
  private frostSandEdge(
    dx: number,
    dy: number,
    variantFor: (biome: number, span?: number) => TileVariant,
  ): void {
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const index = py * TILE + px;
        if ((this.pixBiome[index] ?? 0) !== Biome.Sand) continue;
        if (!this.touches(index, px, py, Biome.Snow)) continue;
        const sand = this.sampleVariant(variantFor(Biome.Sand), px, py);
        this.plot(dx, dy, px, py, (sand.r + 0xe7) >> 1, (sand.g + 0xd7) >> 1, (sand.b + 0xf8) >> 1);
      }
    }
  }

  private plot(
    dx: number,
    dy: number,
    px: number,
    py: number,
    r: number,
    g: number,
    b: number,
  ): void {
    const data = this.regionPixels;
    if (!data) return;
    const o = ((dy + py) * this.regionStride + (dx + px)) * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }

  private otherNeighbors(px: number, py: number, biome: number): number {
    let count = 0;
    if (px > 0 && (this.pixBiome[py * TILE + px - 1] ?? biome) !== biome) count += 1;
    if (px + 1 < TILE && (this.pixBiome[py * TILE + px + 1] ?? biome) !== biome) count += 1;
    if (py > 0 && (this.pixBiome[(py - 1) * TILE + px] ?? biome) !== biome) count += 1;
    if (py + 1 < TILE && (this.pixBiome[(py + 1) * TILE + px] ?? biome) !== biome) count += 1;
    return count;
  }

  private touches(index: number, px: number, py: number, biome: number): boolean {
    if (px > 0 && (this.pixBiome[index - 1] ?? 0) === biome) return true;
    if (px + 1 < TILE && (this.pixBiome[index + 1] ?? 0) === biome) return true;
    if (py > 0 && (this.pixBiome[index - TILE] ?? 0) === biome) return true;
    if (py + 1 < TILE && (this.pixBiome[index + TILE] ?? 0) === biome) return true;
    return false;
  }

  private distanceToLand(
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    seed: number,
  ): void {
    this.pixDist.fill(255);
    for (let i = 0; i < TILE * TILE; i++) {
      if ((this.pixBiome[i] ?? 0) !== Biome.Water) this.pixDist[i] = 0;
    }
    this.seedEdgeDistance(at, x, y, seed, 0, -1);
    this.seedEdgeDistance(at, x, y, seed, 0, 1);
    this.seedEdgeDistance(at, x, y, seed, -1, 0);
    this.seedEdgeDistance(at, x, y, seed, 1, 0);
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const i = py * TILE + px;
        let d = this.pixDist[i] ?? 255;
        if (px > 0) d = Math.min(d, (this.pixDist[i - 1] ?? 255) + 5);
        if (py > 0) d = Math.min(d, (this.pixDist[i - TILE] ?? 255) + 5);
        if (px > 0 && py > 0) d = Math.min(d, (this.pixDist[i - TILE - 1] ?? 255) + 7);
        if (px + 1 < TILE && py > 0) d = Math.min(d, (this.pixDist[i - TILE + 1] ?? 255) + 7);
        this.pixDist[i] = d;
      }
    }
    for (let py = TILE - 1; py >= 0; py--) {
      for (let px = TILE - 1; px >= 0; px--) {
        const i = py * TILE + px;
        let d = this.pixDist[i] ?? 255;
        if (px + 1 < TILE) d = Math.min(d, (this.pixDist[i + 1] ?? 255) + 5);
        if (py + 1 < TILE) d = Math.min(d, (this.pixDist[i + TILE] ?? 255) + 5);
        if (px + 1 < TILE && py + 1 < TILE)
          d = Math.min(d, (this.pixDist[i + TILE + 1] ?? 255) + 7);
        if (px > 0 && py + 1 < TILE) d = Math.min(d, (this.pixDist[i + TILE - 1] ?? 255) + 7);
        this.pixDist[i] = d;
      }
    }
  }

  /** Distance from land that sits just outside this tile, in chamfer units. */
  private seedEdgeDistance(
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    seed: number,
    ox: number,
    oy: number,
  ): void {
    let water = false;
    for (let step = 0; step < TILE; step++) {
      const px = ox === 0 ? step : ox < 0 ? 0 : TILE - 1;
      const py = oy === 0 ? step : oy < 0 ? 0 : TILE - 1;
      if ((this.pixBiome[py * TILE + px] ?? 0) === Biome.Water) water = true;
    }
    if (!water) return;
    const stride = SUBCELLS + 3;
    const probes = new Uint8Array(SUBCELLS + 1);
    for (let sx = 0; sx <= SUBCELLS; sx++) {
      const worldX = ox === 0 ? x + sx / SUBCELLS : x + (ox < 0 ? 0 : 1);
      const worldY = oy === 0 ? y + sx / SUBCELLS : y + (oy < 0 ? 0 : 1);
      let dist = 255;
      sampleFieldInto(worldX + ox / TILE, worldY + oy / TILE, seed, at, this.fieldOut);
      if (this.fieldOut.biome !== Biome.Water) dist = 5;
      else if (this.haloLand(stride, sx, ox, oy)) dist = 40;
      else {
        sampleFieldInto(
          worldX + (ox * 16) / TILE,
          worldY + (oy * 16) / TILE,
          seed,
          at,
          this.fieldOut,
        );
        if (this.fieldOut.biome !== Biome.Water) dist = 80;
        else {
          sampleFieldInto(
            worldX + (ox * 24) / TILE,
            worldY + (oy * 24) / TILE,
            seed,
            at,
            this.fieldOut,
          );
          if (this.fieldOut.biome !== Biome.Water) dist = 120;
        }
      }
      probes[sx] = dist;
    }
    for (let step = 0; step < TILE; step++) {
      const px = ox === 0 ? step : ox < 0 ? 0 : TILE - 1;
      const py = oy === 0 ? step : oy < 0 ? 0 : TILE - 1;
      const index = py * TILE + px;
      if ((this.pixBiome[index] ?? 0) !== Biome.Water) continue;
      const t = (step / (TILE - 1)) * SUBCELLS;
      const i0 = Math.min(SUBCELLS - 1, Math.floor(t));
      const frac = t - i0;
      const d0 = probes[i0] ?? 255;
      const d1 = probes[i0 + 1] ?? 255;
      if (d0 === 255 && d1 === 255) continue;
      const seeded = d0 === 255 ? d1 : d1 === 255 ? d0 : Math.round(d0 + (d1 - d0) * frac);
      if (seeded < (this.pixDist[index] ?? 255)) this.pixDist[index] = seeded;
    }
  }

  private haloLand(stride: number, along: number, ox: number, oy: number): boolean {
    const gx = ox < 0 ? -1 : ox > 0 ? SUBCELLS + 1 : along;
    const gy = oy < 0 ? -1 : oy > 0 ? SUBCELLS + 1 : along;
    const index = (gy + 1) * stride + (gx + 1);
    return (this.cornerBiome[index] ?? 0) !== Biome.Water;
  }

  private fillWarp(x: number, y: number, seed: number): void {
    const n = 9;
    for (let j = 0; j < n; j++) {
      const wy = y + (j * 8 - 8) / TILE;
      for (let i = 0; i < n; i++) {
        const shifted = displaced(x + (i * 8 - 8) / TILE, wy, seed);
        const index = j * n + i;
        this.warpX[index] = shifted.x;
        this.warpY[index] = shifted.y;
      }
    }
  }

  /** Bilinear displaced position for a texel coordinate, including a small halo. */
  private warped(px: number, py: number): { x: number; y: number } {
    const n = 9;
    const gx = (px + 8) / 8;
    const gy = (py + 8) / 8;
    const ix = Math.min(n - 2, Math.max(0, Math.floor(gx)));
    const iy = Math.min(n - 2, Math.max(0, Math.floor(gy)));
    const fx = gx - ix;
    const fy = gy - iy;
    const i00 = iy * n + ix;
    const x00 = this.warpX[i00] ?? 0;
    const x10 = this.warpX[i00 + 1] ?? x00;
    const x01 = this.warpX[i00 + n] ?? x00;
    const x11 = this.warpX[i00 + n + 1] ?? x00;
    const y00 = this.warpY[i00] ?? 0;
    const y10 = this.warpY[i00 + 1] ?? y00;
    const y01 = this.warpY[i00 + n] ?? y00;
    const y11 = this.warpY[i00 + n + 1] ?? y00;
    return {
      x: x00 + (x10 - x00) * fx + (x01 - x00) * fy + (x00 - x10 - x01 + x11) * fx * fy,
      y: y00 + (y10 - y00) * fx + (y01 - y00) * fy + (y00 - y10 - y01 + y11) * fx * fy,
    };
  }

  private flatCorner(stride: number): number | null {
    const first = this.cornerBiome[0] ?? 0;
    const count = stride * stride;
    for (let i = 1; i < count; i++) {
      if ((this.cornerBiome[i] ?? 0) !== first) return null;
    }
    return first;
  }

  private foamAlong(tileX: number, tileY: number, px: number, py: number, index: number): number {
    const left = px > 0 ? (this.pixDist[index - 1] ?? 0) : (this.pixDist[index] ?? 0);
    const up = py > 0 ? (this.pixDist[index - TILE] ?? 0) : (this.pixDist[index] ?? 0);
    const gx = (this.pixDist[index] ?? 0) - left;
    const gy = (this.pixDist[index] ?? 0) - up;
    if (gx === 0 && gy === 0) return tileX * TILE + px + py;
    return Math.floor((tileX * TILE + px) * -gy + (tileY * TILE + py) * gx);
  }

  private paintRoad(
    ctx: DrawCtx,
    world: WorldData,
    x: number,
    y: number,
    center: number,
    border: boolean,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    if (border || !this.pathAt(world, x, y) || center === Biome.Water) return;
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

  private paintCurve(ctx: DrawCtx, curve: CurvePatch, stamp: number): void {
    const foam = curve.foam?.[this.frame % 2] ?? curve.foam?.[0];
    if (foam) ctx.drawImage(foam, curve.lx * stamp, curve.ly * stamp, stamp, stamp);
  }

  private blitSheet(
    ctx: DrawCtx,
    image: CanvasImageSource,
    dx: number,
    dy: number,
    stamp: number,
    variant: SheetShift,
  ): void {
    ctx.imageSmoothingEnabled = false;
    const size = sourceSize(image);
    const cell = Math.min(TILE, size.w, size.h);
    const sx = ((variant.ox % size.w) + size.w) % size.w;
    const sy = ((variant.oy % size.h) + size.h) % size.h;
    const right = Math.min(cell, size.w - sx);
    const bottom = Math.min(cell, size.h - sy);
    const dest = (n: number) => (n / cell) * stamp;
    const paint = (target: DrawCtx, ox: number, oy: number) => {
      target.drawImage(image, sx, sy, right, bottom, ox, oy, dest(right), dest(bottom));
      if (right < cell) {
        target.drawImage(
          image,
          0,
          sy,
          cell - right,
          bottom,
          ox + dest(right),
          oy,
          dest(cell - right),
          dest(bottom),
        );
      }
      if (bottom < cell) {
        target.drawImage(
          image,
          sx,
          0,
          right,
          cell - bottom,
          ox,
          oy + dest(bottom),
          dest(right),
          dest(cell - bottom),
        );
      }
      if (right < cell && bottom < cell) {
        target.drawImage(
          image,
          0,
          0,
          cell - right,
          cell - bottom,
          ox + dest(right),
          oy + dest(bottom),
          dest(cell - right),
          dest(cell - bottom),
        );
      }
    };
    if (!variant.flipX && !variant.flipY) {
      paint(ctx, dx, dy);
      return;
    }
    ctx.save();
    ctx.translate(dx + (variant.flipX ? stamp : 0), dy + (variant.flipY ? stamp : 0));
    ctx.scale(variant.flipX ? -1 : 1, variant.flipY ? -1 : 1);
    paint(ctx, 0, 0);
    ctx.restore();
  }

  private sampleVariant(variant: TileVariant, px: number, py: number): Rgb {
    let u = px;
    let v = py;
    if (variant.flipX) u = TILE - 1 - u;
    if (variant.flipY) v = TILE - 1 - v;
    u = (u + variant.ox) % TILE;
    v = (v + variant.oy) % TILE;
    return this.texel(variant.id, u, v);
  }

  private texel(id: number, u: number, v: number): Rgb {
    const data = this.tileData[id]?.data;
    const o = (v * TILE + u) * 4;
    return {
      r: data?.[o] ?? 0,
      g: data?.[o + 1] ?? 0,
      b: data?.[o + 2] ?? 0,
    };
  }

  private sampleSheet(sheet: ImageData, px: number, py: number, variant: TileVariant): Rgb {
    let u = px;
    let v = py;
    if (variant.flipX) u = TILE - 1 - u;
    if (variant.flipY) v = TILE - 1 - v;
    const uu = (u + variant.ox) % sheet.width;
    const vv = (v + variant.oy) % sheet.height;
    const o = (vv * sheet.width + uu) * 4;
    return {
      r: sheet.data[o] ?? 0,
      g: sheet.data[o + 1] ?? 0,
      b: sheet.data[o + 2] ?? 0,
    };
  }

  private sampleFoam(sheet: ImageData, along: number): Rgb & { a: number } {
    const x = ((along % sheet.width) + sheet.width) % sheet.width;
    let bestA = 0;
    let r = 255;
    let g = 255;
    let b = 255;
    for (let y = 0; y < sheet.height; y++) {
      const o = (y * sheet.width + x) * 4;
      const a = sheet.data[o + 3] ?? 0;
      if (a > bestA) {
        bestA = a;
        r = sheet.data[o] ?? 255;
        g = sheet.data[o + 1] ?? 255;
        b = sheet.data[o + 2] ?? 255;
      }
    }
    return { r, g, b, a: bestA };
  }

  private writePixel(data: Uint8ClampedArray, o: number, r: number, g: number, b: number): void {
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }

  private commitMask(data: ImageData): CanvasImageSource {
    const canvas = makeCanvas(TILE, TILE);
    canvas.getContext('2d')?.putImageData(data, 0, 0);
    return canvas;
  }

  private ensureTileImage(): ImageData {
    if (!this.tileImage) this.tileImage = this.scratchCtx.createImageData(TILE, TILE);
    return this.tileImage;
  }

  private ensureFoamPixels(): ImageData[] {
    if (this.foamPixels) return this.foamPixels;
    this.foamPixels = this.images.foam
      .filter((img): img is HTMLImageElement => !!img)
      .map((img) => imageDataOf(img));
    return this.foamPixels;
  }

  private ensureWaterPixels(): { deep: ImageData[]; shallow: ImageData[] } {
    if (this.waterPixels) return this.waterPixels;
    this.waterPixels = {
      deep: this.images.deep.map((img) => imageDataOf(img)),
      shallow: this.images.shallow.map((img) => imageDataOf(img)),
    };
    return this.waterPixels;
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
    const road = resolveRoad(n, e, s, w);
    if (road.kind === 'authored' || !road.parts || !road.axis) {
      this.blitTile(ctx, road.atlasId, dx, dy, stamp);
      return;
    }
    const canvas = this.derivedCanvas(road.id, () => {
      const first = this.tileData[road.parts?.[0] ?? 0]?.data;
      const second = this.tileData[road.parts?.[1] ?? 0]?.data;
      const out = new Uint8ClampedArray(TILE * TILE * 4);
      if (first && second) compositeRoadStraight(first, second, out, road.axis ?? 'ew');
      return out;
    });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, dx, dy, stamp, stamp);
  }

  /**
   * One world tile: authored ground, an authored edge sheet, or a derived
   * fringe kept off the atlas. Neighbours are whatever `at` returns, so a
   * chunk samples the world past its own canvas.
   */
  private paintGround(
    ctx: DrawCtx,
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stamp: number,
    roads: boolean,
    biome = at(x, y),
    waterKind?: 'shallow' | 'deep',
  ): void {
    const adj: Adj = {
      center: biome,
      n: at(x, y - 1),
      e: at(x + 1, y),
      s: at(x, y + 1),
      w: at(x - 1, y),
      nw: at(x - 1, y - 1),
      ne: at(x + 1, y - 1),
      se: at(x + 1, y + 1),
      sw: at(x - 1, y + 1),
    };
    const tile = resolveTile(adj);
    ctx.imageSmoothingEnabled = false;
    if (tile.kind === 'authored') {
      this.blitTile(ctx, tile.atlasId, dx, dy, stamp);
    } else if (tile.kind === 'ground' && biome === Biome.Water && waterBandSeam(at, x, y)) {
      this.blitWaterField(ctx, at, x, y, dx, dy, stamp, world.seed);
    } else if (tile.kind === 'ground') {
      this.blitInterior(ctx, at, x, y, dx, dy, stamp, biome, world.seed, waterKind);
    } else {
      this.blitEdgeField(ctx, world, at, x, y, dx, dy, stamp);
    }
    if (roads) this.paintRoad(ctx, world, x, y, biome, false, dx, dy, stamp);
  }

  /** Interior ground. Flips break repetition; the cell is not scrolled, so edges still meet. */
  private blitInterior(
    ctx: DrawCtx,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stamp: number,
    biome: number,
    seed: number,
    waterKind?: 'shallow' | 'deep',
  ): void {
    if (biome === Biome.Water) {
      const kind = waterKind ?? waterBand(at, x, y);
      const img = this.waterFrame(kind === 'deep' ? 'deep' : 'shallow');
      if (img) {
        this.blitSheet(ctx, img, dx, dy, stamp, {
          ox: x * TILE,
          oy: y * TILE,
          flipX: false,
          flipY: false,
        });
      }
      return;
    }
    const variant = tileVariant(biome, x, y, seed, TILE);
    const rot = biome === Biome.Snow ? snowRotation(x, y, seed) : 0;
    this.blitVariant(ctx, variant.id, variant.flipX, variant.flipY, rot, dx, dy, stamp);
  }

  /** Draws one authored ground cell. Snow may turn by quarters; the cell is never scrolled. */
  private blitVariant(
    ctx: DrawCtx,
    id: number,
    flipX: boolean,
    flipY: boolean,
    rot: number,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    const tile = this.tiles[id] ?? this.tiles[0];
    if (!tile) return;
    if (rot === 0) {
      this.blitSheet(ctx, tile, dx, dy, stamp, { ox: 0, oy: 0, flipX, flipY });
      return;
    }
    const src = this.tileData[id]?.data;
    if (!src) return;
    const image = this.scratchCtx.createImageData(TILE, TILE);
    const data = image.data;
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const { u, v } = orientedTexel(px, py, TILE, flipX, flipY, rot);
        const s = (v * TILE + u) * 4;
        const d = (py * TILE + px) * 4;
        data[d] = src[s] ?? 0;
        data[d + 1] = src[s + 1] ?? 0;
        data[d + 2] = src[s + 2] ?? 0;
        data[d + 3] = 255;
      }
    }
    this.scratchCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.scratch, dx, dy, stamp, stamp);
  }

  /** Shallow and deep water share the coast noise, so the band is not a tile stair. */
  private blitWaterField(
    ctx: DrawCtx,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stamp: number,
    seed: number,
  ): void {
    const image = this.scratchCtx.createImageData(TILE, TILE);
    const data = image.data;
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const kind = waterKindAt(x, y, px, py, seed, at);
        const color = this.sampleWater(kind, x * TILE + px, y * TILE + py);
        const o = (py * TILE + px) * 4;
        data[o] = color.r;
        data[o + 1] = color.g;
        data[o + 2] = color.b;
        data[o + 3] = 255;
      }
    }
    this.scratchCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.scratch, dx, dy, stamp, stamp);
  }

  /**
   * Missing transition. One noise field in world space, sampled by both tiles,
   * so the edge is a single irregular contour instead of a repeated comb.
   */
  private blitEdgeField(
    ctx: DrawCtx,
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    const image = this.scratchCtx.createImageData(TILE, TILE);
    const data = image.data;
    const seed = world.seed;
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const owner = ownerTile(x, y, px, py, seed);
        const biome = at(owner.x, owner.y);
        const color = this.sampleOwned(biome, owner.x, owner.y, px, py, seed, x, y, at);
        const o = (py * TILE + px) * 4;
        data[o] = color.r;
        data[o + 1] = color.g;
        data[o + 2] = color.b;
        data[o + 3] = 255;
      }
    }
    this.scratchCtx.putImageData(image, 0, 0);
    ctx.drawImage(this.scratch, dx, dy, stamp, stamp);
  }

  private sampleOwned(
    biome: number,
    ownerX: number,
    ownerY: number,
    px: number,
    py: number,
    seed: number,
    destX: number,
    destY: number,
    at: (x: number, y: number) => number,
  ): Rgb {
    if (biome === Biome.Water) {
      const kind = waterKindAt(destX, destY, px, py, seed, at);
      return this.sampleWater(kind, destX * TILE + px, destY * TILE + py);
    }
    const variant = tileVariant(biome, ownerX, ownerY, seed, TILE);
    const src = this.tileData[variant.id]?.data;
    if (!src) return { r: 90, g: 140, b: 80 };
    const rot = biome === Biome.Snow ? snowRotation(ownerX, ownerY, seed) : 0;
    const { u, v } = orientedTexel(px, py, TILE, variant.flipX, variant.flipY, rot);
    const s = (v * TILE + u) * 4;
    const r = src[s] ?? 0;
    const g = src[s + 1] ?? 0;
    const b = src[s + 2] ?? 0;
    if (r + g + b < 12) {
      const fallback = averageOpaque(src);
      if (fallback.r + fallback.g + fallback.b >= 12) return fallback;
    }
    return { r, g, b };
  }

  private sampleWater(kind: 'shallow' | 'deep', gx: number, gy: number): Rgb {
    const sheets = this.ensureWaterPixels();
    const list = kind === 'deep' ? sheets.deep : sheets.shallow;
    const sheet = list[this.frame % Math.max(1, list.length)] ?? list[0];
    if (!sheet) return kind === 'deep' ? { r: 62, g: 120, b: 178 } : { r: 74, g: 158, b: 178 };
    return this.sampleSheetPixel(sheet, gx, gy);
  }

  private sampleSheetPixel(sheet: ImageData, gx: number, gy: number): Rgb {
    const w = sheet.width;
    const h = sheet.height;
    const sx = ((gx % w) + w) % w;
    const sy = ((gy % h) + h) % h;
    const o = (sy * w + sx) * 4;
    return { r: sheet.data[o] ?? 0, g: sheet.data[o + 1] ?? 0, b: sheet.data[o + 2] ?? 0 };
  }

  private derivedCanvas(key: string, paint: () => Uint8ClampedArray): HTMLCanvasElement {
    const hit = this.derived.get(key);
    if (hit) return hit;
    if (this.derived.size > 800) {
      const oldest = this.derived.keys().next().value;
      if (oldest !== undefined) this.derived.delete(oldest);
    }
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const pixels = paint();
    const image = ctx.createImageData(TILE, TILE);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    this.derived.set(key, canvas);
    return canvas;
  }

  /**
   * One real texel per world tile, reduced from the 48px art. This is on screen
   * before any finer mip, so the map never falls back to a flat biome swatch.
   */
  buildCoarseMip(world: WorldData): void {
    const width = world.width;
    const height = world.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const image = ctx.createImageData(width, height);
    const data = image.data;
    const at = (x: number, y: number) => this.biomeAt(world, x, y);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const biome = at(x, y);
        const color = this.coarseTexel(world, at, x, y, biome);
        const o = (y * width + x) * 4;
        data[o] = color.r;
        data[o + 1] = color.g;
        data[o + 2] = color.b;
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    this.coarseMip = canvas;
    this.mipJobs.clear();
    this.reduced.clear();
  }

  /** Build the mip nearest the current scale. A chunk is drawn only when the whole view is ready. */
  stepViewMips(
    world: WorldData,
    cameraX: number,
    cameraY: number,
    scale: number,
    viewW: number,
    viewH: number,
    budgetMs: number,
  ): void {
    if (!this.coarseMip) return;
    const want = mipForScreenPx(scale * WORLD_TILE);
    if (want <= 1) return;
    const span = spanForMip(want);
    const halfW = viewW / (2 * Math.max(scale, 1e-6)) / WORLD_TILE;
    const halfH = viewH / (2 * Math.max(scale, 1e-6)) / WORLD_TILE;
    const blocks = this.visibleMips(
      cameraX,
      cameraY,
      halfW,
      halfH,
      world.width,
      world.height,
      span,
    );
    const started = performance.now();
    const pending = blocks
      .map((block) => {
        const key = `${block.x}:${block.y}:${want}`;
        let job = this.mipJobs.get(key);
        if (!job) {
          job = {
            x: block.x,
            y: block.y,
            span: block.span,
            px: want,
            row: 0,
            col: 0,
            data: new Uint8ClampedArray(block.span * want * block.span * want * 4),
            canvas: null,
          };
          this.mipJobs.set(key, job);
        }
        return { job, d: block.d };
      })
      .filter((item) => !item.job.canvas)
      .sort((a, b) => a.d - b.d);
    for (const item of pending) {
      if (performance.now() - started >= budgetMs) break;
      this.paintMipJob(world, item.job, budgetMs - (performance.now() - started));
    }
    this.trimMipJobs(cameraX, cameraY, want);
  }

  drawArtMips(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    scale: number,
    viewW: number,
    viewH: number,
    worldW: number,
    worldH: number,
  ): void {
    const coarse = this.coarseMip;
    if (!coarse) return;
    const drawLayer = (shift: number) => {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        coarse,
        shift * worldW * WORLD_TILE,
        0,
        worldW * WORLD_TILE,
        worldH * WORLD_TILE,
      );
      const want = mipForScreenPx(scale * WORLD_TILE);
      if (want <= 1) return;
      const span = spanForMip(want);
      const halfW = viewW / (2 * Math.max(scale, 1e-6)) / WORLD_TILE;
      const halfH = viewH / (2 * Math.max(scale, 1e-6)) / WORLD_TILE;
      const blocks = this.visibleMips(cameraX - shift, cameraY, halfW, halfH, worldW, worldH, span);
      const pad = 1 / Math.max(scale, 1e-4);
      for (const block of blocks) {
        const job = this.mipJobs.get(`${block.x}:${block.y}:${want}`);
        if (!job?.canvas) continue;
        ctx.drawImage(
          job.canvas,
          (job.x + shift) * WORLD_TILE - pad,
          job.y * WORLD_TILE - pad,
          job.span * WORLD_TILE + pad * 2,
          job.span * WORLD_TILE + pad * 2,
        );
      }
    };
    drawLayer(0);
    const halfW = viewW / (2 * Math.max(scale, 1e-6)) / WORLD_TILE;
    const viewTilesX = viewW / (Math.max(scale, 1e-6) * WORLD_TILE);
    if (viewTilesX < worldW * 0.92) {
      if (cameraX - halfW < 0) drawLayer(-worldW);
      if (cameraX + halfW > worldW) drawLayer(worldW);
    }
  }

  private coarseTexel(
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    biome: number,
  ): Rgb {
    if (biome === Biome.Water) {
      if (this.openOcean(at, x, y)) return this.sampleWater('deep', x * TILE + 24, y * TILE + 24);
      if (!waterBandSeam(at, x, y)) {
        return this.sampleWater(waterBand(at, x, y), x * TILE + 24, y * TILE + 24);
      }
    } else if (this.pathAt(world, x, y)) {
      return this.atlasColor(SANDSTONE_ROAD);
    } else if (this.isPlainLand(at, x, y, biome)) {
      const variant = tileVariant(biome, x, y, world.seed, TILE);
      return this.atlasColor(variant.id);
    }
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    let bestR = 0;
    let bestG = 0;
    let bestB = 0;
    let bestD = Infinity;
    for (let i = 0; i < 4; i++) {
      const px = i % 2 === 0 ? 12 : 36;
      const py = i < 2 ? 12 : 36;
      const owner = ownerTile(x, y, px, py, world.seed);
      const sampleBiome = at(owner.x, owner.y);
      const color = this.sampleOwned(sampleBiome, owner.x, owner.y, px, py, world.seed, x, y, at);
      r += color.r;
      g += color.g;
      b += color.b;
      n += 1;
    }
    const ar = r / n;
    const ag = g / n;
    const ab = b / n;
    for (let i = 0; i < 4; i++) {
      const px = i % 2 === 0 ? 12 : 36;
      const py = i < 2 ? 12 : 36;
      const owner = ownerTile(x, y, px, py, world.seed);
      const sampleBiome = at(owner.x, owner.y);
      const color = this.sampleOwned(sampleBiome, owner.x, owner.y, px, py, world.seed, x, y, at);
      const dr = color.r - ar;
      const dg = color.g - ag;
      const db = color.b - ab;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestD) {
        bestD = dist;
        bestR = color.r;
        bestG = color.g;
        bestB = color.b;
      }
    }
    return { r: bestR, g: bestG, b: bestB };
  }

  private openOcean(at: (x: number, y: number) => number, x: number, y: number): boolean {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (at(x + dx, y + dy) !== Biome.Water) return false;
      }
    }
    return true;
  }

  private isPlainLand(
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    biome: number,
  ): boolean {
    return (
      at(x, y - 1) === biome &&
      at(x + 1, y) === biome &&
      at(x, y + 1) === biome &&
      at(x - 1, y) === biome &&
      at(x - 1, y - 1) === biome &&
      at(x + 1, y - 1) === biome &&
      at(x + 1, y + 1) === biome &&
      at(x - 1, y + 1) === biome
    );
  }

  private atlasColor(id: number): Rgb {
    const cached = this.repColor.get(id);
    if (cached) return cached;
    const src = this.tileData[id]?.data;
    const reduced = src ? areaReduce(src, TILE, 1) : new Uint8ClampedArray([90, 140, 80, 255]);
    const color = { r: reduced[0] ?? 90, g: reduced[1] ?? 140, b: reduced[2] ?? 80 };
    this.repColor.set(id, color);
    return color;
  }

  private visibleMips(
    cameraX: number,
    cameraY: number,
    halfW: number,
    halfH: number,
    worldW: number,
    worldH: number,
    span: number,
  ): Array<{ x: number; y: number; span: number; d: number }> {
    const blocks: Array<{ x: number; y: number; span: number; d: number }> = [];
    const x0 = Math.floor((cameraX - halfW) / span) * span;
    const y0 = Math.floor((cameraY - halfH) / span) * span;
    const x1 = cameraX + halfW;
    const y1 = cameraY + halfH;
    for (let y = y0; y < y1 + span; y += span) {
      if (y >= worldH || y + span <= 0) continue;
      for (let x = x0; x < x1 + span; x += span) {
        if (x >= worldW || x + span <= 0) continue;
        const dx = x + span * 0.5 - cameraX;
        const dy = y + span * 0.5 - cameraY;
        blocks.push({
          x,
          y,
          span: Math.min(span, worldW - x, worldH - y),
          d: dx * dx + dy * dy,
        });
      }
    }
    return blocks;
  }

  private paintMipJob(world: WorldData, job: MipJob, budgetMs: number): void {
    const started = performance.now();
    const at = (x: number, y: number) => this.biomeAt(world, x, y);
    const stride = job.span * job.px;
    while (job.row < job.span && performance.now() - started < budgetMs) {
      while (job.col < job.span && performance.now() - started < budgetMs) {
        const wx = job.x + job.col;
        const wy = job.y + job.row;
        if (wy >= 0 && wy < world.height && wx >= 0 && wx < world.width) {
          const pixels = this.mipTilePixels(world, at, wx, wy, job.px);
          const ox = job.col * job.px;
          const oy = job.row * job.px;
          for (let py = 0; py < job.px; py++) {
            const dest = ((oy + py) * stride + ox) * 4;
            const src = py * job.px * 4;
            job.data.set(pixels.subarray(src, src + job.px * 4), dest);
          }
        }
        job.col += 1;
      }
      if (job.col >= job.span) {
        job.col = 0;
        job.row += 1;
      }
    }
    if (job.row < job.span) return;
    const canvas = document.createElement('canvas');
    canvas.width = stride;
    canvas.height = job.span * job.px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(canvas.width, canvas.height);
    image.data.set(job.data);
    ctx.putImageData(image, 0, 0);
    job.canvas = canvas;
    job.data = new Uint8ClampedArray(0);
  }

  private mipTilePixels(
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    px: number,
  ): Uint8ClampedArray {
    const biome = at(x, y);
    if (biome === Biome.Water) {
      if (waterBandSeam(at, x, y)) return this.renderedMip(world, at, x, y, px);
      return this.waterMip(x, y, px, waterBand(at, x, y));
    }
    if (this.pathAt(world, x, y) || !this.isPlainLand(at, x, y, biome)) {
      return this.renderedMip(world, at, x, y, px);
    }
    const variant = tileVariant(biome, x, y, world.seed, TILE);
    const rot = biome === Biome.Snow ? snowRotation(x, y, world.seed) : 0;
    const key = `${variant.id}:${variant.flipX ? 1 : 0}:${variant.flipY ? 1 : 0}:${rot}:${px}`;
    const cached = this.reduced.get(key);
    if (cached) return cached;
    const src = this.tileData[variant.id]?.data;
    const reduced = src
      ? areaReduce(src, TILE, px, { flipX: variant.flipX, flipY: variant.flipY, rot })
      : new Uint8ClampedArray(px * px * 4);
    this.reduced.set(key, reduced);
    return reduced;
  }

  private waterMip(x: number, y: number, px: number, kind: 'shallow' | 'deep'): Uint8ClampedArray {
    const out = new Uint8ClampedArray(px * px * 4);
    const box = TILE / px;
    for (let j = 0; j < px; j++) {
      for (let i = 0; i < px; i++) {
        const gx = x * TILE + Math.floor(i * box + box / 2);
        const gy = y * TILE + Math.floor(j * box + box / 2);
        const color = this.sampleWater(kind, gx, gy);
        const o = (j * px + i) * 4;
        out[o] = color.r;
        out[o + 1] = color.g;
        out[o + 2] = color.b;
        out[o + 3] = 255;
      }
    }
    return out;
  }

  private renderedMip(
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
    px: number,
  ): Uint8ClampedArray {
    const raw = this.fillTileBuffer(world, at, x, y);
    return px === TILE ? raw : areaReduce(raw, TILE, px);
  }

  /** The same pixels paintGround would draw, without a canvas readback. */
  private fillTileBuffer(
    world: WorldData,
    at: (x: number, y: number) => number,
    x: number,
    y: number,
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(TILE * TILE * 4);
    const biome = at(x, y);
    const seed = world.seed;
    const adj: Adj = {
      center: biome,
      n: at(x, y - 1),
      e: at(x + 1, y),
      s: at(x, y + 1),
      w: at(x - 1, y),
      nw: at(x - 1, y - 1),
      ne: at(x + 1, y - 1),
      se: at(x + 1, y + 1),
      sw: at(x - 1, y + 1),
    };
    const tile = resolveTile(adj);
    const write = (px: number, py: number, color: Rgb) => {
      const o = (py * TILE + px) * 4;
      data[o] = color.r;
      data[o + 1] = color.g;
      data[o + 2] = color.b;
      data[o + 3] = 255;
    };
    if (this.pathAt(world, x, y) && biome !== Biome.Water) {
      const road = resolveRoad(
        this.pathAt(world, x, y - 1),
        this.pathAt(world, x + 1, y),
        this.pathAt(world, x, y + 1),
        this.pathAt(world, x - 1, y),
      );
      const src = this.tileData[road.atlasId]?.data;
      if (src) data.set(src);
      return data;
    }
    if (tile.kind === 'authored') {
      const src = this.tileData[tile.atlasId]?.data;
      if (src) data.set(src);
      return data;
    }
    if (biome === Biome.Water && tile.kind === 'ground') {
      const seam = waterBandSeam(at, x, y);
      const still = seam ? null : waterBand(at, x, y);
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const kind = seam ? waterKindAt(x, y, px, py, seed, at) : (still ?? 'deep');
          write(px, py, this.sampleWater(kind, x * TILE + px, y * TILE + py));
        }
      }
      return data;
    }
    if (tile.kind === 'ground') {
      const variant = tileVariant(biome, x, y, seed, TILE);
      const rot = biome === Biome.Snow ? snowRotation(x, y, seed) : 0;
      const src = this.tileData[variant.id]?.data;
      if (!src) return data;
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const { u, v } = orientedTexel(px, py, TILE, variant.flipX, variant.flipY, rot);
          const s = (v * TILE + u) * 4;
          write(px, py, { r: src[s] ?? 0, g: src[s + 1] ?? 0, b: src[s + 2] ?? 0 });
        }
      }
      return data;
    }
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const owner = ownerTile(x, y, px, py, seed);
        const sampleBiome = at(owner.x, owner.y);
        write(px, py, this.sampleOwned(sampleBiome, owner.x, owner.y, px, py, seed, x, y, at));
      }
    }
    return data;
  }

  private trimMipJobs(cameraX: number, cameraY: number, want: number): void {
    if (this.mipJobs.size <= 96) return;
    const ranked = [...this.mipJobs.entries()].map(([key, job]) => {
      const dx = job.x + job.span * 0.5 - cameraX;
      const dy = job.y + job.span * 0.5 - cameraY;
      return { key, d: dx * dx + dy * dy, keep: job.px === want };
    });
    ranked.sort((a, b) => b.d - a.d);
    let extra = this.mipJobs.size - 72;
    for (const item of ranked) {
      if (extra <= 0) break;
      if (item.keep && item.d < 1e8) continue;
      this.mipJobs.delete(item.key);
      extra -= 1;
    }
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

function sourceSize(image: CanvasImageSource): { w: number; h: number } {
  if (
    image instanceof HTMLImageElement ||
    image instanceof HTMLCanvasElement ||
    image instanceof OffscreenCanvas
  ) {
    return { w: image.width, h: image.height };
  }
  return { w: TILE, h: TILE };
}

function hashCut(x: number, y: number, seed: number): boolean {
  return hash2(x, y, seed + 9) < 0.42;
}

function swatchFrom(
  data: Uint8ClampedArray | undefined,
  width: number,
  height: number,
): [number, number, number] {
  if (!data || width < 1 || height < 1) return [120, 150, 90];
  const cx = width >> 1;
  const cy = height >> 1;
  for (let radius = 0; radius < 6; radius++) {
    const x = Math.min(width - 1, cx + radius);
    const o = (cy * width + x) * 4;
    const r = data[o] ?? 0;
    const g = data[o + 1] ?? 0;
    const b = data[o + 2] ?? 0;
    if (r + g + b > 24) return [r, g, b];
  }
  const o = (cy * width + cx) * 4;
  return [data[o] ?? 120, data[o + 1] ?? 150, data[o + 2] ?? 90];
}

function imageDataOf(image: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, image.width);
  canvas.height = Math.max(1, image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return new ImageData(canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}
