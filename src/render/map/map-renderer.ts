import {
  TILE,
  type CameraState,
  type ChunkData,
  type MapEntity,
  type PlayerState,
  type WorldData,
} from '../../core/world/models';
import type { MapSkinId } from '../../core/state/settings';
import { AssetLibrary } from './assets';
import { loadTrailbound, type RegionBake, type TrailboundTiles } from './trailbound-bake';
import { WorldRenderer } from './wm-renderer';

export interface MapDrawState {
  seed: number;
  heroX: number;
  heroY: number;
  heroYaw: number;
  townX: number;
  townY: number;
  townName: string;
  world?: WorldData | null;
  camera?: CameraState;
  player?: PlayerState;
  entities?: MapEntity[];
  chunks?: Map<string, ChunkData>;
}

/**
 * Canvas2D overworld. The default skin is the Pixel Kingdom pack, autotiled
 * the way trailbound-world-map draws grasslands.png. Trailbound 48 stays an
 * optional skin. Bakes are detached canvases, not on the document.
 */
export class MapRenderer {
  private disposed = false;
  private readonly assets = new AssetLibrary();
  private readonly worldRenderer: WorldRenderer;
  private trailbound: TrailboundTiles | null = null;
  private ready: Promise<void> | null = null;
  private bakedFor: WorldData | null = null;
  private skinId: MapSkinId = 'classic';
  private waterStamp = -1;
  private overviewStarted = 0;
  private detailDone = false;
  private readonly regionCache = new Map<string, RegionBake>();
  bakeMs = 0;
  detailMs = 0;
  /** Smoothed time of the map paint, in milliseconds. */
  drawMs = 0;
  frames = 0;
  private fpsWindow = 0;
  private fpsFrames = 0;
  fps = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.worldRenderer = new WorldRenderer(this.assets);
  }

  load(base = './'): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.loadSheets(base);
    return this.ready;
  }

  async setSkin(skin: MapSkinId, world: WorldData | null): Promise<void> {
    if (this.skinId === skin && this.bakedFor === world) return;
    this.skinId = skin;
    await this.load();
    this.worldRenderer.terrain = skin === 'trailbound48' ? this.trailbound : null;
    this.worldRenderer.clearChunks();
    this.worldRenderer.regions = [];
    this.regionCache.clear();
    this.detailDone = false;
    this.bakedFor = null;
    if (world) this.bake(world);
  }

  draw(state: MapDrawState): void {
    if (this.disposed) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const cssW = this.canvas.clientWidth || this.canvas.width;
    const cssH = this.canvas.clientHeight || this.canvas.height;
    if (cssW < 2 || cssH < 2) return;
    if (this.canvas.width !== cssW || this.canvas.height !== cssH) {
      this.canvas.width = cssW;
      this.canvas.height = cssH;
    }
    const now = performance.now();
    this.frames += 1;
    this.fpsFrames += 1;
    if (now - this.fpsWindow > 500) {
      this.fps = (this.fpsFrames * 1000) / (now - this.fpsWindow);
      this.fpsWindow = now;
      this.fpsFrames = 0;
    }
    const world = state.world;
    const camera = state.camera;
    const player = state.player;
    if (!world || !camera || !player || !this.assets.grasslands) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#7faf72';
      ctx.fillRect(0, 0, cssW, cssH);
      return;
    }
    if (this.bakedFor !== world) this.bake(world);
    const paintStarted = performance.now();
    const drawnEarly = camera;
    this.worldRenderer.chunkDestPx = Math.max(1, TILE * drawnEarly.scale);
    const frame = Math.floor(now / 220) % 4;
    if (frame !== this.waterStamp) {
      this.waterStamp = frame;
      this.worldRenderer.waterFrame = frame;
    }
    const drawn = drawnEarly;
    if (!(this.skinId === 'trailbound48' && this.trailbound?.coarseMip)) {
      this.fillRegions(world, drawn, cssW, cssH);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.worldRenderer.draw(ctx, world, drawn, player, cssW, cssH, {
      showOutlines: true,
      showPois: true,
      hoveredId: null,
      hoveredPoiId: null,
      hoveredEntityId: null,
      detailNode: null,
      entities: state.entities ?? [],
      chunks: state.chunks,
      showPlayer: true,
      spriteBuildings: true,
      cloudAmt: 0,
      heroYaw: state.heroYaw,
    });
    const paintMs = performance.now() - paintStarted;
    this.drawMs = this.drawMs === 0 ? paintMs : this.drawMs * 0.8 + paintMs * 0.2;
    this.bakeMs = this.worldRenderer.bakeMs;
  }

  get lodBytes(): number {
    return this.worldRenderer.lodBytes;
  }

  get farReady(): boolean {
    return this.worldRenderer.farReady;
  }

  syncChunks(chunks: Iterable<ChunkData>, world: WorldData): void {
    let baked = 0;
    for (const chunk of chunks) {
      if (this.worldRenderer.hasChunk(chunk.wx, chunk.wy)) continue;
      if (baked >= 6) break;
      const neighbors = new Map<string, ChunkData>();
      this.worldRenderer.bakeChunk(chunk, neighbors, world);
      baked += 1;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.worldRenderer.clearChunks();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private async loadSheets(base: string): Promise<void> {
    await this.assets.load(base);
    try {
      this.trailbound = await loadTrailbound(base);
    } catch (error) {
      console.error(error);
      this.trailbound = null;
    }
    this.worldRenderer.terrain = this.skinId === 'trailbound48' ? this.trailbound : null;
  }

  private fillRegions(world: WorldData, camera: CameraState, viewW: number, viewH: number): void {
    this.worldRenderer.regions = [];
    const tiles = this.trailbound;
    if (!tiles || this.skinId !== 'trailbound48') return;
    const tilePx = TILE * camera.scale;
    if (tilePx < 3) return;
    const stamp = tilePx >= 36 ? 48 : tilePx >= 12 ? 24 : 8;
    const span = stamp >= 48 ? 24 : stamp >= 24 ? 32 : 48;
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const xStart = Math.floor((camera.x - halfW) / span) * span;
    const yStart = Math.floor((camera.y - halfH) / span) * span;
    const xEnd = camera.x + halfW;
    const yEnd = camera.y + halfH;
    const wanted: Array<{ x: number; y: number; d: number }> = [];
    for (let y = yStart; y < yEnd + span; y += span) {
      if (y >= world.height || y + span <= 0) continue;
      for (let x = xStart; x < xEnd + span; x += span) {
        if (x >= world.width || x + span <= 0) continue;
        const dx = x + span * 0.5 - camera.x;
        const dy = y + span * 0.5 - camera.y;
        wanted.push({ x, y, d: dx * dx + dy * dy });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    const keep = new Set<string>();
    const regions: typeof this.worldRenderer.regions = [];
    const started = performance.now();
    const byteCap = 32 * 1024 * 1024;
    let bytes = 0;
    for (const block of wanted) {
      const key = `${block.x}:${block.y}:${stamp}`;
      let entry = this.regionCache.get(key);
      const est = span * stamp * span * stamp * 4;
      if (!entry && bytes + est > byteCap) continue;
      if (!entry) {
        entry = tiles.beginRegion(block.x, block.y, span, stamp);
        this.regionCache.set(key, entry);
      }
      keep.add(key);
      bytes += est;
      if (entry.row < span && performance.now() - started < 6) {
        tiles.stepRegion(world, entry, 4);
      }
      if (entry.row >= span) {
        regions.push({
          canvas: entry.canvas,
          x: block.x,
          y: block.y,
          span,
          shores: entry.shores,
          waters: entry.waters,
          curves: entry.curves,
        });
      }
    }
    for (const key of this.regionCache.keys()) {
      if (!keep.has(key)) this.regionCache.delete(key);
    }
    this.worldRenderer.regions = regions;
  }

  private bake(world: WorldData): void {
    this.worldRenderer.terrain = null;
    this.overviewStarted = performance.now();
    this.detailDone = this.skinId !== 'trailbound48';
    this.regionCache.clear();
    this.worldRenderer.bakeWorld(world);
    this.bakedFor = world;
    this.bakeMs = this.worldRenderer.bakeMs;
    this.detailMs = 0;
  }
}
