import type { ChunkData, WorldData } from '../../core/world/models';
import { BIOME_COUNT, Biome } from '../../core/world/models';
import { hash2 } from '../../core/world/noise';
import { BIOME_GROUND, DIRT_EDGE_BASE, EDGE_INDEX, SANDSTONE_ROAD } from './biome-table';
import { averageTileColor, type GroundPalette } from './detail-lod';
import { cellCorners, foamRuns, pickCell, waterBand, type FoamRun } from './terrain-pick';
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
    if (job.stamp < 48) return this.stepFlatRegion(world, job, budgetMs);
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
      const flow = tileVariant(Biome.Water, x, y, world.seed, 128);
      waters.push({
        lx,
        ly,
        kind: band === 'deep' ? 'deep' : 'shallow',
        ox: flow.ox,
        oy: flow.oy,
        flipX: flow.flipX,
        flipY: flow.flipY,
      });
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

  /** One average colour per biome, plus the road tile. Used by the far-zoom sheet. */
  groundPalette(): GroundPalette {
    const ground = new Uint8Array(BIOME_COUNT * 3);
    for (let biome = 0; biome < BIOME_COUNT; biome++) {
      const id = BIOME_GROUND[biome]?.atlas[0] ?? 0;
      const tile = this.tiles[id] ?? this.tiles[0];
      const [r, g, b] = tile
        ? averageTileColor(tile, 0, 0, tile.width, tile.height)
        : averageTileColor(this.scratch, 0, 0, 1, 1);
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
    const span = biome === Biome.Water ? 128 : TILE;
    const variant = tileVariant(biome, x, y, world.seed, span);
    if (biome === Biome.Water) {
      const kind = waterKind ?? waterBand((wx, wy) => this.biomeAt(world, wx, wy), x, y);
      const img = this.waterFrame(kind === 'deep' ? 'deep' : 'shallow');
      // One continuous sheet, so open water does not restart on every world tile.
      if (img) {
        this.blitSheet(ctx, img, dx, dy, stamp, {
          ox: x * TILE,
          oy: y * TILE,
          flipX: false,
          flipY: false,
        });
      }
    } else {
      const tile = this.tiles[variant.id] ?? this.tiles[0];
      if (tile) this.blitSheet(ctx, tile, dx, dy, stamp, variant);
    }
    this.paintRoad(ctx, world, x, y, biome, false, dx, dy, stamp);
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
