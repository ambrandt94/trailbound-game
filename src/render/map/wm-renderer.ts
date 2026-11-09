import {
  Biome,
  type CameraState,
  type ChunkData,
  DETAIL_END,
  DETAIL_START,
  type MapEntity,
  type MapNode,
  type PlacedSprite,
  type WorldFeature,
  POI_LABELS,
  type PoiKind,
  type PlayerState,
  TILE,
  type WorldData,
  ZONE_SCALE,
  BIOME_COUNT,
  biomeAt,
  clamp,
  chunkKey,
  isInstancedZone,
  lerp,
  nodeBounds,
  poiFootprintTiles,
  smoothstep,
} from '../../core/world/models';
import {
  CLOSE_MARKER_SCALE,
  NEAR_POI_TILES,
  fineToDisplay,
  markerDisplay,
  wagonTrailFine,
} from '../../core/world/map-grid';
import { type ChatBubble, peerMarkerColor } from './markers';
import { LOCAL_PLAYER_ID } from '../../core/sim/player';
import { pixelSnapScale } from './map-camera';
import { AssetLibrary, drawCharFrame } from './assets';
import { armyVisibleFollowers, boatChar, kindColor } from '../../core/sim/entities';
import {
  buildingDrawOrigin,
  buildingDrawScale,
  buildingRoofFrac,
  isBuildingSprite,
} from '../../core/world/buildings';
import { paintChunkRoofs } from './building-draw';
import {
  placedMask,
  structureBounds,
  templateById,
  templatesForType,
} from '../../core/world/building-templates';
import {
  CELL_DOOR,
  CELL_FLOOR,
  CELL_VOID,
  CELL_WALL,
  type InteriorPlan,
  interiorWallFill,
  isShellWall,
} from '../../core/world/interior';
import { hash2 } from '../../core/world/noise';
import {
  biomeSeason,
  blobLocal,
  decoFor,
  FLOORS,
  GROUPS,
  overlayGroup,
  tileSrc,
} from '../../core/world/tileset';
import { buildCoarseMap, type CoarseMap } from './coarse-map';
import {
  bakeElevationOverlay,
  buildContours,
  contourWindow,
  type ContourPaths,
} from './height-view';
import type { OverviewJob, TrailboundTiles } from './trailbound-bake';
import {
  CHUNK_SCREEN_PX,
  FarSheet,
  averageTileColor,
  mipFactorFor,
  solidPalette,
  type GroundPalette,
} from './detail-lod';
import { ImageLodCache, downsampleCanvas } from './lod-cache';

const PIXEL_FONT = 'Tiny5, "Press Start 2P", ui-monospace, monospace';

function paintYard(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ix: number,
  iy: number,
): void {
  ctx.fillStyle = 'rgba(124, 96, 52, 0.48)';
  ctx.fillRect(px, py, TILE, TILE);
  const n = hash2(ix, iy, 77);
  ctx.fillStyle = n > 0.62 ? 'rgba(72, 52, 28, 0.7)' : 'rgba(186, 156, 92, 0.62)';
  const ox = 2 + Math.floor(hash2(ix, iy, 3) * 10);
  const oy = 2 + Math.floor(hash2(ix, iy, 9) * 10);
  ctx.fillRect(px + ox, py + oy, 2, 2);
  if (hash2(ix, iy, 11) > 0.45) {
    ctx.fillStyle = 'rgba(78, 108, 48, 0.5)';
    ctx.fillRect(px + ((ox + 6) % 12), py + ((oy + 8) % 12), 2, 2);
  }
}

function spriteBuildingPose(
  spr: PlacedSprite,
  x: number,
  y: number,
): { x: number; y: number; footW?: number } {
  const tmpl = (spr.templateId && templateById(spr.templateId)) || templatesForType(spr.sprite)[0];
  const mask = tmpl ? placedMask(tmpl.id, spr.rotation ?? 0) : null;
  if (!tmpl || !mask) return { x, y, footW: spr.footW };
  const bounds = structureBounds(mask.parts, mask.w, mask.d);
  const plotW = spr.footW ?? mask.w;
  const plotD = spr.footD ?? mask.d;
  const left = x - plotW / 2 / ZONE_SCALE;
  const top = y - plotD / ZONE_SCALE;
  return {
    x: left + (bounds.x + bounds.w / 2) / ZONE_SCALE,
    y: top + (bounds.y + bounds.d) / ZONE_SCALE,
    footW: bounds.w,
  };
}

type TagBox = { x: number; y: number; w: number; h: number };

function boxesOverlap(a: TagBox, b: TagBox, pad = 0): boolean {
  return (
    a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y
  );
}

const NAMETAG_BASE_PX = 10;

function applyPoint(tr: DOMMatrix, x: number, y: number): { x: number; y: number } {
  return { x: tr.a * x + tr.c * y + tr.e, y: tr.b * x + tr.d * y + tr.f };
}

function applyBox(tr: DOMMatrix, b: TagBox): TagBox {
  const p = applyPoint(tr, b.x, b.y);
  const q = applyPoint(tr, b.x + b.w, b.y + b.h);
  return {
    x: Math.min(p.x, q.x),
    y: Math.min(p.y, q.y),
    w: Math.abs(q.x - p.x),
    h: Math.abs(q.y - p.y),
  };
}

function drawCampMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  token: 'camp' | 'wagon-circle',
): TagBox {
  const px = x * TILE;
  const py = y * TILE;
  const r = (token === 'wagon-circle' ? 13 : 10) / Math.max(0.2, scale);
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = token === 'wagon-circle' ? 'rgba(196, 149, 90, 0.92)' : 'rgba(110, 78, 48, 0.92)';
  ctx.fill();
  ctx.lineWidth = 1.6 / Math.max(0.2, scale);
  ctx.strokeStyle = '#1a120c';
  ctx.stroke();
  if (token === 'wagon-circle') {
    ctx.beginPath();
    ctx.arc(px, py, r * 0.58, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(px, py - r * 0.7);
    ctx.lineTo(px + r * 0.55, py + r * 0.45);
    ctx.lineTo(px - r * 0.55, py + r * 0.45);
    ctx.closePath();
    ctx.fillStyle = '#e6d2a8';
    ctx.fill();
    ctx.stroke();
  }
  return { x: px - r, y: py - r, w: r * 2, h: r * 2 };
}

function drawNametag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  opts?: {
    clearAbove?: number;
    clearBelow?: number;
    avoid?: TagBox[];
    taken?: TagBox[];
    screenPx?: number;
  },
): TagBox | null {
  return drawTagLabel(ctx, text, x, y, scale, { ...opts, kind: 'name' });
}

/** Nearest-neighbour camera. Translation is whole pixels so tiles stay crisp while zoom eases. */
function cameraTransform(
  ctx: CanvasRenderingContext2D,
  camera: CameraState,
  viewW: number,
  viewH: number,
  snap = true,
): void {
  const scale = snap ? pixelSnapScale(camera.scale) : camera.scale;
  const ox = Math.round(viewW / 2 - camera.x * TILE * scale);
  const oy = Math.round(viewH / 2 - camera.y * TILE * scale);
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  ctx.imageSmoothingEnabled = false;
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  opts?: {
    clearAbove?: number;
    clearBelow?: number;
    avoid?: TagBox[];
    taken?: TagBox[];
    screenPx?: number;
  },
): TagBox | null {
  return drawTagLabel(ctx, text, x, y, scale, { ...opts, kind: 'speech' });
}

function drawTagLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  opts?: {
    clearAbove?: number;
    clearBelow?: number;
    avoid?: TagBox[];
    taken?: TagBox[];
    screenPx?: number;
    kind?: 'name' | 'speech';
  },
): TagBox | null {
  const raw = text.trim();
  if (!raw) return null;
  const kind = opts?.kind ?? 'name';
  const tr = ctx.getTransform();
  const dpr = Math.max(0.5, Math.hypot(tr.a, tr.b) / Math.max(0.001, scale));
  const screenPx = opts?.screenPx ?? NAMETAG_BASE_PX * (kind === 'speech' ? 2.8 : 2.5);
  const fontPx = Math.max(8, screenPx * dpr);
  const origin = applyPoint(tr, x, y);
  const uy = Math.hypot(tr.c, tr.d) || dpr * scale;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.font = `${fontPx}px ${PIXEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = (kind === 'speech' ? 16 : 13.2) * screenPx * dpr;
  let label = raw;
  while (ctx.measureText(label).width > maxW && label.length > 5) label = label.slice(0, -1);
  if (label !== raw) label = `${label.slice(0, -1)}…`;
  const tw = ctx.measureText(label).width;
  const padX = (kind === 'speech' ? 7.2 : 4.2) * dpr;
  const padY = (kind === 'speech' ? 4.2 : 2.1) * dpr;
  const tail = kind === 'speech' ? 5.5 * dpr : 0;
  const boxW = tw + padX * 2;
  const boxH = fontPx + padY * 2;
  const gap = (kind === 'speech' ? 5.5 : 3.2) * dpr;
  const clearA = (opts?.clearAbove ?? 0) * uy;
  const clearB = (opts?.clearBelow ?? 0) * uy;
  const aboveY = origin.y - clearA - gap - boxH / 2 - (kind === 'speech' ? tail * 0.35 : 0);
  const belowY = origin.y + clearB + gap + boxH / 2 + (kind === 'speech' ? tail * 0.35 : 0);
  const stackedY = aboveY - boxH - gap;
  const candidates: Array<{ cx: number; cy: number; flip: boolean }> =
    kind === 'speech'
      ? [
          { cx: origin.x, cy: aboveY, flip: false },
          { cx: origin.x, cy: stackedY, flip: false },
          { cx: origin.x + boxW * 0.55, cy: aboveY, flip: false },
          { cx: origin.x - boxW * 0.55, cy: aboveY, flip: false },
          { cx: origin.x + boxW * 0.55, cy: stackedY, flip: false },
          { cx: origin.x - boxW * 0.55, cy: stackedY, flip: false },
          { cx: origin.x, cy: belowY, flip: true },
        ]
      : [
          { cx: origin.x, cy: aboveY, flip: false },
          { cx: origin.x, cy: stackedY, flip: false },
          { cx: origin.x + boxW * 0.55, cy: aboveY, flip: false },
          { cx: origin.x - boxW * 0.55, cy: aboveY, flip: false },
          { cx: origin.x, cy: belowY, flip: true },
        ];
  const avoid = (opts?.avoid ?? []).map((b) => applyBox(tr, b));
  const taken = opts?.taken ?? [];
  let best: TagBox | null = null;
  let flip = false;
  for (const c of candidates) {
    const box: TagBox = {
      x: c.cx - boxW / 2,
      y: c.cy - boxH / 2,
      w: boxW,
      h: boxH + (kind === 'speech' ? tail : 0),
    };
    const hitsSprite = avoid.some((s) => boxesOverlap(box, s, 1.2 * dpr));
    const hitsTag = taken.some((s) => boxesOverlap(box, s, 2 * dpr));
    if (!hitsSprite && !hitsTag) {
      best = { x: c.cx - boxW / 2, y: c.cy - boxH / 2, w: boxW, h: boxH };
      flip = c.flip;
      break;
    }
    if (!best && !hitsSprite) {
      best = { x: c.cx - boxW / 2, y: c.cy - boxH / 2, w: boxW, h: boxH };
      flip = c.flip;
    }
  }
  if (!best) {
    best = { x: origin.x - boxW / 2, y: aboveY - boxH / 2, w: boxW, h: boxH };
  }
  const r = (kind === 'speech' ? 8 : 2.2) * dpr;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(best.x, best.y, best.w, best.h, r);
  else ctx.rect(best.x, best.y, best.w, best.h);
  if (kind === 'speech') {
    ctx.fillStyle = 'rgba(248, 241, 226, 0.96)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 1.6 * dpr);
    ctx.strokeStyle = 'rgba(42, 28, 16, 0.78)';
    ctx.stroke();
    const midX = best.x + best.w / 2;
    ctx.beginPath();
    if (!flip) {
      ctx.moveTo(midX - 5 * dpr, best.y + best.h - 0.5);
      ctx.lineTo(midX, best.y + best.h + tail);
      ctx.lineTo(midX + 5 * dpr, best.y + best.h - 0.5);
    } else {
      ctx.moveTo(midX - 5 * dpr, best.y + 0.5);
      ctx.lineTo(midX, best.y - tail);
      ctx.lineTo(midX + 5 * dpr, best.y + 0.5);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(248, 241, 226, 0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(42, 28, 16, 0.78)';
    ctx.stroke();
    ctx.fillStyle = '#2a1c12';
  } else {
    ctx.fillStyle = 'rgba(14, 11, 9, 0.82)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = 'rgba(228, 196, 138, 0.35)';
    ctx.stroke();
    ctx.fillStyle = '#f3ead6';
  }
  ctx.fillText(label, best.x + best.w / 2, best.y + best.h / 2 + 0.4 * dpr);
  ctx.restore();
  const occupied: TagBox = {
    x: best.x,
    y: flip && kind === 'speech' ? best.y - tail : best.y,
    w: best.w,
    h: best.h + (kind === 'speech' ? tail : 0),
  };
  taken.push(occupied);
  return occupied;
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
): void {
  ctx.drawImage(img, sx, sy, TILE, TILE, dx, dy, TILE, TILE);
}

function spriteWorldScale(img: HTMLImageElement): number {
  const tall = img.height >= 160 || img.width >= 160;
  const prop = img.height < 96 && img.width < 96;
  const targetH = TILE * (tall ? 0.7 : prop ? 0.3 : 0.48);
  const targetW = TILE * (tall ? 0.62 : prop ? 0.26 : 0.42);
  return Math.min(targetH / img.height, targetW / img.width);
}

/** One sprite pixel matches one inner-zone tile pixel. */
function characterWorldH(pxH: number): number {
  return pxH / ZONE_SCALE;
}

function grassSrc(biome: Biome): { sx: number; sy: number } {
  return tileSrc(GROUPS.plateau, biomeSeason(biome === Biome.Water ? Biome.Plains : biome), 1, 1);
}

function pathSeason(biome: Biome): number {
  return biomeSeason(biome);
}

type ChunkImage = CanvasImageSource & { width: number; height: number };

interface ClassicBlock {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  span: number;
  stamp: number;
  row: number;
}

function worldWrapShifts(
  cameraX: number,
  halfW: number,
  width: number,
  viewTilesX: number,
): number[] {
  if (viewTilesX >= width * 0.92) return [0];
  const shifts = [0];
  if (cameraX - halfW < 0) shifts.push(-width);
  if (cameraX + halfW > width) shifts.push(width);
  return shifts;
}

function drawBoatMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
  facing: number,
  kind: MapEntity['kind'],
): void {
  const s = (kind === 'army' ? 14 : kind === 'caravan' ? 12 : 10) / scale;
  ctx.save();
  ctx.translate(x * TILE, y * TILE);
  const rot = [Math.PI, -Math.PI / 2, Math.PI / 2, 0][facing & 3]!;
  ctx.rotate(rot);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.95);
  ctx.lineTo(s * 0.38, s * 0.22);
  ctx.lineTo(s * 0.22, s * 0.55);
  ctx.lineTo(-s * 0.22, s * 0.55);
  ctx.lineTo(-s * 0.38, s * 0.22);
  ctx.closePath();
  ctx.fillStyle = '#6b3d18';
  ctx.fill();
  ctx.lineWidth = 1.2 / scale;
  ctx.strokeStyle = '#1a120c';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, s * 0.28);
  ctx.lineTo(0, -s * 1.05);
  ctx.strokeStyle = '#2a1810';
  ctx.lineWidth = 1.4 / scale;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.4 / scale, -s * 0.98);
  ctx.lineTo(s * 0.72, -s * 0.12);
  ctx.lineTo(0.4 / scale, s * 0.2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#f3efe6';
  ctx.lineWidth = 0.9 / scale;
  ctx.stroke();
  ctx.restore();
}

export class WorldRenderer {
  worldBake: CanvasImageSource | null = null;
  /** Fine tiles per map tile. The sheet is this many times coarser than the world. */
  mapStep = 1;
  private mapWidth = 0;
  private mapHeight = 0;
  private coarseFeatures: WorldFeature[] | null = null;
  zoneBake: HTMLCanvasElement | null = null;
  cloudBake: HTMLCanvasElement | null = null;
  /** When false, chunk bakes omit tile roofs so Town Tale sprites can stand in. */
  bakeRoofs = true;
  /** Screen pixels per world tile from the last draw. Chunk mips match this. */
  chunkDestPx = CHUNK_SCREEN_PX;
  private readonly chunkCache = new ImageLodCache<ChunkImage>(48 * 1024 * 1024);
  private readonly classicCache = new ImageLodCache<ClassicBlock>(32 * 1024 * 1024);
  private readonly far = new FarSheet(
    solidPalette(
      BIOME_COUNT,
      { r: 127, g: 175, b: 114 },
      { r: 196, g: 164, b: 108 },
      { r: 60, g: 128, b: 142 },
    ),
  );
  private paletteWorld: WorldData | null = null;
  private paletteKind = '';
  private classicStamp = 0;
  private isoLayer: HTMLCanvasElement | null = null;
  private fogLayer: HTMLCanvasElement | null = null;
  private blurLayer: HTMLCanvasElement | null = null;
  private tagScreenPx = NAMETAG_BASE_PX * 2.5;
  private heightWorld: WorldData | null = null;
  private heightBake: HTMLCanvasElement | null = null;
  private contourKey = '';
  private contourPaths: ContourPaths | null = null;

  terrain: TrailboundTiles | null = null;
  waterFrame = 0;
  /** Higher-resolution terrain for the visible window, drawn over the kingdom bake. */
  regions: Array<{
    canvas: CanvasImageSource;
    x: number;
    y: number;
    span: number;
    shores: Array<{ lx: number; ly: number; bits: number }>;
    waters: Array<{
      lx: number;
      ly: number;
      kind: 'shallow' | 'deep';
      ox: number;
      oy: number;
      flipX: boolean;
      flipY: boolean;
    }>;
    curves: Array<{
      lx: number;
      ly: number;
      foam: readonly [CanvasImageSource, CanvasImageSource] | null;
    }>;
  }> = [];
  private heroYaw = 0;
  private featureBuckets: Map<string, WorldFeature[]> | null = null;
  private featureWorld: WorldData | null = null;
  /** Last overworld bake, in milliseconds. First paint is the flat pass. */
  bakeMs = 0;
  detailMs = 0;
  overview: OverviewJob | null = null;

  constructor(private readonly assets: AssetLibrary) {}

  bakeWorld(world: WorldData): void {
    const started = performance.now();
    this.far.clear();
    this.classicCache.clear();
    this.classicStamp = 0;
    this.paletteWorld = null;
    this.featureWorld = null;
    this.featureBuckets = null;
    const coarse = buildCoarseMap({
      width: world.width,
      height: world.height,
      biomes: world.biomes,
      paths: world.paths,
      seed: world.seed,
    });
    this.mapStep = coarse.step;
    this.mapWidth = coarse.width;
    this.mapHeight = coarse.height;
    const marks = coarse.features.slice();
    for (const feature of world.features) {
      if (feature.kind === 'landmark') marks.push(feature);
    }
    this.coarseFeatures = marks;
    this.bakeCoarseSheet(coarse);
    this.bakeMs = performance.now() - started;
  }

  /** One 16 px Pixel Kingdom tile per coarse cell. Built once; zoom never rebuilds it. */
  private bakeCoarseSheet(coarse: CoarseMap): void {
    const { width, height } = coarse;
    const canvas = document.createElement('canvas');
    canvas.width = width * TILE;
    canvas.height = height * TILE;
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.assets.grasslands) {
      this.worldBake = canvas;
      return;
    }
    ctx.imageSmoothingEnabled = false;
    const g = this.assets.grasslands;
    const at = (x: number, y: number): Biome => {
      if (y < 0 || y >= height) return Biome.Water;
      const wx = ((x % width) + width) % width;
      return coarse.biomes[wx + y * width] as Biome;
    };
    const stamp = (sx: number, sy: number, cx: number, cy: number) => {
      ctx.drawImage(g, sx, sy, TILE, TILE, cx * TILE, cy * TILE, TILE, TILE);
    };
    for (let cy = 0; cy < height; cy++) {
      for (let cx = 0; cx < width; cx++) {
        const biome = at(cx, cy);
        const grass = grassSrc(biome);
        stamp(grass.sx, grass.sy, cx, cy);
        const group = overlayGroup(biome);
        if (group !== null) {
          const [lx, ly] = blobLocal(
            at(cx, cy - 1) === biome,
            at(cx + 1, cy) === biome,
            at(cx, cy + 1) === biome,
            at(cx - 1, cy) === biome,
          );
          const src = tileSrc(group, biomeSeason(biome), lx, ly);
          stamp(src.sx, src.sy, cx, cy);
        }
        if (coarse.paths[cx + cy * width] && biome !== Biome.Water) {
          const wrap = (ix: number) => ((ix % width) + width) % width;
          const on = (x: number, y: number) =>
            y >= 0 && y < height && coarse.paths[wrap(x) + y * width] === 1;
          const [lx, ly] = blobLocal(
            on(cx, cy - 1),
            on(cx + 1, cy),
            on(cx, cy + 1),
            on(cx - 1, cy),
          );
          const src = tileSrc(GROUPS.path, pathSeason(biome), lx, ly);
          stamp(src.sx, src.sy, cx, cy);
        }
        const deco = (cx * 17 + cy * 31 + biome * 7) % 23;
        if ((biome === Biome.Plains || biome === Biome.Meadow) && deco === 0) {
          const d = decoFor(biome, 'flower');
          stamp(d.sx, d.sy, cx, cy);
        } else if (biome === Biome.Meadow && deco === 4) {
          const d = decoFor(biome, 'leaf');
          stamp(d.sx, d.sy, cx, cy);
        } else if (
          (biome === Biome.Hills || biome === Biome.Heath || biome === Biome.Desert) &&
          deco === 2
        ) {
          const d = decoFor(biome, 'pebble');
          stamp(d.sx, d.sy, cx, cy);
        } else if (biome === Biome.Water && deco === 5) {
          const d = decoFor(biome, 'ripple');
          stamp(d.sx, d.sy, cx, cy);
        } else if ((biome === Biome.Marsh || biome === Biome.Jungle) && deco === 6) {
          const d = decoFor(biome, 'lily');
          stamp(d.sx, d.sy, cx, cy);
        }
      }
    }
    this.worldBake = canvas;
  }

  private bakeWorldTileset(world: WorldData, step: number, stamp: number): void {
    const cellsX = Math.ceil(world.width / step);
    const cellsY = Math.ceil(world.height / step);
    const cellBiomes = new Uint8Array(cellsX * cellsY);
    const cellPaths = new Uint8Array(cellsX * cellsY);
    const counts = new Array<number>(BIOME_COUNT).fill(0);

    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        counts.fill(0);
        let pathN = 0;
        let landN = 0;
        const x0 = cx * step;
        const y0 = cy * step;
        const x1 = Math.min(world.width, x0 + step);
        const y1 = Math.min(world.height, y0 + step);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const biome = world.biomes[x + y * world.width] ?? 0;
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
          if (counts[b]! > bestN) {
            bestN = counts[b]!;
            best = b;
          }
        }
        const area = Math.max(1, (x1 - x0) * (y1 - y0));
        const waterN = counts[Biome.Water] ?? 0;
        if (waterN / area >= 0.22) best = Biome.Water;
        const i = cx + cy * cellsX;
        cellBiomes[i] = best;
        cellPaths[i] = landN && pathN / Math.max(1, landN) > 0.08 ? 1 : 0;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = cellsX * stamp;
    canvas.height = cellsY * stamp;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const g = this.assets.grasslands;
    const stampTile = (sx: number, sy: number, cx: number, cy: number) => {
      ctx.drawImage(g, sx, sy, TILE, TILE, cx * stamp, cy * stamp, stamp, stamp);
    };
    const cellAt = (cx: number, cy: number): Biome => {
      if (cy < 0 || cy >= cellsY) return Biome.Water;
      const wx = ((cx % cellsX) + cellsX) % cellsX;
      return cellBiomes[wx + cy * cellsX] as Biome;
    };

    for (let cy = 0; cy < cellsY; cy++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const biome = cellBiomes[cx + cy * cellsX] as Biome;
        const grass = grassSrc(biome);
        stampTile(grass.sx, grass.sy, cx, cy);

        const group = overlayGroup(biome);
        if (group !== null) {
          const n = cellAt(cx, cy - 1) === biome;
          const e = cellAt(cx + 1, cy) === biome;
          const s = cellAt(cx, cy + 1) === biome;
          const w = cellAt(cx - 1, cy) === biome;
          const [lx, ly] = blobLocal(n, e, s, w);
          const src = tileSrc(group, biomeSeason(biome), lx, ly);
          stampTile(src.sx, src.sy, cx, cy);
        }

        if (cellPaths[cx + cy * cellsX] && biome !== Biome.Water) {
          const wrap = (ix: number) => ((ix % cellsX) + cellsX) % cellsX;
          const pn = cy > 0 && !!cellPaths[cx + (cy - 1) * cellsX];
          const pe = !!cellPaths[wrap(cx + 1) + cy * cellsX];
          const ps = cy + 1 < cellsY && !!cellPaths[cx + (cy + 1) * cellsX];
          const pw = !!cellPaths[wrap(cx - 1) + cy * cellsX];
          const [lx, ly] = blobLocal(pn, pe, ps, pw);
          const src = tileSrc(GROUPS.path, pathSeason(biome), lx, ly);
          stampTile(src.sx, src.sy, cx, cy);
        }

        const deco = (cx * 17 + cy * 31 + biome * 7) % 23;
        if ((biome === Biome.Plains || biome === Biome.Meadow) && deco === 0) {
          const d = decoFor(biome, 'flower');
          stampTile(d.sx, d.sy, cx, cy);
        } else if (biome === Biome.Meadow && deco === 4) {
          const d = decoFor(biome, 'leaf');
          stampTile(d.sx, d.sy, cx, cy);
        } else if (
          (biome === Biome.Hills || biome === Biome.Heath || biome === Biome.Desert) &&
          deco === 2
        ) {
          const d = decoFor(biome, 'pebble');
          stampTile(d.sx, d.sy, cx, cy);
        } else if (biome === Biome.Water && deco === 5) {
          const d = decoFor(biome, 'ripple');
          stampTile(d.sx, d.sy, cx, cy);
        } else if ((biome === Biome.Marsh || biome === Biome.Jungle) && deco === 6) {
          const d = decoFor(biome, 'lily');
          stampTile(d.sx, d.sy, cx, cy);
        }
      }
    }

    this.worldBake = canvas;
  }

  bakeZones(world: WorldData): HTMLCanvasElement | null {
    const nodes = world.nodes;
    const w = Math.max(1, Math.min(2048, world.width));
    const h = Math.max(1, Math.min(2048, world.height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.zoneBake = canvas;
      return canvas;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const sx = w / world.width;
    const sy = h / world.height;
    const paint = (node: MapNode) => {
      const tiles = node.tiles;
      const rgb = countyRgb(node);
      const fill = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${node.poiKind ? 0.88 : 0.72})`;
      if (!tiles?.length) {
        const b = nodeBounds(node);
        ctx.fillStyle = fill;
        ctx.fillRect(
          b.x0 * sx,
          b.y0 * sy,
          Math.max(1, (b.x1 - b.x0) * sx),
          Math.max(1, (b.y1 - b.y0) * sy),
        );
        return;
      }
      ctx.fillStyle = fill;
      for (const t of tiles) {
        ctx.fillRect(t.x * sx, t.y * sy, Math.max(1, sx), Math.max(1, sy));
      }
    };
    for (const node of nodes) {
      if (node.poiKind) continue;
      paint(node);
    }
    for (const node of nodes) {
      if (!node.poiKind) continue;
      paint(node);
    }
    this.zoneBake = canvas;
    return canvas;
  }

  bakeClouds(world: WorldData, explored: Set<string>): HTMLCanvasElement | null {
    const span = Math.max(world.width, world.height);
    const cell = Math.max(1, Math.ceil(span / 640));
    const w = Math.max(1, Math.ceil(world.width / cell));
    const h = Math.max(1, Math.ceil(world.height / cell));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.cloudBake = canvas;
      return canvas;
    }
    const img = ctx.createImageData(w, h);
    const pix = img.data;
    const seed = world.seed ^ 0xf09;
    const clear = new Uint8Array(w * h);
    for (let py = 0; py < h; py++) {
      const wy = Math.min(world.height - 1, Math.floor(py * cell + cell * 0.5));
      for (let px = 0; px < w; px++) {
        const wx = Math.min(world.width - 1, Math.floor(px * cell + cell * 0.5));
        const water = world.biomes[wx + wy * world.width] === Biome.Water;
        if (water || explored.has(`${wx},${wy}`)) clear[px + py * w] = 1;
      }
    }
    const rim = (px: number, py: number): boolean => {
      if (px > 0 && clear[px - 1 + py * w]) return true;
      if (px + 1 < w && clear[px + 1 + py * w]) return true;
      if (py > 0 && clear[px + (py - 1) * w]) return true;
      if (py + 1 < h && clear[px + (py + 1) * w]) return true;
      return false;
    };
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const i = px + py * w;
        const oi = i * 4;
        if (clear[i]) {
          pix[oi + 3] = 0;
          continue;
        }
        const n = hash2(px, py, seed);
        const shade = rim(px, py) ? 12 : 20 + n * 10;
        pix[oi] = shade;
        pix[oi + 1] = shade + 4;
        pix[oi + 2] = shade + 8;
        pix[oi + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.cloudBake = canvas;
    return canvas;
  }

  bakeChunk(chunk: ChunkData, neighbors: Map<string, ChunkData>, world: WorldData): void {
    if (this.terrain) {
      this.terrain.frame = this.waterFrame;
      const baked = this.terrain.bakeChunk(chunk, world);
      this.storeChunk(chunk.wx, chunk.wy, baked);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = chunk.size * TILE;
    canvas.height = chunk.size * TILE;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const g = this.assets.grasslands;
    const floors = this.assets.floors;
    const street = FLOORS[chunk.streetFloor] ?? FLOORS[0]!;
    const plaza = FLOORS[chunk.plazaFloor] ?? FLOORS[4]!;
    const size = chunk.size;

    const tileAt = (lx: number, ly: number): Biome => {
      let wx = chunk.wx;
      let wy = chunk.wy;
      let x = lx;
      let y = ly;
      if (lx < 0) {
        wx -= 1;
        x = size + lx;
      } else if (lx >= size) {
        wx += 1;
        x = lx - size;
      }
      if (ly < 0) {
        wy -= 1;
        y = size + ly;
      } else if (ly >= size) {
        wy += 1;
        y = ly - size;
      }
      if (wx === chunk.wx && wy === chunk.wy) return chunk.tiles[x + y * size] as Biome;
      const other = neighbors.get(chunkKey(wx, wy));
      if (other) return other.tiles[x + y * size] as Biome;
      return biomeAt(world, wx + 0.5, wy + 0.5);
    };

    const pathAt = (lx: number, ly: number): boolean => {
      let wx = chunk.wx;
      let wy = chunk.wy;
      let x = lx;
      let y = ly;
      if (lx < 0) {
        wx -= 1;
        x = size + lx;
      } else if (lx >= size) {
        wx += 1;
        x = lx - size;
      }
      if (ly < 0) {
        wy -= 1;
        y = size + ly;
      } else if (ly >= size) {
        wy += 1;
        y = ly - size;
      }
      if (wx === chunk.wx && wy === chunk.wy) return !!chunk.paths[x + y * size];
      const other = neighbors.get(chunkKey(wx, wy));
      if (other) return !!other.paths[x + y * size];
      if (wx < 0 || wy < 0 || wx >= world.width || wy >= world.height) return false;
      return !!world.paths[wx + wy * world.width];
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const biome = chunk.tiles[x + y * size] as Biome;
        const grass = grassSrc(biome);
        drawTile(ctx, g, grass.sx, grass.sy, x * TILE, y * TILE);
        const group = overlayGroup(biome);
        if (group !== null) {
          const n = tileAt(x, y - 1) === biome;
          const e = tileAt(x + 1, y) === biome;
          const s = tileAt(x, y + 1) === biome;
          const w = tileAt(x - 1, y) === biome;
          const [lx, ly] = blobLocal(n, e, s, w);
          const src = tileSrc(group, biomeSeason(biome), lx, ly);
          drawTile(ctx, g, src.sx, src.sy, x * TILE, y * TILE);
        }
        const floor = chunk.cobble[x + y * size];
        if (floor === 3 && biome !== Biome.Water) {
          paintYard(ctx, x * TILE, y * TILE, chunk.wx * size + x, chunk.wy * size + y);
        } else if (floor && biome !== Biome.Water) {
          const src = floor === 2 ? plaza : street;
          drawTile(ctx, floors, src.sx, src.sy, x * TILE, y * TILE);
        } else if (chunk.paths[x + y * size] && biome !== Biome.Water) {
          const [lx, ly] = blobLocal(
            pathAt(x, y - 1),
            pathAt(x + 1, y),
            pathAt(x, y + 1),
            pathAt(x - 1, y),
          );
          const src = tileSrc(GROUPS.path, biomeSeason(biome), lx, ly);
          drawTile(ctx, g, src.sx, src.sy, x * TILE, y * TILE);
        }
      }
    }

    if (this.bakeRoofs) paintChunkRoofs(ctx, chunk, neighbors);
    this.storeChunk(chunk.wx, chunk.wy, canvas);
  }

  clearChunks(): void {
    this.chunkCache.clear();
  }

  get lodBytes(): number {
    return this.far.bytes + this.chunkCache.bytes + this.classicCache.bytes;
  }

  get farReady(): boolean {
    return this.far.ready;
  }

  /**
   * One texel per world tile, from the active skin. The coarse bake shows
   * through until each block is painted.
   */
  stepFarSheet(world: WorldData, focusX: number, focusY: number, budgetMs: number): boolean {
    this.ensureFarPalette(world);
    return this.far.step(world, focusX, focusY, budgetMs);
  }

  /** Classic skin, real tiles, for the visible window between far and street zoom. */
  stepClassicBlocks(
    world: WorldData,
    camera: CameraState,
    viewW: number,
    viewH: number,
    budgetMs: number,
  ): void {
    if (this.terrain || !this.assets.grasslands) return;
    const px = camera.scale * TILE;
    if (px < 3 || px >= CHUNK_SCREEN_PX * 2) return;
    const stamp = px >= 12 ? 16 : 8;
    const span = stamp >= 16 ? 24 : 48;
    if (stamp !== this.classicStamp) {
      this.classicCache.clear();
      this.classicStamp = stamp;
    }
    const halfW = viewW / (2 * Math.max(camera.scale, 1e-6)) / TILE;
    const halfH = viewH / (2 * Math.max(camera.scale, 1e-6)) / TILE;
    const origins: Array<{ x: number; y: number; d: number }> = [];
    const xStart = Math.floor((camera.x - halfW) / span) * span;
    const yStart = Math.floor((camera.y - halfH) / span) * span;
    for (let y = yStart; y < camera.y + halfH + span; y += span) {
      if (y >= world.height || y + span <= 0) continue;
      for (let x = xStart; x < camera.x + halfW + span; x += span) {
        if (x >= world.width || x + span <= 0) continue;
        const dx = x + span * 0.5 - camera.x;
        const dy = y + span * 0.5 - camera.y;
        origins.push({ x, y, d: dx * dx + dy * dy });
      }
    }
    origins.sort((a, b) => a.d - b.d);
    const started = performance.now();
    for (const origin of origins) {
      const key = `${origin.x}:${origin.y}:${stamp}`;
      let block = this.classicCache.get(key);
      if (!block) {
        const canvas = document.createElement('canvas');
        canvas.width = span * stamp;
        canvas.height = span * stamp;
        block = { canvas, x: origin.x, y: origin.y, span, stamp, row: 0 };
        this.classicCache.set(key, block, canvas.width * canvas.height * 4, stamp);
      }
      if (block.row >= block.span) continue;
      if (performance.now() - started >= budgetMs) break;
      this.paintClassicRows(world, block, budgetMs - (performance.now() - started));
    }
  }

  hasChunk(wx: number, wy: number): boolean {
    const level = this.chunkCache.levelOf(chunkKey(wx, wy));
    if (level === undefined) return false;
    const wanted = mipFactorFor(this.chunkFullPx(), Math.max(8, this.chunkDestPx));
    return level <= wanted;
  }

  private chunkFullPx(): number {
    return ZONE_SCALE * (this.terrain ? 48 : TILE);
  }

  private storeChunk(wx: number, wy: number, full: ChunkImage): void {
    const factor = mipFactorFor(full.width, Math.max(8, this.chunkDestPx));
    const image = factor <= 1 ? full : downsampleCanvas(full, factor);
    this.chunkCache.set(chunkKey(wx, wy), image, image.width * image.height * 4, factor);
  }

  private ensureFarPalette(world: WorldData): void {
    const kind = this.terrain ? 'trail' : 'classic';
    if (this.paletteWorld === world && this.paletteKind === kind) return;
    if (this.terrain) {
      this.far.setPalette(this.terrain.groundPalette());
    } else if (this.assets.grasslands) {
      this.far.setPalette(this.classicGroundPalette());
    } else {
      return;
    }
    this.paletteWorld = world;
    this.paletteKind = kind;
  }

  private classicGroundPalette(): GroundPalette {
    const img = this.assets.grasslands;
    const ground = new Uint8Array(BIOME_COUNT * 3);
    for (let biome = 0; biome < BIOME_COUNT; biome++) {
      const kind = biome as Biome;
      const group = overlayGroup(kind);
      const src = group !== null ? tileSrc(group, biomeSeason(kind), 1, 1) : grassSrc(kind);
      const [r, g, b] = averageTileColor(img, src.sx, src.sy, TILE, TILE);
      ground[biome * 3] = r;
      ground[biome * 3 + 1] = g;
      ground[biome * 3 + 2] = b;
    }
    const roadSrc = tileSrc(GROUPS.path, biomeSeason(Biome.Plains), 1, 1);
    const [rr, rg, rb] = averageTileColor(img, roadSrc.sx, roadSrc.sy, TILE, TILE, [196, 164, 108]);
    return { ground, road: { r: rr, g: rg, b: rb } };
  }

  private paintClassicRows(world: WorldData, block: ClassicBlock, budgetMs: number): void {
    const ctx = block.canvas.getContext('2d');
    if (!ctx) {
      block.row = block.span;
      return;
    }
    ctx.imageSmoothingEnabled = false;
    const started = performance.now();
    const budget = Math.max(0.5, budgetMs);
    while (block.row < block.span && performance.now() - started < budget) {
      const wy = block.y + block.row;
      if (wy >= 0 && wy < world.height) {
        for (let lx = 0; lx < block.span; lx++) {
          const wx = block.x + lx;
          if (wx < 0 || wx >= world.width) continue;
          this.paintClassicTile(
            ctx,
            world,
            wx,
            wy,
            lx * block.stamp,
            block.row * block.stamp,
            block.stamp,
          );
        }
      }
      block.row += 1;
    }
  }

  private paintClassicTile(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    x: number,
    y: number,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    const g = this.assets.grasslands;
    const biome = (world.biomes[x + y * world.width] ?? Biome.Plains) as Biome;
    const grass = grassSrc(biome);
    ctx.drawImage(g, grass.sx, grass.sy, TILE, TILE, dx, dy, stamp, stamp);
    const group = overlayGroup(biome);
    const same = (ox: number, oy: number): boolean => {
      const nx = x + ox;
      const ny = y + oy;
      if (ny < 0 || ny >= world.height) return biome === Biome.Water;
      const wx = ((nx % world.width) + world.width) % world.width;
      return (world.biomes[wx + ny * world.width] ?? 0) === biome;
    };
    if (group !== null) {
      const [lx, ly] = blobLocal(same(0, -1), same(1, 0), same(0, 1), same(-1, 0));
      const src = tileSrc(group, biomeSeason(biome), lx, ly);
      ctx.drawImage(g, src.sx, src.sy, TILE, TILE, dx, dy, stamp, stamp);
    }
    if ((world.paths[x + y * world.width] ?? 0) > 0 && biome !== Biome.Water) {
      const path = (ox: number, oy: number): boolean => {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) return false;
        return (world.paths[nx + ny * world.width] ?? 0) > 0;
      };
      const [lx, ly] = blobLocal(path(0, -1), path(1, 0), path(0, 1), path(-1, 0));
      const src = tileSrc(GROUPS.path, biomeSeason(biome), lx, ly);
      ctx.drawImage(g, src.sx, src.sy, TILE, TILE, dx, dy, stamp, stamp);
    }
  }

  private drawClassicBlocks(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    camera: CameraState,
    viewW: number,
    viewH: number,
  ): void {
    if (camera.scale * TILE < 3) return;
    const scale = Math.max(camera.scale, 1e-6);
    const halfW = viewW / (2 * scale) / TILE + 1;
    const halfH = viewH / (2 * scale) / TILE + 1;
    const viewTilesX = viewW / (scale * TILE);
    const shifts = [0];
    if (viewTilesX < world.width * 0.92) {
      if (camera.x - halfW < 0) shifts.push(-world.width);
      if (camera.x + halfW > world.width) shifts.push(world.width);
    }
    ctx.imageSmoothingEnabled = false;
    for (const shift of shifts) {
      const x0 = camera.x - shift - halfW;
      const x1 = camera.x - shift + halfW;
      const y0 = camera.y - halfH;
      const y1 = camera.y + halfH;
      for (const key of this.classicCache.keys()) {
        const block = this.classicCache.peek(key);
        if (!block || block.row <= 0) continue;
        if (
          block.x + block.span <= x0 ||
          block.x >= x1 ||
          block.y + block.row <= y0 ||
          block.y >= y1
        ) {
          continue;
        }
        this.classicCache.get(key);
        ctx.drawImage(
          block.canvas,
          0,
          0,
          block.span * block.stamp,
          block.row * block.stamp,
          (block.x + shift) * TILE,
          block.y * TILE,
          block.span * TILE,
          block.row * TILE,
        );
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    camera: CameraState,
    player: PlayerState,
    viewW: number,
    viewH: number,
    opts: {
      showOutlines: boolean;
      showPois: boolean;
      visiblePoiIds?: Set<string> | null;
      hoveredId: string | null;
      hoveredPoiId: string | null;
      hoveredEntityId: string | null;
      detailNode: MapNode | null;
      entities: MapEntity[];
      /** Drawn as pins on the unmasked canvas (e.g. travelers outside isolation). */
      markerEntities?: MapEntity[];
      chunks?: Map<string, ChunkData>;
      isolateChunk?: { wx: number; wy: number } | null;
      isolateTiles?: Array<{ x: number; y: number }> | null;
      showPlayer?: boolean;
      outlineAmt?: number;
      cloudAmt?: number;
      /** Multiplier on the original 10px nametag (2.5 = default / slider middle). */
      nametagScale?: number;
      /** Baked elevation tint. Off leaves the frame path unchanged. */
      showHeight?: boolean;
      /** Isolines drawn with the height tint. */
      showContours?: boolean;
      /** Other players in an online room. */
      remotePlayers?: PlayerState[];
      /** peerId of the local walker for speech-bubble anchoring. */
      localPeerId?: string | null;
      speechBubbles?: ChatBubble[];
      interior?: InteriorPlan | null;
      /** Town Tale PNGs instead of tile roofs. Yards stay either way. */
      spriteBuildings?: boolean;
      /** Hero facing, radians. The wagon trails behind this yaw. */
      heroYaw?: number;
    },
  ): void {
    this.chunkDestPx = Math.max(1, camera.scale * TILE);
    this.tagScreenPx = NAMETAG_BASE_PX * clamp(opts.nametagScale ?? 2.5, 0.5, 4.5);
    this.heroYaw = opts.heroYaw ?? 0;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#151b22';
    ctx.fillRect(0, 0, viewW, viewH);

    const isolated = opts.isolateTiles?.length
      ? opts.isolateTiles
      : opts.isolateChunk
        ? [{ x: opts.isolateChunk.wx, y: opts.isolateChunk.wy }]
        : null;

    if (isolated) {
      const isoKeys = new Set(isolated.map((t) => chunkKey(t.x, t.y)));
      const contextNodes: MapNode[] = [];
      const isoNodes: MapNode[] = [];
      for (const node of world.nodes) {
        if (this.nodeInIsolation(node, isoKeys)) isoNodes.push(node);
        else contextNodes.push(node);
      }
      ctx.save();
      cameraTransform(ctx, camera, viewW, viewH);
      if (this.worldBake) {
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.34;
        ctx.drawImage(this.worldBake, 0, 0, world.width * TILE, world.height * TILE);
        ctx.globalAlpha = 1;
      }
      if (opts.showHeight) {
        ctx.globalAlpha = 0.72;
        this.drawRelief(ctx, world, camera, viewW, viewH, !!opts.showContours);
        ctx.globalAlpha = 1;
      }
      this.drawOutlines(
        ctx,
        contextNodes,
        camera.scale,
        opts.showOutlines,
        opts.hoveredId,
        0,
        opts.detailNode,
        opts.outlineAmt ?? 0.7,
        true,
        camera.x,
        camera.y,
      );
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      for (const t of isolated) {
        ctx.rect(t.x * TILE, t.y * TILE, TILE, TILE);
      }
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
      ctx.restore();

      const layer = this.ensureIsoLayer(viewW, viewH);
      const lctx = layer.getContext('2d');
      if (!lctx) return;
      const detailT = smoothstep(DETAIL_START, DETAIL_END, camera.scale);
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, viewW, viewH);
      lctx.imageSmoothingEnabled = false;
      lctx.save();
      cameraTransform(lctx, camera, viewW, viewH);
      this.drawVisibleChunks(lctx, camera, viewW, viewH, world, 1, isoKeys);
      if (opts.showHeight) this.drawRelief(lctx, world, camera, viewW, viewH, !!opts.showContours);
      this.drawChunkSprites(
        lctx,
        camera,
        viewW,
        viewH,
        world,
        1,
        opts.chunks,
        isoKeys,
        opts.interior,
        !!opts.spriteBuildings,
      );
      if (opts.interior) this.drawInterior(lctx, opts.interior);
      this.drawOutlines(
        lctx,
        isoNodes,
        camera.scale,
        opts.showOutlines,
        opts.hoveredId,
        detailT,
        opts.detailNode,
        opts.outlineAmt ?? 0.7,
        false,
        camera.x,
        camera.y,
      );
      this.drawEntities(
        lctx,
        opts.entities,
        camera,
        viewW,
        viewH,
        player,
        opts.hoveredEntityId,
        0,
        !!opts.showPlayer,
        opts.remotePlayers,
        opts.speechBubbles,
        opts.localPeerId,
      );
      lctx.restore();
      if (opts.interior) this.applyInteriorBlur(lctx, opts.interior, camera, viewW, viewH);
      this.applyScreenFog(lctx, isolated, camera, viewW, viewH);
      lctx.save();
      cameraTransform(lctx, camera, viewW, viewH);
      this.drawPois(
        lctx,
        world,
        camera.scale,
        opts.showPois,
        opts.hoveredPoiId,
        opts.detailNode,
        player,
        opts.visiblePoiIds,
      );
      lctx.restore();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(layer, 0, 0);
      const remote = opts.markerEntities;
      if (remote?.length) {
        ctx.save();
        cameraTransform(ctx, camera, viewW, viewH);
        this.drawEntityPins(ctx, remote, camera, viewW, viewH, opts.hoveredEntityId);
        ctx.restore();
      }
      return;
    }

    ctx.save();
    const sheet = this.mapWidth > 0;
    cameraTransform(ctx, camera, viewW, viewH, !sheet);
    const viewWTiles = sheet ? this.mapWidth : world.width;
    const viewHTiles = sheet ? this.mapHeight : world.height;

    if (this.terrain?.coarseMip && !sheet) {
      this.terrain.frame = this.waterFrame;
      this.terrain.drawArtMips(
        ctx,
        camera.x,
        camera.y,
        camera.scale,
        viewW,
        viewH,
        world.width,
        world.height,
      );
    } else if (this.worldBake) {
      ctx.imageSmoothingEnabled = false;
      const wpx = viewWTiles * TILE;
      const hpx = viewHTiles * TILE;
      ctx.drawImage(this.worldBake, 0, 0, wpx, hpx);
      const halfW = viewW / (2 * camera.scale) / TILE;
      const viewTilesX = viewW / (camera.scale * TILE);
      if (viewTilesX < viewWTiles * 0.92) {
        if (camera.x - halfW < 0) ctx.drawImage(this.worldBake, -wpx, 0, wpx, hpx);
        if (camera.x + halfW > viewWTiles) ctx.drawImage(this.worldBake, wpx, 0, wpx, hpx);
      }
    }
    if (this.terrain && !this.terrain.coarseMip) {
      this.far.draw(ctx, world, camera, viewW, viewH);
      this.paintRegions(ctx);
    }

    const featureAlpha = smoothstep(0.35, 1.35, camera.scale);
    // Street chunks are a future settlement/property mode, not this world map.
    // Zoom past the cap dives into the 3D area. Settlement markers stay icons.
    const showChunks = false;
    const detailT = showChunks ? 1 : 0;
    const halfW = viewW / (2 * camera.scale) / TILE;
    const viewTilesX = viewW / (camera.scale * TILE);
    const wrapShifts = worldWrapShifts(camera.x, halfW, viewWTiles, viewTilesX);
    if (featureAlpha > 0.02) {
      ctx.globalAlpha = featureAlpha;
      for (const shift of wrapShifts) {
        ctx.save();
        ctx.translate(shift * TILE, 0);
        this.drawFeatures(ctx, world, camera, viewW, viewH, featureAlpha, detailT, shift);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    if (showChunks) this.drawVisibleChunks(ctx, camera, viewW, viewH, world, 1);
    if (opts.showHeight) this.drawRelief(ctx, world, camera, viewW, viewH, !!opts.showContours);
    if (showChunks) {
      this.drawChunkSprites(
        ctx,
        camera,
        viewW,
        viewH,
        world,
        1,
        opts.chunks,
        undefined,
        opts.interior,
        !!opts.spriteBuildings,
      );
      if (opts.interior) this.drawInterior(ctx, opts.interior);
    }

    for (const shift of wrapShifts) {
      ctx.save();
      ctx.translate(shift * TILE, 0);
      this.drawOutlines(
        ctx,
        world.nodes,
        camera.scale,
        opts.showOutlines,
        opts.hoveredId,
        detailT,
        opts.detailNode,
        opts.outlineAmt ?? 0.7,
        false,
        camera.x,
        camera.y,
      );
      ctx.restore();
    }

    const cloudAmt = clamp(opts.cloudAmt ?? 0.92, 0, 1);
    if (this.cloudBake && cloudAmt > 0.01) {
      const wpx = world.width * TILE;
      const hpx = world.height * TILE;
      const smooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = cloudAmt;
      for (const shift of wrapShifts) {
        ctx.save();
        ctx.translate(shift * TILE, 0);
        ctx.drawImage(this.cloudBake, 0, 0, wpx, hpx);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = smooth;
    }

    for (const shift of wrapShifts) {
      ctx.save();
      ctx.translate(shift * TILE, 0);
      this.drawEntities(
        ctx,
        opts.entities,
        camera,
        viewW,
        viewH,
        player,
        opts.hoveredEntityId,
        shift,
        !!opts.showPlayer,
        opts.remotePlayers,
        opts.speechBubbles,
        opts.localPeerId,
      );
      this.drawPois(
        ctx,
        world,
        camera.scale,
        opts.showPois,
        opts.hoveredPoiId,
        opts.detailNode,
        player,
        opts.visiblePoiIds,
      );
      ctx.restore();
    }
    ctx.restore();
    if (opts.interior) this.applyInteriorBlur(ctx, opts.interior, camera, viewW, viewH);
  }

  /** Visible-rect blit of the baked ramp, plus optional cached contour strokes. */
  private drawRelief(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    camera: CameraState,
    viewW: number,
    viewH: number,
    contours: boolean,
  ): void {
    const bake = this.ensureHeight(world);
    if (!bake) return;
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    const halfW = viewW / (2 * Math.max(camera.scale, 1e-4)) / TILE + 1;
    const halfH = viewH / (2 * Math.max(camera.scale, 1e-4)) / TILE + 1;
    const x0 = camera.x - halfW;
    const x1 = camera.x + halfW;
    const y0 = Math.max(0, camera.y - halfH);
    const y1 = Math.min(world.height, camera.y + halfH);
    const spanY = y1 - y0;
    if (spanY > 0) {
      const w = world.width;
      let x = x0;
      let guard = 0;
      while (x < x1 - 1e-4 && guard++ < 8) {
        let sx = x % w;
        if (sx < 0) sx += w;
        const span = Math.min(x1 - x, w - sx);
        if (!(span > 1e-4)) break;
        ctx.drawImage(bake, sx, y0, span, spanY, x * TILE, y0 * TILE, span * TILE, spanY * TILE);
        x += span;
      }
    }
    ctx.imageSmoothingEnabled = prevSmooth;
    if (contours) this.strokeContours(ctx, world, camera, viewW, viewH);
  }

  private ensureHeight(world: WorldData): HTMLCanvasElement | null {
    if (this.heightWorld !== world || !this.heightBake) {
      this.heightBake = bakeElevationOverlay(world);
      this.heightWorld = world;
      this.contourKey = '';
      this.contourPaths = null;
    }
    return this.heightBake;
  }

  private strokeContours(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    camera: CameraState,
    viewW: number,
    viewH: number,
  ): void {
    const win = contourWindow(world.height, camera.x, camera.y, viewW, viewH, camera.scale);
    const key = `${world.seed}:${win.x0}:${win.y0}:${win.x1}:${win.y1}:${win.step}`;
    if (key !== this.contourKey || !this.contourPaths) {
      this.contourPaths = buildContours(world, win.x0, win.y0, win.x1, win.y1, win.step);
      this.contourKey = key;
    }
    const { minor, major } = this.contourPaths;
    const px = 1 / Math.max(camera.scale, 1e-4);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 248, 236, 0.42)';
    ctx.lineWidth = 2.4 * px;
    ctx.stroke(minor);
    ctx.lineWidth = 3.3 * px;
    ctx.stroke(major);
    ctx.strokeStyle = 'rgba(32, 24, 16, 0.72)';
    ctx.lineWidth = 1.05 * px;
    ctx.stroke(minor);
    ctx.lineWidth = 1.65 * px;
    ctx.stroke(major);
    ctx.restore();
  }

  private paintRegions(ctx: CanvasRenderingContext2D): void {
    if (!this.regions.length || !this.terrain) return;
    ctx.imageSmoothingEnabled = false;
    const tiles = this.terrain;
    tiles.frame = this.waterFrame;
    for (const region of this.regions) {
      ctx.drawImage(
        region.canvas,
        region.x * TILE,
        region.y * TILE,
        region.span * TILE,
        region.span * TILE,
      );
      ctx.save();
      ctx.translate(region.x * TILE, region.y * TILE);
      ctx.scale(TILE / 48, TILE / 48);
      tiles.paintOverlays(ctx, region.shores, region.waters, 48, region.curves);
      ctx.restore();
    }
  }

  /** A few textured overview rows. Returns true when the kingdom sheet is finished. */
  stepOverview(world: WorldData, budgetMs: number): boolean {
    const job = this.overview;
    const tiles = this.terrain;
    if (!job || !tiles || job.row >= job.rows) return true;
    const started = performance.now();
    while (job.row < job.rows && performance.now() - started < budgetMs) {
      tiles.paintOverviewRow(world, job);
    }
    return job.row >= job.rows;
  }

  private ensureLayer(
    current: HTMLCanvasElement | null,
    viewW: number,
    viewH: number,
  ): HTMLCanvasElement {
    const w = Math.max(1, Math.ceil(viewW));
    const h = Math.max(1, Math.ceil(viewH));
    if (!current || current.width !== w || current.height !== h) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      return canvas;
    }
    return current;
  }

  private ensureIsoLayer(viewW: number, viewH: number): HTMLCanvasElement {
    this.isoLayer = this.ensureLayer(this.isoLayer, viewW, viewH);
    return this.isoLayer;
  }

  private applyScreenFog(
    ctx: CanvasRenderingContext2D,
    tiles: Array<{ x: number; y: number }>,
    camera: CameraState,
    viewW: number,
    viewH: number,
  ): void {
    this.fogLayer = this.ensureLayer(this.fogLayer, viewW, viewH);
    const mask = this.fogLayer;
    const mctx = mask.getContext('2d');
    if (!mctx) return;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mask.width, mask.height);
    mctx.fillStyle = '#fff';
    mctx.save();
    cameraTransform(mctx, camera, viewW, viewH);
    const halfW = viewW / (2 * camera.scale) / TILE + 2;
    const halfH = viewH / (2 * camera.scale) / TILE + 2;
    const x0 = camera.x - halfW;
    const x1 = camera.x + halfW;
    const y0 = camera.y - halfH;
    const y1 = camera.y + halfH;
    for (const t of tiles) {
      if (t.x + 1 < x0 || t.x > x1 || t.y + 1 < y0 || t.y > y1) continue;
      mctx.fillRect(t.x * TILE, t.y * TILE, TILE, TILE);
    }
    mctx.restore();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.filter = 'blur(22px)';
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
  }

  private drawInterior(ctx: CanvasRenderingContext2D, plan: InteriorPlan): void {
    const floors = this.assets.floors;
    const cell = TILE / ZONE_SCALE;
    const floor = FLOORS[plan.floor] ?? FLOORS[0]!;
    const wall = interiorWallFill(plan.sprite);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        const cellKind = plan.cells[c + r * plan.cols]!;
        if (cellKind !== CELL_FLOOR && cellKind !== CELL_DOOR) continue;
        ctx.fillRect(
          (plan.x0 + c / ZONE_SCALE) * TILE,
          (plan.y0 + r / ZONE_SCALE) * TILE,
          cell,
          cell,
        );
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        const cellKind = plan.cells[c + r * plan.cols]!;
        if (cellKind === CELL_VOID || cellKind === CELL_WALL) continue;
        const dx = (plan.x0 + c / ZONE_SCALE) * TILE;
        const dy = (plan.y0 + r / ZONE_SCALE) * TILE;
        ctx.drawImage(floors, floor.sx, floor.sy, TILE, TILE, dx, dy, cell, cell);
      }
    }
    ctx.fillStyle = wall;
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        if (plan.cells[c + r * plan.cols] !== CELL_WALL || isShellWall(plan, c, r)) continue;
        ctx.fillRect(
          (plan.x0 + c / ZONE_SCALE) * TILE,
          (plan.y0 + r / ZONE_SCALE) * TILE,
          cell,
          cell,
        );
      }
    }
    ctx.strokeStyle = '#1a120c';
    ctx.lineWidth = 0.08;
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        if (plan.cells[c + r * plan.cols] !== CELL_WALL || isShellWall(plan, c, r)) continue;
        const dx = (plan.x0 + c / ZONE_SCALE) * TILE;
        const dy = (plan.y0 + r / ZONE_SCALE) * TILE;
        ctx.strokeRect(dx + 0.15, dy + 0.15, cell - 0.3, cell - 0.3);
      }
    }
    ctx.fillStyle = '#6b4a32';
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        if (plan.cells[c + r * plan.cols] !== CELL_DOOR) continue;
        ctx.fillRect(
          (plan.x0 + c / ZONE_SCALE) * TILE,
          (plan.y0 + r / ZONE_SCALE) * TILE + cell * 0.55,
          cell,
          cell * 0.45,
        );
      }
    }
    for (const f of plan.furniture) {
      const img = this.assets.sprite(f.sprite);
      if (!img) continue;
      const x = plan.x0 + (f.col + 0.5) / ZONE_SCALE;
      const y = plan.y0 + (f.row + 0.85) / ZONE_SCALE;
      const k = (TILE / ZONE_SCALE / 16) * 1.15;
      ctx.save();
      ctx.translate(x * TILE, y * TILE);
      ctx.scale(k, k);
      ctx.drawImage(img, -img.width / 2, -img.height);
      ctx.restore();
    }
    ctx.restore();
  }

  private applyInteriorBlur(
    ctx: CanvasRenderingContext2D,
    plan: InteriorPlan,
    camera: CameraState,
    viewW: number,
    viewH: number,
  ): void {
    this.blurLayer = this.ensureLayer(this.blurLayer, viewW, viewH);
    const blur = this.blurLayer;
    const bctx = blur.getContext('2d');
    if (!bctx) return;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, blur.width, blur.height);
    bctx.imageSmoothingEnabled = true;
    bctx.filter = 'blur(10px)';
    bctx.drawImage(ctx.canvas, 0, 0);
    bctx.filter = 'none';
    bctx.fillStyle = 'rgba(12, 16, 20, 0.38)';
    bctx.fillRect(0, 0, blur.width, blur.height);
    bctx.globalCompositeOperation = 'destination-out';
    bctx.save();
    cameraTransform(bctx, camera, viewW, viewH);
    const pad = 0.03;
    const cell = TILE / ZONE_SCALE;
    bctx.fillStyle = '#fff';
    for (let r = 0; r < plan.rows; r++) {
      for (let c = 0; c < plan.cols; c++) {
        if (plan.cells[c + r * plan.cols] === CELL_VOID) continue;
        bctx.fillRect(
          (plan.x0 + c / ZONE_SCALE) * TILE - pad * TILE,
          (plan.y0 + r / ZONE_SCALE) * TILE - pad * TILE,
          cell + pad * 2 * TILE,
          cell + pad * 2 * TILE,
        );
      }
    }
    bctx.fillRect(
      plan.doorX0 * TILE - pad * TILE,
      plan.ay * TILE,
      (plan.doorX1 - plan.doorX0 + pad * 2) * TILE,
      0.14 * TILE,
    );
    bctx.restore();
    bctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(blur, 0, 0);
    ctx.restore();
  }

  forgetChunk(wx: number, wy: number): void {
    this.chunkCache.delete(chunkKey(wx, wy));
  }

  hasChunkBake(wx: number, wy: number): boolean {
    return this.chunkCache.has(chunkKey(wx, wy));
  }

  private drawVisibleChunks(
    ctx: CanvasRenderingContext2D,
    camera: CameraState,
    viewW: number,
    viewH: number,
    world: WorldData,
    detailT: number,
    allowed?: Set<string>,
  ): void {
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const x0 = Math.max(0, Math.floor(camera.x - halfW - 1));
    const y0 = Math.max(0, Math.floor(camera.y - halfH - 1));
    const x1 = Math.min(world.width - 1, Math.floor(camera.x + halfW + 1));
    const y1 = Math.min(world.height - 1, Math.floor(camera.y + halfH + 1));
    ctx.save();
    ctx.globalAlpha = detailT;
    for (let wy = y0; wy <= y1; wy++) {
      for (let wx = x0; wx <= x1; wx++) {
        if (allowed && !allowed.has(chunkKey(wx, wy))) continue;
        const bake = this.chunkCache.get(chunkKey(wx, wy));
        if (!bake) continue;
        ctx.save();
        ctx.translate(wx * TILE, wy * TILE);
        ctx.imageSmoothingEnabled = false;
        const width =
          bake instanceof HTMLCanvasElement || bake instanceof OffscreenCanvas ? bake.width : TILE;
        const fit = TILE / Math.max(1, width);
        ctx.scale(fit, fit);
        ctx.drawImage(bake, -1, -1);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawChunkSprites(
    ctx: CanvasRenderingContext2D,
    camera: CameraState,
    viewW: number,
    viewH: number,
    world: WorldData,
    detailT: number,
    chunks: Map<string, ChunkData> | undefined,
    allowed?: Set<string>,
    hide?: InteriorPlan | null,
    spriteBuildings = false,
  ): void {
    if (!chunks) return;
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const pad = 3.2;
    const x0 = Math.max(0, Math.floor(camera.x - halfW - pad));
    const y0 = Math.max(0, Math.floor(camera.y - halfH - pad));
    const x1 = Math.min(world.width - 1, Math.floor(camera.x + halfW + pad));
    const y1 = Math.min(world.height - 1, Math.floor(camera.y + halfH + pad));
    const drawn: Array<{
      sprite: string;
      x: number;
      y: number;
      footW?: number;
      roofOnly?: boolean;
    }> = [];
    for (let wy = y0; wy <= y1; wy++) {
      for (let wx = x0; wx <= x1; wx++) {
        if (allowed && !allowed.has(chunkKey(wx, wy))) continue;
        const chunk = chunks.get(chunkKey(wx, wy));
        if (!chunk) continue;
        for (const spr of chunk.sprites) {
          const x = wx + spr.x / chunk.size;
          const y = wy + spr.y / chunk.size;
          const building = isBuildingSprite(spr.sprite);
          const roofOnly = !!(
            hide &&
            building &&
            Math.abs(x - hide.ax) < 0.04 &&
            Math.abs(y - hide.ay) < 0.04
          );
          if (
            building &&
            !spriteBuildings &&
            ((spr.templateId && templateById(spr.templateId)) || templatesForType(spr.sprite)[0])
          ) {
            continue;
          }
          if (building) {
            const pose = spriteBuildingPose(spr, x, y);
            drawn.push({ sprite: spr.sprite, x: pose.x, y: pose.y, footW: pose.footW, roofOnly });
          } else {
            drawn.push({ sprite: spr.sprite, x, y, footW: spr.footW, roofOnly });
          }
        }
      }
    }
    drawn.sort((a, b) => a.y - b.y || a.x - b.x);
    ctx.save();
    ctx.globalAlpha = detailT;
    for (const spr of drawn) {
      const img = this.assets.sprite(spr.sprite);
      if (!img) continue;
      ctx.save();
      ctx.translate(spr.x * TILE, spr.y * TILE);
      if (isBuildingSprite(spr.sprite)) {
        const k = buildingDrawScale(spr.sprite, img, spr.footW);
        const { ox, oy } = buildingDrawOrigin(spr.sprite, img);
        ctx.scale(k, k);
        ctx.drawImage(img, -ox, -oy);
        ctx.restore();
        if (spr.roofOnly && hide) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.fillStyle = '#000';
          const cell = TILE / ZONE_SCALE;
          for (let r = 0; r < hide.rows; r++) {
            for (let c = 0; c < hide.cols; c++) {
              const kind = hide.cells[c + r * hide.cols]!;
              if (kind !== CELL_FLOOR && kind !== CELL_DOOR) continue;
              ctx.fillRect(
                (hide.x0 + c / ZONE_SCALE) * TILE,
                (hide.y0 + r / ZONE_SCALE) * TILE,
                cell,
                cell,
              );
            }
          }
          ctx.restore();
          ctx.save();
          ctx.translate(spr.x * TILE, spr.y * TILE);
          ctx.scale(k, k);
          const rh = Math.max(1, Math.round(img.height * buildingRoofFrac(spr.sprite)));
          ctx.drawImage(img, 0, 0, img.width, rh, -ox, -oy, img.width, rh);
          ctx.restore();
        }
      } else {
        const k = spriteWorldScale(img);
        ctx.scale(k, k);
        ctx.drawImage(img, -img.width / 2, -img.height);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /** Fine world tiles → map tiles. The camera and the sheet share map tiles. */
  private toMap(fine: number): number {
    return fineToDisplay(fine, this.mapStep);
  }

  private addNodeTiles(ctx: CanvasRenderingContext2D, node: MapNode, exact = false): void {
    if (exact && node.tiles?.length) {
      const cell = Math.max(0.35, this.toMap(1) * TILE);
      for (const t of node.tiles) {
        ctx.rect(this.toMap(t.x) * TILE, this.toMap(t.y) * TILE, cell, cell);
      }
      return;
    }
    if (this.mapStep > 1) {
      const b = nodeBounds(node);
      const x = this.toMap(b.x0) * TILE;
      const y = this.toMap(b.y0) * TILE;
      ctx.rect(
        x,
        y,
        Math.max(TILE, this.toMap(b.x1 - b.x0) * TILE),
        Math.max(TILE, this.toMap(b.y1 - b.y0) * TILE),
      );
      return;
    }
    const tiles = node.tiles;
    if (tiles?.length) {
      for (const t of tiles) {
        ctx.rect(t.x * TILE, t.y * TILE, TILE, TILE);
      }
      return;
    }
    const b = nodeBounds(node);
    ctx.rect(b.x0 * TILE, b.y0 * TILE, (b.x1 - b.x0) * TILE, (b.y1 - b.y0) * TILE);
  }

  private drawFeatures(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    camera: CameraState,
    viewW: number,
    viewH: number,
    alpha: number,
    detailT: number,
    shift = 0,
  ): void {
    const pad = 4;
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const x0 = camera.x - shift - halfW - pad;
    const x1 = camera.x - shift + halfW + pad;
    const y0 = camera.y - halfH - pad;
    const y1 = camera.y + halfH + pad;
    this.ensureFeatureBuckets(world);
    const cell = 48;
    const i0 = Math.floor(x0 / cell);
    const i1 = Math.floor(x1 / cell);
    const j0 = Math.floor(y0 / cell);
    const j1 = Math.floor(y1 / cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this.featureBuckets?.get(`${i},${j}`);
        if (!list) continue;
        for (const feature of list) {
          if (
            this.toMap(feature.x) < x0 ||
            this.toMap(feature.x) > x1 ||
            this.toMap(feature.y) < y0 ||
            this.toMap(feature.y) > y1
          )
            continue;
          if (
            alpha > 0.8 &&
            detailT > 0.2 &&
            this.hasChunk(Math.floor(feature.x), Math.floor(feature.y))
          )
            continue;
          const img = this.assets.sprite(feature.sprite);
          if (!img) continue;
          const worldH = img.height * spriteWorldScale(img);
          const minScreen = feature.kind === 'landmark' ? 14 : feature.kind === 'tree' ? 7 : 11;
          const screenH = Math.max(minScreen, worldH * camera.scale);
          const h = screenH / camera.scale;
          const w = (img.width / Math.max(1, img.height)) * h;
          const fx = this.toMap(feature.x);
          const fy = this.toMap(feature.y);
          ctx.drawImage(img, fx * TILE - w / 2, fy * TILE - h, w, h);
        }
      }
    }
  }

  private ensureFeatureBuckets(world: WorldData): void {
    if (this.featureWorld === world && this.featureBuckets) return;
    const cell = 48;
    const buckets = new Map<string, WorldFeature[]>();
    const source = this.coarseFeatures ?? world.features;
    for (const feature of source) {
      const key = `${Math.floor(this.toMap(feature.x) / cell)},${Math.floor(this.toMap(feature.y) / cell)}`;
      const list = buckets.get(key);
      if (list) list.push(feature);
      else buckets.set(key, [feature]);
    }
    this.featureBuckets = buckets;
    this.featureWorld = world;
  }

  private nodeInIsolation(node: MapNode, isoKeys: Set<string>): boolean {
    const tiles = node.tiles;
    if (!tiles?.length) return false;
    for (const t of tiles) {
      if (isoKeys.has(chunkKey(t.x, t.y))) return true;
    }
    return false;
  }

  private drawOutlines(
    ctx: CanvasRenderingContext2D,
    nodes: MapNode[],
    scale: number,
    show: boolean,
    hoveredId: string | null,
    detailT: number,
    detailNode: MapNode | null,
    amt: number,
    context = false,
    camX = Number.NaN,
    camY = Number.NaN,
  ): void {
    const overlay = clamp(amt, 0, 1);
    if (overlay < 0.01 && !hoveredId && detailT < 0.35 && !context) return;
    const political = smoothstep(0.28, 1, overlay);
    for (const node of nodes) {
      if (Number.isFinite(camX) && Number.isFinite(camY)) {
        const margin = 96 / Math.max(0.04, scale);
        if (
          Math.hypot(this.toMap(node.cx) - camX, this.toMap(node.cy) - camY) >
          this.toMap(node.radius) + margin
        )
          continue;
      }
      const hovered = node.id === hoveredId;
      const isActive = detailNode?.id === node.id;
      const city = node.kind === 'city' || node.kind === 'town';
      const instanced = isInstancedZone(node);
      const mapped = city || instanced;
      if (
        overlay < 0.06 &&
        !show &&
        !hovered &&
        !(isActive && detailT > 0.35) &&
        !mapped &&
        !context
      )
        continue;
      ctx.save();
      const close = scale >= CLOSE_MARKER_SCALE;
      const rgb = countyRgb(node);
      const streetFade = context ? 1 : 1 - smoothstep(0.45, 1, detailT) * 0.82;
      const fillA = close
        ? hovered
          ? 0.66
          : 0.5
        : overlay * streetFade * (hovered ? 0.28 + political * 0.62 : 0.16 + political * 0.72);
      if (hovered || instanced || overlay > 0.04 || context || close) {
        ctx.beginPath();
        this.addNodeTiles(ctx, node, close);
        ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${fillA})`;
        ctx.fill();
      }
      this.traceNode(ctx, node, close);
      const strokeA = 0.12 + overlay * 0.88;
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2.4;
      ctx.setLineDash(
        hovered || isActive || mapped || political > 0.45 || context ? [] : [5 / scale, 4 / scale],
      );
      ctx.strokeStyle = `rgba(16, 12, 8, ${strokeA})`;
      ctx.lineWidth = (1.6 + overlay * 3.2 + (hovered || isActive ? 0.8 : 0)) / scale;
      ctx.stroke();
      if (political > 0.4) {
        ctx.strokeStyle = `rgba(${Math.max(0, rgb[0] - 28)}, ${Math.max(0, rgb[1] - 28)}, ${Math.max(0, rgb[2] - 28)}, ${0.55 + overlay * 0.4})`;
        ctx.lineWidth = (1.05 + overlay * 1.4) / scale;
        ctx.stroke();
      }
      const major = node.kind === 'city' || node.kind === 'town';
      const village = major || node.kind === 'village';
      const showName =
        !node.poiKind &&
        (hovered ||
          isActive ||
          (context && overlay > 0.2) ||
          (overlay > 0.2 && scale < 0.08 && major) ||
          (overlay > 0.2 && scale >= 0.08 && scale < 0.4 && village) ||
          (overlay > 0.2 && scale >= 0.4));
      if (showName) {
        const b = nodeBounds(node);
        ctx.setLineDash([]);
        const lx = this.toMap(node.cx) * TILE;
        const ly = this.toMap(b.y0 + (b.y1 - b.y0) * 0.42) * TILE;
        const label = node.poiKind ? `${node.name} · ${POI_LABELS[node.poiKind]}` : node.name;
        drawNametag(ctx, label, lx, ly, scale, {
          screenPx: this.tagScreenPx * (close ? 1.3 : 1),
        });
      }
      if (close && !node.poiKind) {
        this.drawMapPin(
          ctx,
          markerDisplay(node.cx, this.mapStep) * TILE,
          markerDisplay(node.cy, this.mapStep) * TILE,
          scale,
          `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
          true,
        );
      }
      ctx.restore();
    }
  }

  private traceNode(ctx: CanvasRenderingContext2D, node: MapNode, exact = false): void {
    ctx.beginPath();
    if (exact) {
      const b = nodeBounds(node);
      ctx.rect(
        this.toMap(b.x0) * TILE,
        this.toMap(b.y0) * TILE,
        Math.max(0.35, this.toMap(b.x1 - b.x0) * TILE),
        Math.max(0.35, this.toMap(b.y1 - b.y0) * TILE),
      );
      return;
    }
    if (this.mapStep > 1) {
      const b = nodeBounds(node);
      const x = this.toMap(b.x0) * TILE;
      const y = this.toMap(b.y0) * TILE;
      ctx.rect(
        x,
        y,
        Math.max(TILE, this.toMap(b.x1 - b.x0) * TILE),
        Math.max(TILE, this.toMap(b.y1 - b.y0) * TILE),
      );
      return;
    }
    const tiles = node.tiles;
    if (!tiles?.length) {
      const b = nodeBounds(node);
      ctx.rect(b.x0 * TILE, b.y0 * TILE, (b.x1 - b.x0) * TILE, (b.y1 - b.y0) * TILE);
      return;
    }
    const set = new Set(tiles.map((t) => `${t.x},${t.y}`));
    for (const t of tiles) {
      const x = t.x * TILE;
      const y = t.y * TILE;
      if (!set.has(`${t.x},${t.y - 1}`)) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + TILE, y);
      }
      if (!set.has(`${t.x + 1},${t.y}`)) {
        ctx.moveTo(x + TILE, y);
        ctx.lineTo(x + TILE, y + TILE);
      }
      if (!set.has(`${t.x},${t.y + 1}`)) {
        ctx.moveTo(x + TILE, y + TILE);
        ctx.lineTo(x, y + TILE);
      }
      if (!set.has(`${t.x - 1},${t.y}`)) {
        ctx.moveTo(x, y + TILE);
        ctx.lineTo(x, y);
      }
    }
  }

  private drawPois(
    ctx: CanvasRenderingContext2D,
    world: WorldData,
    scale: number,
    show: boolean,
    hoveredPoiId: string | null,
    detailNode: MapNode | null,
    player: PlayerState,
    visibleIds?: Set<string> | null,
  ): void {
    if (!show && !hoveredPoiId && !visibleIds?.size) return;
    const close = scale >= CLOSE_MARKER_SCALE;
    for (const poi of world.pois) {
      const hovered = poi.id === hoveredPoiId;
      const isActive = detailNode?.id === poi.id;
      const revealed = !!visibleIds?.has(poi.id);
      const instanced = world.nodes.some((n) => n.id === poi.id);
      if (!show && !revealed && !hovered && !isActive) continue;
      if (!hovered && !isActive && scale < 0.09) continue;
      const nearHero = Math.hypot(poi.x - player.x, poi.y - player.y) <= NEAR_POI_TILES;
      const px = markerDisplay(poi.x, this.mapStep) * TILE;
      const py = markerDisplay(poi.y, this.mapStep) * TILE;
      const color = poiColor(poi.kind);
      if (close && (nearHero || scale >= 2.2)) {
        const cell = Math.max(0.35, this.toMap(1) * TILE);
        ctx.beginPath();
        for (const tile of poiFootprintTiles(poi, world)) {
          ctx.rect(this.toMap(tile.x) * TILE, this.toMap(tile.y) * TILE, cell, cell);
        }
        ctx.fillStyle = color.replace(', 1)', ', 0.42)');
        ctx.fill();
      }
      const prominent = close || nearHero;
      this.drawMapPin(ctx, px, py, scale, color, prominent);
      const screen = prominent ? 34 : 22;
      const s = screen / scale;
      const pin = { x: px - s * 1.2, y: py - s * 1.2, w: s * 2.4, h: s * 2.4 };
      if (hovered || isActive || scale >= 0.45 || nearHero) {
        const label =
          hovered || isActive || scale >= 0.7 || instanced || nearHero
            ? `${poi.name} · ${POI_LABELS[poi.kind]}`
            : poi.name;
        drawNametag(ctx, label, px, py, scale, {
          clearAbove: s * 1.35,
          avoid: [pin],
          screenPx: this.tagScreenPx * (prominent ? 1.35 : 1),
        });
      }
    }
  }

  /** Diamond pin. `prominent` keeps it readable at the close map zoom. */
  private drawMapPin(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    scale: number,
    color: string,
    prominent: boolean,
  ): void {
    const screen = prominent ? 34 : 22;
    const s = screen / scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, s * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(246, 241, 230, 0.92)';
    ctx.fill();
    ctx.lineWidth = (prominent ? 3.2 : 2.2) / scale;
    ctx.strokeStyle = '#1a120c';
    ctx.stroke();
    ctx.translate(px, py);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#1a120c';
    ctx.lineWidth = (prominent ? 2.2 : 1.5) / scale;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }

  /** Map pins only — used for groups outside the isolated place / fog mask. */
  private drawEntityPins(
    ctx: CanvasRenderingContext2D,
    entities: MapEntity[],
    camera: CameraState,
    viewW: number,
    viewH: number,
    hoveredId: string | null,
    shift = 0,
  ): void {
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const pad = 4;
    const x0 = camera.x - shift - halfW - pad;
    const x1 = camera.x - shift + halfW + pad;
    const y0 = camera.y - halfH - pad;
    const y1 = camera.y + halfH + pad;
    for (const e of entities) {
      if (e.resident) continue;
      if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
      const mx = e.x;
      const my = e.y;
      ctx.save();
      if (e.token === 'camp' || e.token === 'wagon-circle') {
        drawCampMarker(ctx, mx, my, camera.scale, e.token);
        if (e.id === hoveredId) {
          const r = 12 / camera.scale;
          drawNametag(ctx, e.name, mx * TILE, my * TILE, camera.scale, {
            clearAbove: r + 4 / camera.scale,
            avoid: [{ x: mx * TILE - r, y: my * TILE - r, w: r * 2, h: r * 2 }],
            screenPx: this.tagScreenPx,
          });
        }
        ctx.restore();
        continue;
      }
      if (e.afloat) {
        drawBoatMarker(ctx, mx, my, camera.scale, kindColor(e.kind), e.facing, e.kind);
      } else {
        const r = (e.kind === 'army' ? 11 : e.kind === 'caravan' ? 9.5 : 7.5) / camera.scale;
        ctx.beginPath();
        ctx.arc(mx * TILE, my * TILE, r, 0, Math.PI * 2);
        ctx.fillStyle = kindColor(e.kind);
        ctx.fill();
        ctx.lineWidth = 1.4 / camera.scale;
        ctx.strokeStyle = '#1a120c';
        ctx.stroke();
      }
      if (e.id === hoveredId) {
        const r = (e.kind === 'army' ? 11 : e.kind === 'caravan' ? 9.5 : 7.5) / camera.scale;
        drawNametag(ctx, e.name, mx * TILE, my * TILE, camera.scale, {
          clearAbove: r + 4 / camera.scale,
          avoid: [{ x: mx * TILE - r, y: my * TILE - r, w: r * 2, h: r * 2 }],
          screenPx: this.tagScreenPx,
        });
      }
      ctx.restore();
    }
  }

  private drawEntities(
    ctx: CanvasRenderingContext2D,
    entities: MapEntity[],
    camera: CameraState,
    viewW: number,
    viewH: number,
    player: PlayerState,
    hoveredId: string | null,
    shift = 0,
    showPlayer = true,
    remotePlayers: PlayerState[] = [],
    speechBubbles: ChatBubble[] = [],
    localPeerId: string | null = null,
  ): void {
    const halfW = viewW / (2 * camera.scale) / TILE;
    const halfH = viewH / (2 * camera.scale) / TILE;
    const pad = 3;
    const x0 = camera.x - shift - halfW - pad;
    const x1 = camera.x - shift + halfW + pad;
    const y0 = camera.y - halfH - pad;
    const y1 = camera.y + halfH + pad;
    const pinT = 1 - smoothstep(0.4, 1.65, camera.scale);
    const spriteT = smoothstep(0.55, 3.4, camera.scale);
    type Mark = {
      y: number;
      kind: 'player' | 'guest' | 'actor';
      e?: MapEntity;
      guest?: PlayerState;
      mx?: number;
      my?: number;
      sheet?: string;
      char?: number;
      facing?: number;
      frame?: number;
      lead?: boolean;
    };
    const marks: Mark[] = showPlayer ? [{ y: player.y, kind: 'player' }] : [];
    for (const guest of remotePlayers) {
      if (
        this.toMap(guest.x) < x0 ||
        this.toMap(guest.x) > x1 ||
        this.toMap(guest.y) < y0 ||
        this.toMap(guest.y) > y1
      )
        continue;
      marks.push({ y: this.toMap(guest.y), kind: 'guest', guest });
    }
    for (const e of entities) {
      if (e.resident) continue;
      const ex = this.toMap(e.x);
      const ey = this.toMap(e.y);
      if (ex < x0 || ex > x1 || ey < y0 || ey > y1) {
        const vis =
          !e.afloat &&
          e.members.some(
            (m) =>
              this.toMap(m.x) >= x0 &&
              this.toMap(m.x) <= x1 &&
              this.toMap(m.y) >= y0 &&
              this.toMap(m.y) <= y1,
          );
        if (!vis) continue;
      }
      if (e.token === 'camp' || e.token === 'wagon-circle') {
        marks.push({ y: ey, kind: 'actor', e, mx: ex, my: ey, lead: true });
        continue;
      }
      if (e.afloat) {
        marks.push({
          y: ey,
          kind: 'actor',
          e,
          mx: ex,
          my: ey,
          sheet: 'boat',
          char: boatChar(e.kind),
          facing: e.facing,
          frame: e.frame,
          lead: true,
        });
        continue;
      }
      marks.push({
        y: ey,
        kind: 'actor',
        e,
        mx: ex,
        my: ey,
        sheet: e.sheet,
        char: e.char,
        facing: e.facing,
        frame: e.frame,
        lead: true,
      });
      const followers =
        e.kind === 'army' ? armyVisibleFollowers(camera.scale, e.members.length) : e.members.length;
      for (let i = 0; i < followers; i++) {
        const m = e.members[i]!;
        marks.push({
          y: this.toMap(m.y),
          kind: 'actor',
          e,
          mx: this.toMap(m.x),
          my: this.toMap(m.y),
          sheet: m.sheet,
          char: m.char,
          facing: m.facing,
          frame: m.frame,
          lead: false,
        });
      }
    }
    marks.sort((a, b) => a.y - b.y);
    const occupied: TagBox[] = [];
    const pending: Array<{
      text: string;
      x: number;
      y: number;
      clearAbove: number;
      clearBelow: number;
    }> = [];
    const bubblePending: Array<{
      text: string;
      x: number;
      y: number;
      clearAbove: number;
      clearBelow: number;
    }> = [];
    const scale = camera.scale;
    const anchorByPeer = new Map<
      string,
      { x: number; y: number; clearAbove: number; clearBelow: number }
    >();
    for (const mark of marks) {
      if (mark.kind === 'player') {
        const spr = this.drawPlayer(ctx, player, scale, localPeerId);
        if (spr) occupied.push(spr);
        const clearAbove = spr ? this.toMap(player.y) * TILE - spr.y : 12 / scale;
        const clearBelow = spr ? spr.y + spr.h - this.toMap(player.y) * TILE : 4 / scale;
        if (localPeerId) {
          anchorByPeer.set(localPeerId, {
            x: this.toMap(player.x) * TILE,
            y: this.toMap(player.y) * TILE,
            clearAbove: clearAbove + 10 / scale,
            clearBelow,
          });
        }
        this.drawWagon(ctx, player, scale);
        continue;
      }
      if (mark.kind === 'guest' && mark.guest) {
        const g = mark.guest;
        const spr = this.drawPlayer(ctx, g, scale, null);
        if (spr) occupied.push(spr);
        const clearAbove = spr ? this.toMap(g.y) * TILE - spr.y : 12 / scale;
        const clearBelow = spr ? spr.y + spr.h - this.toMap(g.y) * TILE : 4 / scale;
        if (g.name && scale >= 2.8) {
          pending.push({
            text: g.name,
            x: this.toMap(g.x) * TILE,
            y: this.toMap(g.y) * TILE,
            clearAbove,
            clearBelow,
          });
        }
        anchorByPeer.set(g.id, {
          x: this.toMap(g.x) * TILE,
          y: this.toMap(g.y) * TILE,
          clearAbove: clearAbove + 10 / scale,
          clearBelow,
        });
        continue;
      }
      const e = mark.e!;
      const mx = mark.mx!;
      const my = mark.my!;
      const hovered = e.id === hoveredId;
      if (mark.lead && (e.token === 'camp' || e.token === 'wagon-circle')) {
        const marker = drawCampMarker(ctx, mx, my, scale, e.token);
        occupied.push(marker);
        if (hovered) {
          pending.push({
            text: e.name,
            x: mx * TILE,
            y: my * TILE,
            clearAbove: marker.h + 4 / scale,
            clearBelow: 4 / scale,
          });
        }
        continue;
      }
      const actorPinT = e.afloat ? 1 - smoothstep(0.08, 0.55, scale) : pinT;
      const actorSpriteT = e.afloat ? Math.max(spriteT, smoothstep(0.14, 1.6, scale)) : spriteT;
      let sprite: TagBox | null = null;
      if (actorPinT > 0.05 && mark.lead) {
        ctx.save();
        ctx.globalAlpha = actorPinT;
        if (e.afloat) {
          drawBoatMarker(ctx, mx, my, scale, kindColor(e.kind), e.facing, e.kind);
        } else {
          const r = (e.kind === 'army' ? 11 : e.kind === 'caravan' ? 9.5 : 7.5) / scale;
          ctx.beginPath();
          ctx.arc(mx * TILE, my * TILE, r, 0, Math.PI * 2);
          ctx.fillStyle = kindColor(e.kind);
          ctx.fill();
          ctx.lineWidth = 1.4 / scale;
          ctx.strokeStyle = '#1a120c';
          ctx.stroke();
          sprite = { x: mx * TILE - r, y: my * TILE - r, w: r * 2, h: r * 2 };
        }
        ctx.restore();
      }
      if (actorSpriteT > 0.04) {
        const sheet = this.assets.sheet(mark.sheet!);
        if (sheet) {
          const worldH = characterWorldH(sheet.frameH);
          const close = e.afloat
            ? e.kind === 'wanderer'
              ? 36
              : 46
            : e.kind === 'caravan' || e.kind === 'army'
              ? 34
              : 28;
          const minScreen = lerp(e.afloat ? 16 : 12, close, actorSpriteT);
          const screenH = Math.max(minScreen, worldH * scale);
          const h = screenH / scale;
          const w = (sheet.frameW / sheet.frameH) * h;
          const dx = mx * TILE - w / 2;
          const dy = my * TILE - h + 2 / scale;
          ctx.save();
          ctx.globalAlpha = Math.max(actorSpriteT, 0.4);
          drawCharFrame(ctx, sheet, mark.char!, mark.facing ?? 0, mark.frame ?? 1, dx, dy, w, h);
          ctx.restore();
          sprite = { x: dx, y: dy, w, h };
        }
      }
      if (sprite) occupied.push(sprite);
      if (mark.lead) {
        const clearAbove = sprite ? my * TILE - sprite.y : 12 / scale;
        const clearBelow = sprite ? sprite.y + sprite.h - my * TILE : 4 / scale;
        anchorByPeer.set(e.id, {
          x: mx * TILE,
          y: my * TILE,
          clearAbove: clearAbove + 10 / scale,
          clearBelow,
        });
        if (hovered) {
          pending.push({
            text: e.name,
            x: mx * TILE,
            y: my * TILE,
            clearAbove,
            clearBelow,
          });
        }
      }
    }
    const taken: TagBox[] = [];
    for (const bubble of speechBubbles) {
      const anchor = anchorByPeer.get(bubble.peerId);
      if (!anchor) continue;
      bubblePending.push({
        text: bubble.text,
        x: anchor.x,
        y: anchor.y,
        clearAbove: anchor.clearAbove,
        clearBelow: anchor.clearBelow,
      });
    }
    for (const tag of bubblePending) {
      drawSpeechBubble(ctx, tag.text, tag.x, tag.y, scale, {
        clearAbove: tag.clearAbove,
        clearBelow: tag.clearBelow,
        avoid: occupied,
        taken,
        screenPx: this.tagScreenPx * 1.05,
      });
    }
    for (const tag of pending) {
      drawNametag(ctx, tag.text, tag.x, tag.y, scale, {
        clearAbove: tag.clearAbove,
        clearBelow: tag.clearBelow,
        avoid: occupied,
        taken,
        screenPx: this.tagScreenPx,
      });
    }
  }

  /** Pixel cart trailing the hero. 16 px tile language, sized in screen pixels. */
  private drawWagon(ctx: CanvasRenderingContext2D, player: PlayerState, scale: number): void {
    const trail = wagonTrailFine(player.x, player.y, this.heroYaw, this.mapStep, scale);
    const px = this.toMap(trail.x) * TILE;
    const py = this.toMap(trail.y) * TILE;
    const s = 18 / Math.max(scale, 0.05);
    ctx.save();
    ctx.translate(px, py);
    ctx.fillStyle = '#6b3d18';
    ctx.fillRect(-s * 0.55, -s * 0.15, s * 1.1, s * 0.55);
    ctx.fillStyle = '#e6d3a1';
    ctx.fillRect(-s * 0.42, -s * 0.55, s * 0.84, s * 0.42);
    ctx.fillStyle = '#2a1810';
    ctx.fillRect(-s * 0.62, s * 0.28, s * 0.28, s * 0.28);
    ctx.fillRect(s * 0.34, s * 0.28, s * 0.28, s * 0.28);
    ctx.strokeStyle = '#1a120c';
    ctx.lineWidth = Math.max(1, 1.4 / scale);
    ctx.strokeRect(-s * 0.55, -s * 0.15, s * 1.1, s * 0.55);
    ctx.restore();
  }

  private drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    scale: number,
    localPeerId: string | null,
  ): TagBox | null {
    const px = this.toMap(player.x) * TILE;
    const py = this.toMap(player.y) * TILE;
    const pinT = 1 - smoothstep(0.45, 2.4, scale);
    if (pinT > 0.04) {
      ctx.save();
      ctx.globalAlpha = pinT;
      const r = Math.max(3.2, 7 / scale);
      ctx.beginPath();
      ctx.arc(px, py - 2 / scale, r, 0, Math.PI * 2);
      ctx.fillStyle = pinColorForPlayer(player, localPeerId);
      ctx.fill();
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = '#3a2414';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px, py + 8 / scale);
      ctx.lineTo(px - 5 / scale, py);
      ctx.lineTo(px + 5 / scale, py);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const spriteT = smoothstep(1.6, 5.5, scale);
    if (spriteT <= 0.04) return null;
    const sheet = this.assets.sheet(player.sheet) ?? this.assets.sheet('townsfolk');
    ctx.save();
    ctx.globalAlpha = Math.max(spriteT, 1 - pinT);
    let box: TagBox | null = null;
    if (sheet) {
      const worldH = characterWorldH(sheet.frameH);
      const minScreen = lerp(16, 28, spriteT);
      const screenH = Math.max(minScreen, worldH * scale);
      const h = screenH / scale;
      const w = (sheet.frameW / sheet.frameH) * h;
      const dx = px - w / 2;
      const dy = py - h + 2 / scale;
      drawCharFrame(ctx, sheet, player.char, player.facing, player.frame, dx, dy, w, h);
      box = { x: dx, y: dy, w, h };
    } else {
      const spr = this.assets.player;
      const worldH = characterWorldH(spr.height);
      const minScreen = lerp(16, 28, spriteT);
      const screenH = Math.max(minScreen, worldH * scale);
      const h = screenH / scale;
      const w = (spr.width / spr.height) * h;
      const dx = px - w / 2;
      const dy = py - h + 2 / scale;
      ctx.drawImage(spr, dx, dy, w, h);
      box = { x: dx, y: dy, w, h };
    }
    ctx.restore();
    return box;
  }
}

