import { BIOME_COUNT, Biome } from '../../core/world/models';

/**
 * Overworld ground transitions for the classic (Pixel Kingdom) skin, as data.
 *
 * Grounds are listed bottom to top: a higher ground's edge is drawn over a
 * lower one. Every edge is a 4x6 tile block in the Pixel Kingdom group layout
 * (3x3 blob, strips, single, inner corners at rows 4-5). A painted sheet such
 * as `overworld-transitions.png` drops in by adding it to `sheets` and an
 * `edges` entry with `"key": { "mode": "none" }`; no code changes.
 */
export type Rgb = readonly [number, number, number];

export interface TileRef {
  sheet: string;
  col: number;
  row: number;
}

export interface KeySpec {
  /** `fill`: drop pixels equal to the block's (1,1) tile at the same spot. `none`: art is already transparent. */
  mode: 'fill' | 'none';
  /** Extra colours to drop (shadows the lower ground casts). */
  extra?: Rgb[];
}

export interface Recolor {
  from: Rgb;
  to: Rgb;
}

export interface GroundDef {
  id: string;
  /** Fill tile. Omit when `base` + `tint` derive this ground from another. */
  fill?: TileRef;
  base?: string;
  tint?: Rgb;
}

export interface EdgeDef {
  /** Ground drawn on top. */
  upper: string;
  /** Ground underneath, or `*` for any lower ground. */
  lower: string;
  /** Top-left tile of the 4x6 block. */
  block: TileRef;
  key?: KeySpec;
  recolor?: Recolor;
}

export interface GroundManifest {
  version: 1;
  /** Sheet id -> URL relative to the asset base. */
  sheets: Record<string, string>;
  /** Bottom to top. */
  grounds: GroundDef[];
  /** Biome name -> ground id. */
  biomes: Record<string, string>;
  edges: EdgeDef[];
}

const PK = 'pk';
const SAND_SHADE: Rgb[] = [
  [233, 167, 106],
  [231, 148, 107],
];
const fillKey = (extra?: Rgb[]): KeySpec => (extra ? { mode: 'fill', extra } : { mode: 'fill' });

export const DEFAULT_GROUND_MANIFEST: GroundManifest = {
  version: 1,
  sheets: { [PK]: 'assets/map/classic/tilesets/grasslands.png' },
  grounds: [
    { id: 'W', fill: { sheet: PK, col: 13, row: 1 } },
    { id: 'D', fill: { sheet: PK, col: 9, row: 1 } },
    { id: 'Db', base: 'D', tint: [226, 150, 108] },
    { id: 'Da', base: 'D', tint: [204, 184, 164] },
    { id: 'A', fill: { sheet: PK, col: 1, row: 15 } },
    { id: 'G', fill: { sheet: PK, col: 1, row: 1 } },
    { id: 'Gm', base: 'G', tint: [150, 228, 136] },
    { id: 'L', fill: { sheet: PK, col: 1, row: 22 } },
    { id: 'S', fill: { sheet: PK, col: 1, row: 8 } },
  ],
  biomes: {
    Water: 'W',
    Sand: 'D',
    Desert: 'D',
    Badlands: 'Db',
    Ashlands: 'Da',
    Hills: 'A',
    Plains: 'G',
    Meadow: 'G',
    Forest: 'G',
    Mountain: 'Gm',
    DarkForest: 'L',
    Marsh: 'L',
    Jungle: 'L',
    Snow: 'S',
    Taiga: 'S',
  },
  edges: [
    { upper: 'D', lower: 'W', block: { sheet: PK, col: 12, row: 0 }, key: fillKey() },
    { upper: 'A', lower: 'W', block: { sheet: PK, col: 4, row: 14 }, key: fillKey() },
    { upper: 'G', lower: 'W', block: { sheet: PK, col: 4, row: 0 }, key: fillKey() },
    { upper: 'L', lower: 'W', block: { sheet: PK, col: 4, row: 21 }, key: fillKey() },
    { upper: 'S', lower: 'W', block: { sheet: PK, col: 4, row: 7 }, key: fillKey() },
    {
      upper: 'D',
      lower: '*',
      block: { sheet: PK, col: 8, row: 0 },
      key: fillKey(SAND_SHADE),
      recolor: { from: [104, 212, 98], to: [250, 188, 128] },
    },
    { upper: 'A', lower: '*', block: { sheet: PK, col: 8, row: 14 }, key: fillKey(SAND_SHADE) },
    { upper: 'G', lower: '*', block: { sheet: PK, col: 8, row: 0 }, key: fillKey(SAND_SHADE) },
    { upper: 'L', lower: '*', block: { sheet: PK, col: 8, row: 21 }, key: fillKey(SAND_SHADE) },
    { upper: 'S', lower: '*', block: { sheet: PK, col: 8, row: 7 }, key: fillKey(SAND_SHADE) },
  ],
};

