import { BIOME_COUNT, Biome, TILE } from '../../core/world/models';
import {
  GROUPS,
  SEASON,
  biomeSeason,
  blobQuadrants,
  featureGroup,
  quadPiece,
  quadUniform,
  type TileSrc,
} from '../../core/world/tileset';
import {
  DEFAULT_GROUND_MANIFEST,
  GROUND_MANIFEST_URL,
  GroundTable,
  validateGroundManifest,
  type GroundManifest,
  type KeySpec,
  type Recolor,
  type Rgb,
  type TileRef,
} from './ground-manifest';

type Sheet = CanvasImageSource & { width: number; height: number };

/** A 4x6 Pixel Kingdom group block, keyed to transparency, plus quadrant composites. */
interface Block {
  canvas: HTMLCanvasElement;
  comps: Map<number, HTMLCanvasElement>;
}

const BLOCK_W = 4 * TILE;
const BLOCK_H = 6 * TILE;
/** 3x3 sample index for each neighbour bit (n, ne, e, se, s, sw, w, nw). */
const NB_SAMPLE = [1, 2, 5, 8, 7, 6, 3, 0] as const;
/** Recolour reaches pixels this close to the source colour (grass shades, not rock or canopy). */
const RECOLOR_REACH = 90;
const SEASON_ROWS = [SEASON.summer, SEASON.winter, SEASON.autumn, SEASON.lush];