function pinColorForPlayer(player: PlayerState, localPeerId: string | null): string {
  if (localPeerId && (player.id === LOCAL_PLAYER_ID || player.id === localPeerId)) {
    return peerMarkerColor(localPeerId);
  }
  if (player.id === LOCAL_PLAYER_ID) return '#e8c37a';
  return peerMarkerColor(player.id);
}

function countyRgb(node: MapNode): [number, number, number] {
  const palette: Array<[number, number, number]> = [
    [232, 118, 96],
    [86, 186, 142],
    [236, 186, 82],
    [110, 148, 214],
    [214, 128, 176],
    [176, 196, 86],
    [240, 148, 92],
    [72, 188, 182],
    [204, 112, 98],
    [138, 178, 96],
    [222, 168, 104],
    [104, 156, 188],
    [196, 108, 148],
    [128, 188, 148],
  ];
  let h = 2166136261;
  const key = node.id + node.name;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const i = (h >>> 0) % palette.length;
  const rgb = palette[i]!;
  if (node.origin === 'authored' && (node.kind === 'city' || node.kind === 'town')) {
    return [
      Math.round(rgb[0] * 0.45 + 212 * 0.55),
      Math.round(rgb[1] * 0.45 + 146 * 0.55),
      Math.round(rgb[2] * 0.45 + 79 * 0.55),
    ];
  }
  return rgb;
}

function poiColor(kind: PoiKind): string {
  switch (kind) {
    case 'ruins':
    case 'graves':
    case 'battlefield':
    case 'crypt':
    case 'ancient-gate':
      return 'rgba(196, 154, 108, 1)';
    case 'mansion':
    case 'wizard-tower':
      return 'rgba(176, 137, 196, 1)';
    case 'shrine':
    case 'treehouse':
    case 'fey-circle':
    case 'temple':
    case 'monastery':
      return 'rgba(125, 206, 160, 1)';
    case 'cave':
    case 'hideout':
    case 'mine':
    case 'dragon-lair':
      return 'rgba(154, 171, 159, 1)';
    case 'homestead':
    case 'trading-post':
    case 'port':
      return 'rgba(224, 168, 106, 1)';
    case 'abandoned-camp':
    case 'military-camp':
    case 'bandit-camp':
    case 'orc-fort':
    case 'watchtower':
    case 'tower':
    case 'bridge-keep':
      return 'rgba(232, 145, 90, 1)';
    default:
      return 'rgba(195, 155, 211, 1)';
  }
}