export const GROUND_MANIFEST_URL = 'assets/map/classic/ground-transitions.json';

/** A ground resolved to its fill tile and the tints to apply on top, inner first. */
export interface ResolvedFill {
  fill: TileRef;
  tints: Array<{ base: string; tint: Rgb }>;
}

/** An edge resolved for one upper/lower pair; recolours apply in order. */
export interface ResolvedEdge {
  edge: EdgeDef;
  recolors: Array<Recolor | { base: string; tint: Rgb }>;
  /** True when the manifest names this exact pair (no fallback). */
  exact: boolean;
}

export class GroundTable {
  readonly ids: string[];
  /** Ground index (= draw rank) per biome id. */
  readonly biomeGround: Uint8Array;
  private readonly byId = new Map<string, GroundDef>();
  private readonly rank = new Map<string, number>();

  constructor(readonly manifest: GroundManifest) {
    this.ids = manifest.grounds.map((g) => g.id);
    manifest.grounds.forEach((g, i) => {
      this.byId.set(g.id, g);
      this.rank.set(g.id, i);
    });
    this.biomeGround = new Uint8Array(BIOME_COUNT);
    const fallback = this.rank.get(manifest.grounds[0]!.id) ?? 0;
    this.biomeGround.fill(fallback);
    for (const [name, ground] of Object.entries(manifest.biomes)) {
      const biome = Biome[name as keyof typeof Biome] as number | undefined;
      const r = this.rank.get(ground);
      if (biome !== undefined && r !== undefined) this.biomeGround[biome] = r;
    }
  }

  groundOf(biome: Biome): number {
    return this.biomeGround[biome] ?? 0;
  }

  resolveFill(index: number): ResolvedFill | null {
    const tints: ResolvedFill['tints'] = [];
    let ground = this.byId.get(this.ids[index] ?? '');
    for (let guard = 0; ground && guard < 8; guard++) {
      if (ground.fill) return { fill: ground.fill, tints: tints.reverse() };
      if (!ground.base || !ground.tint) return null;
      tints.push({ base: ground.base, tint: ground.tint });
      ground = this.byId.get(ground.base);
    }
    return null;
  }

  /**
   * Edge for `upper` drawn over `lower`: exact pair, then the lower's base,
   * then `upper/*`, then the upper's base ground recoloured to its tint.
   * Null means no art: the seam stays hard (still layered by rank).
   */
  resolveEdge(upper: number, lower: number): ResolvedEdge | null {
    const lowerId = this.ids[lower] ?? '';
    const lowerBase = this.byId.get(lowerId)?.base;
    const tints: Array<{ base: string; tint: Rgb }> = [];
    let id = this.ids[upper] ?? '';
    for (let guard = 0; guard < 8; guard++) {
      const exact = this.find(id, lowerId);
      const hit = exact ?? (lowerBase ? this.find(id, lowerBase) : null) ?? this.find(id, '*');
      if (hit) {
        const recolors: ResolvedEdge['recolors'] = hit.recolor ? [hit.recolor] : [];
        recolors.push(...tints.reverse());
        return { edge: hit, recolors, exact: !!exact && tints.length === 0 };
      }
      const ground = this.byId.get(id);
      if (!ground?.base || !ground.tint) return null;
      tints.push({ base: ground.base, tint: ground.tint });
      id = ground.base;
    }
    return null;
  }