function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Luminance-preserving recolour of pixels near `from`. Never produces black. */
export function recolorPixels(data: Uint8ClampedArray, from: Rgb, to: Rgb): void {
  const base = Math.max(1, lum(from[0], from[1], from[2]));
  const reach = RECOLOR_REACH * RECOLOR_REACH;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const dr = r - from[0];
    const dg = g - from[1];
    const db = b - from[2];
    if (dr * dr + dg * dg + db * db > reach) continue;
    const k = lum(r, g, b) / base;
    data[i] = Math.max(8, Math.min(255, Math.round(to[0] * k)));
    data[i + 1] = Math.max(8, Math.min(255, Math.round(to[1] * k)));
    data[i + 2] = Math.max(8, Math.min(255, Math.round(to[2] * k)));
  }
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function readPixels(img: Sheet, sx: number, sy: number, w: number, h: number): ImageData {
  const c = canvas(w, h);
  const ctx = ctx2d(c);
  ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function toCanvas(data: ImageData): HTMLCanvasElement {
  const c = canvas(data.width, data.height);
  ctx2d(c).putImageData(data, 0, 0);
  return c;
}

/** Drops pixels equal to `fill` (a 16x16 tile, compared at the same spot) or to an extra colour. */
function keyPixels(data: ImageData, fill: Uint8ClampedArray | null, extra: readonly Rgb[]): void {
  const d = data.data;
  for (let y = 0; y < data.height; y++) {
    for (let x = 0; x < data.width; x++) {
      const i = (y * data.width + x) * 4;
      if (d[i + 3] === 0) continue;
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      let drop = false;
      if (fill) {
        const j = ((y % TILE) * TILE + (x % TILE)) * 4;
        drop = fill[j] === r && fill[j + 1] === g && fill[j + 2] === b;
      }
      for (let k = 0; !drop && k < extra.length; k++) {
        const c = extra[k]!;
        drop = c[0] === r && c[1] === g && c[2] === b;
      }
      if (drop) d[i + 3] = 0;
    }
  }
}

export interface GroundStats {
  /** Upper/lower pairs drawn, and whether they used exact art, a fallback, or nothing. */
  pairs: Map<string, 'exact' | 'fallback' | 'missing'>;
}

/**
 * Classic-skin overworld ground painter: layered grounds with 8-neighbour
 * quarter-tile transitions, then features (forest, rock, cliffs) and roads.
 * All art and the ground order come from a {@link GroundManifest}.
 */
export class ClassicGround {
  readonly table: GroundTable;
  readonly stats: GroundStats = { pairs: new Map() };
  private readonly groundOf: Uint8Array;
  private readonly featureOf: Int8Array;
  private readonly seasonOf: Uint8Array;
  private readonly fills: Array<HTMLCanvasElement | null> = [];
  private readonly fillRgbs: Rgb[] = [];
  private readonly edges: Array<Block | null | undefined> = [];
  private readonly features = new Map<number, Block>();
  private readonly roads = new Map<number, Block>();
  private readonly decos = new Map<number, HTMLCanvasElement>();
  private readonly plateauFills = new Map<number, Uint8ClampedArray>();

  constructor(
    manifest: GroundManifest,
    private readonly sheets: Map<string, Sheet>,
    private readonly pk: Sheet,
  ) {
    this.table = new GroundTable(manifest);
    this.groundOf = this.table.biomeGround;
    this.featureOf = new Int8Array(BIOME_COUNT);
    this.seasonOf = new Uint8Array(BIOME_COUNT);
    for (let b = 0; b < BIOME_COUNT; b++) {
      this.featureOf[b] = featureGroup(b as Biome) ?? -1;
      this.seasonOf[b] = biomeSeason(b as Biome);
    }
    for (let i = 0; i < this.table.ids.length; i++) this.buildFill(i);
  }

  static async load(
    base: string,
    pk: Sheet,
    loadImage: (src: string) => Promise<Sheet>,
  ): Promise<ClassicGround> {
    let manifest = DEFAULT_GROUND_MANIFEST;
    try {
      const res = await fetch(`${base}${GROUND_MANIFEST_URL}`);
      if (res.ok) {
        const { manifest: parsed, errors } = validateGroundManifest(await res.json());
        if (parsed) manifest = parsed;
        else console.warn('ground-transitions.json ignored:', errors.join('; '));
      }
    } catch (error) {
      console.warn('ground-transitions.json unavailable, using built-in grounds', error);
    }
    const sheets = new Map<string, Sheet>();
    const pkUrl = DEFAULT_GROUND_MANIFEST.sheets.pk;
    await Promise.all(
      Object.entries(manifest.sheets).map(async ([id, url]) => {
        if (url === pkUrl) {
          sheets.set(id, pk);
          return;
        }
        try {
          sheets.set(id, await loadImage(`${base}${url}`));
        } catch (error) {
          console.warn(`ground sheet ${id} failed to load; its edges fall back`, error);
        }
      }),
    );
    const usable: GroundManifest = {
      ...manifest,
      edges: manifest.edges.filter((e) => sheets.has(e.block.sheet)),
    };
    if (manifest.grounds.some((g) => g.fill && !sheets.has(g.fill.sheet))) {
      return new ClassicGround(DEFAULT_GROUND_MANIFEST, new Map([['pk', pk]]), pk);
    }
    return new ClassicGround(usable, sheets, pk);
  }

  /** Flat ground colour for a biome (far-zoom palette). */
  fillRgb(biome: Biome): Rgb {
    return this.fillRgbs[this.groundOf[biome] ?? 0] ?? [104, 212, 98];
  }

  /**
   * Paints one map cell. `nb` holds the 3x3 biomes around it (row-major,
   * centre at 4). `road` is -1 off-road, else the 8-bit road neighbour mask.
   */
  paintCell(
    ctx: CanvasRenderingContext2D,
    nb: Uint8Array,
    road: number,
    deco: TileSrc | null,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    const center = nb[4]!;
    const own = this.groundOf[center]!;
    const fill = this.fills[own];
    if (fill) ctx.drawImage(fill, 0, 0, TILE, TILE, dx, dy, stamp, stamp);
    if (deco) ctx.drawImage(this.deco(deco), 0, 0, TILE, TILE, dx, dy, stamp, stamp);
    let uppers = 0;
    for (let i = 0; i < 8; i++) {
      const g = this.groundOf[nb[NB_SAMPLE[i]!]!]!;
      if (g > own) uppers |= 1 << g;
    }
    while (uppers !== 0) {
      const upper = 31 - Math.clz32(uppers & -uppers);
      uppers &= uppers - 1;
      const block = this.edge(upper, own);
      if (!block) continue;
      let mask = 0;
      for (let i = 0; i < 8; i++) {
        if (this.groundOf[nb[NB_SAMPLE[i]!]!]! < upper) mask |= 1 << i;
      }
      this.drawQuads(ctx, block, blobQuadrants(mask), dx, dy, stamp);
    }
    const group = this.featureOf[center]!;
    if (group >= 0) {
      const season = this.seasonOf[center]!;
      let mask = 0;
      for (let i = 0; i < 8; i++) {
        const b = nb[NB_SAMPLE[i]!]!;
        if (this.featureOf[b] === group && this.seasonOf[b] === season) mask |= 1 << i;
      }
      this.drawQuads(ctx, this.feature(group, season, own), blobQuadrants(mask), dx, dy, stamp);
    }
    if (road >= 0 && center !== Biome.Water) {
      this.drawQuads(ctx, this.road(this.seasonOf[center]!), blobQuadrants(road), dx, dy, stamp);
    }
  }

  private drawQuads(
    ctx: CanvasRenderingContext2D,
    block: Block,
    packed: number,
    dx: number,
    dy: number,
    stamp: number,
  ): void {
    if (quadUniform(packed)) {
      const p = packed & 31;
      ctx.drawImage(
        block.canvas,
        (p & 3) * TILE,
        (p >> 2) * TILE,
        TILE,
        TILE,
        dx,
        dy,
        stamp,
        stamp,
      );
      return;
    }
    let comp = block.comps.get(packed);
    if (!comp) {
      comp = canvas(TILE, TILE);
      const c = comp.getContext('2d')!;
      const h = TILE / 2;
      for (let q = 0; q < 4; q++) {
        const p = quadPiece(packed, q);
        const ox = q === 1 || q === 2 ? h : 0;
        const oy = q >= 2 ? h : 0;
        c.drawImage(block.canvas, (p & 3) * TILE + ox, (p >> 2) * TILE + oy, h, h, ox, oy, h, h);
      }
      block.comps.set(packed, comp);
    }
    ctx.drawImage(comp, 0, 0, TILE, TILE, dx, dy, stamp, stamp);
  }

  private sheet(ref: TileRef): Sheet | null {
    return this.sheets.get(ref.sheet) ?? null;
  }

  private buildFill(index: number): void {
    const resolved = this.table.resolveFill(index);
    const img = resolved ? this.sheet(resolved.fill) : null;
    if (!resolved || !img) {
      this.fills[index] = null;
      this.fillRgbs[index] = [104, 212, 98];
      return;
    }
    const data = readPixels(img, resolved.fill.col * TILE, resolved.fill.row * TILE, TILE, TILE);
    for (const t of resolved.tints) recolorPixels(data.data, this.baseRgb(t.base), t.tint);
    this.fills[index] = toCanvas(data);
    const i = (8 * TILE + 8) * 4;
    this.fillRgbs[index] = [data.data[i]!, data.data[i + 1]!, data.data[i + 2]!];
  }

  /** Untinted fill colour of a ground id (tints map from it). */
  private baseRgb(id: string): Rgb {
    const index = this.table.ids.indexOf(id);
    const resolved = this.table.resolveFill(index);
    const img = resolved ? this.sheet(resolved.fill) : null;
    if (!resolved || !img) return [104, 212, 98];
    const px = readPixels(img, resolved.fill.col * TILE + 8, resolved.fill.row * TILE + 8, 1, 1);
    const rgb: Rgb = [px.data[0]!, px.data[1]!, px.data[2]!];
    let out = rgb;
    for (const t of resolved.tints) out = t.tint;
    return out;
  }

  private edge(upper: number, lower: number): Block | null {
    const slot = upper * 32 + lower;
    const cached = this.edges[slot];
    if (cached !== undefined) return cached;
    const resolved = this.table.resolveEdge(upper, lower);
    const pair = `${this.table.ids[upper]}/${this.table.ids[lower]}`;
    const img = resolved ? this.sheet(resolved.edge.block) : null;
    if (!resolved || !img) {
      this.stats.pairs.set(pair, 'missing');
      this.edges[slot] = null;
      return null;
    }
    this.stats.pairs.set(pair, resolved.exact ? 'exact' : 'fallback');
    const { block, key } = resolved.edge;
    const data = readPixels(img, block.col * TILE, block.row * TILE, BLOCK_W, BLOCK_H);
    this.applyKey(data, img, block, key ?? { mode: 'fill' });
    for (const rc of resolved.recolors) {
      const step: Recolor = 'from' in rc ? rc : { from: this.baseRgb(rc.base), to: rc.tint };
      recolorPixels(data.data, step.from, step.to);
    }
    const built: Block = { canvas: toCanvas(data), comps: new Map() };
    this.edges[slot] = built;
    return built;
  }

  private applyKey(data: ImageData, img: Sheet, block: TileRef, key: KeySpec): void {
    if (key.mode === 'none' && !key.extra) return;
    const fill =
      key.mode === 'fill'
        ? readPixels(img, (block.col + 1) * TILE, (block.row + 1) * TILE, TILE, TILE).data
        : null;
    keyPixels(data, fill, key.extra ?? []);
  }

  private plateauFill(season: number): Uint8ClampedArray {
    let fill = this.plateauFills.get(season);
    if (!fill) {
      fill = readPixels(this.pk, (GROUPS.plateau + 1) * TILE, (season + 1) * TILE, TILE, TILE).data;
      this.plateauFills.set(season, fill);
    }
    return fill;
  }

  /** Forest, rock or cliff block of a season, grass keyed out, tinted to the ground below. */
  private feature(group: number, season: number, ground: number): Block {
    const k = group * 4096 + season * 64 + ground;
    let block = this.features.get(k);
    if (!block) {
      const data = readPixels(this.pk, group * TILE, season * TILE, BLOCK_W, BLOCK_H);
      keyPixels(data, this.plateauFill(season), []);
      const resolved = this.table.resolveFill(ground);
      for (const t of resolved?.tints ?? []) {
        recolorPixels(data.data, this.baseRgb(t.base), t.tint);
      }
      block = { canvas: toCanvas(data), comps: new Map() };
      this.features.set(k, block);
    }
    return block;
  }

  /** Sand road block of a season with its grass surround keyed out. */
  private road(season: number): Block {
    let block = this.roads.get(season);
    if (!block) {
      const data = readPixels(this.pk, GROUPS.path * TILE, season * TILE, BLOCK_W, BLOCK_H);
      keyPixels(data, this.plateauFill(season), []);
      block = { canvas: toCanvas(data), comps: new Map() };
      this.roads.set(season, block);
    }
    return block;
  }

  /** Deco tile with its grass square keyed out, so it never erases a transition. */
  private deco(src: TileSrc): HTMLCanvasElement {
    const k = src.sx * 4096 + src.sy;
    let tile = this.decos.get(k);
    if (!tile) {
      const row = Math.floor(src.sy / TILE);
      let band: number = SEASON.summer;
      for (const s of SEASON_ROWS) if (s <= row && s > band) band = s;
      const data = readPixels(this.pk, src.sx, src.sy, TILE, TILE);
      keyPixels(data, this.plateauFill(band), []);
      tile = toCanvas(data);
      this.decos.set(k, tile);
    }
    return tile;
  }
}
