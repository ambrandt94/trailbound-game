import {
  DETAIL_START,
  TILE,
  type CameraState,
  type ChunkData,
  type MapEntity,
  type PlayerState,
  type WorldData,
} from '../../core/world/models';
import type { MapSkinId } from '../../core/state/settings';
import { AssetLibrary } from './assets';
import { loadTrailbound, type TrailboundTiles } from './trailbound-bake';
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
 * Canvas2D overworld. Classic uses the frozen map's sheets. Trailbound 48
 * stamps Alex's atlas through the same camera, with the map sprites on top.
 * Bakes are detached canvases, not on the document.
 */
export class MapRenderer {
  private disposed = false;
  private readonly assets = new AssetLibrary();
  private readonly worldRenderer: WorldRenderer;
  private trailbound: TrailboundTiles | null = null;
  private ready: Promise<void> | null = null;
  private bakedFor: WorldData | null = null;
  private skinId: MapSkinId = 'trailbound48';
  private waterStamp = -1;
  private readonly regionCache = new Map<string, { canvas: HTMLCanvasElement; frame: number }>();
  bakeMs = 0;
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
    const frame = Math.floor(now / 220) % 4;
    if (frame !== this.waterStamp) {
      this.waterStamp = frame;
      this.worldRenderer.waterFrame = frame;
    }
    this.fillRegions(world, camera, cssW, cssH, frame);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.worldRenderer.draw(ctx, world, camera, player, cssW, cssH, {
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
    });
    this.bakeMs = this.worldRenderer.bakeMs;
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

  private fillRegions(
    world: WorldData,
    camera: CameraState,
    viewW: number,
    viewH: number,
    frame: number,
  ): void {
    this.worldRenderer.regions = [];
    const tiles = this.trailbound;
    if (!tiles || this.skinId !== 'trailbound48') return;
    const tilePx = TILE * camera.scale;
    if (tilePx < 8 || camera.scale >= DETAIL_START) return;
    const span = 24;
    const stamp = 48;
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const xStart = Math.floor((camera.x - halfW) / span) * span;
    const yStart = Math.floor((camera.y - halfH) / span) * span;
    const xEnd = camera.x + halfW;
    const yEnd = camera.y + halfH;
    const regions: Array<{ canvas: HTMLCanvasElement; x: number; y: number; span: number }> = [];
    let baked = 0;
    for (let y = yStart; y < yEnd + span; y += span) {
      if (y >= world.height) break;
      for (let x = xStart; x < xEnd + span; x += span) {
        if (y < 0) continue;
        const key = `${x}:${y}`;
        let entry = this.regionCache.get(key);
        if (!entry && baked < 2) {
          tiles.frame = frame;
          const canvas = tiles.bakeRegion(world, x, y, span, stamp);
          entry = { canvas, frame };
          this.regionCache.set(key, entry);
          baked += 1;
        }
        if (entry) regions.push({ canvas: entry.canvas, x, y, span });
      }
    }
    if (this.regionCache.size > 72) {
      const drop = this.regionCache.size - 48;
      let removed = 0;
      for (const key of this.regionCache.keys()) {
        this.regionCache.delete(key);
        removed += 1;
        if (removed >= drop) break;
      }
    }
    this.worldRenderer.regions = regions;
  }

  private bake(world: WorldData): void {
    this.worldRenderer.terrain = this.skinId === 'trailbound48' ? this.trailbound : null;
    this.worldRenderer.bakeWorld(world);
    this.bakedFor = world;
    this.bakeMs = this.worldRenderer.bakeMs;
  }
}