  private find(upper: string, lower: string): EdgeDef | null {
    for (const edge of this.manifest.edges) {
      if (edge.upper === upper && edge.lower === lower) return edge;
    }
    return null;
  }
}

function isRgb(v: unknown): v is Rgb {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 255)
  );
}

function isTileRef(v: unknown, sheets: Record<string, string>): v is TileRef {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.sheet === 'string' &&
    t.sheet in sheets &&
    Number.isInteger(t.col) &&
    Number.isInteger(t.row) &&
    (t.col as number) >= 0 &&
    (t.row as number) >= 0
  );
}

/** Validates a manifest from JSON. Returns the errors; empty means usable. */
export function validateGroundManifest(raw: unknown): {
  manifest: GroundManifest | null;
  errors: string[];
} {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { manifest: null, errors: ['not an object'] };
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) errors.push('version must be 1');
  const sheets = m.sheets;
  if (!sheets || typeof sheets !== 'object') errors.push('sheets missing');
  const sheetMap = (sheets ?? {}) as Record<string, string>;
  for (const [id, url] of Object.entries(sheetMap)) {
    if (typeof url !== 'string' || url.length === 0) errors.push(`sheet ${id} has no url`);
  }
  const ids = new Set<string>();
  if (!Array.isArray(m.grounds) || m.grounds.length === 0) {
    errors.push('grounds missing');
  } else {
    for (const g of m.grounds as unknown[]) {
      const ground = g as Record<string, unknown>;
      const id = ground?.id;
      if (typeof id !== 'string' || ids.has(id)) {
        errors.push(`bad or duplicate ground id ${String(id)}`);
        continue;
      }
      if (ground.fill !== undefined) {
        if (!isTileRef(ground.fill, sheetMap)) errors.push(`ground ${id} fill is not a tile ref`);
      } else if (typeof ground.base !== 'string' || !ids.has(ground.base) || !isRgb(ground.tint)) {
        errors.push(`ground ${id} needs a fill, or a lower base plus an rgb tint`);
      }
      ids.add(id);
    }
  }
  const biomes = m.biomes;
  if (!biomes || typeof biomes !== 'object') {
    errors.push('biomes missing');
  } else {
    for (const [name, ground] of Object.entries(biomes as Record<string, unknown>)) {
      if (Biome[name as keyof typeof Biome] === undefined) errors.push(`unknown biome ${name}`);
      if (typeof ground !== 'string' || !ids.has(ground)) {
        errors.push(`biome ${name} maps to unknown ground`);
      }
    }
  }
  if (!Array.isArray(m.edges)) {
    errors.push('edges missing');
  } else {
    (m.edges as unknown[]).forEach((e, i) => {
      const edge = e as Record<string, unknown>;
      if (typeof edge?.upper !== 'string' || !ids.has(edge.upper)) {
        errors.push(`edge ${i}: unknown upper`);
      }
      if (typeof edge?.lower !== 'string' || (edge.lower !== '*' && !ids.has(edge.lower))) {
        errors.push(`edge ${i}: unknown lower`);
      }
      if (!isTileRef(edge?.block, sheetMap)) errors.push(`edge ${i}: block is not a tile ref`);
      const key = edge?.key as Record<string, unknown> | undefined;
      if (key !== undefined) {
        if (key.mode !== 'fill' && key.mode !== 'none') errors.push(`edge ${i}: bad key mode`);
        if (key.extra !== undefined && !(Array.isArray(key.extra) && key.extra.every(isRgb))) {
          errors.push(`edge ${i}: bad key extra`);
        }
      }
      const rc = edge?.recolor as Record<string, unknown> | undefined;
      if (rc !== undefined && !(isRgb(rc.from) && isRgb(rc.to))) {
        errors.push(`edge ${i}: bad recolor`);
      }
    });
  }
  return { manifest: errors.length === 0 ? (raw as GroundManifest) : null, errors };
}
