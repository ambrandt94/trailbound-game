/**
 * Settlement generation 2: scored sites, a size-class hierarchy, chunk-edge
 * margins, an outskirts ring, and biome satellites. Generation 1 never calls
 * this. Plans are not saved; the world is rebuilt from the seed and settings.
 */
import { mapDisplayStep } from './map-grid';
import { Biome, type MapNode, type NodeKind, type Vec2, boundsFromTiles } from './models';
import { fbm, hash2, Rng } from './noise';
import { generatedName } from './names';
import { SIZE_CLASS, type SettlementClass } from './city-plan';

/** Core diameter in display tiles (a display tile is 128 m on a 16× world). */
const SPAN: Record<SettlementClass, number> = {
  hamlet: 0.55,
  village: 1.15,
  town: 1.85,
  city: 2.15,
  capital: 5.4,
  metropolis: 8.2,
};

/** Outskirts reach past the core edge, in display tiles (§2.5). */
const RING: Record<SettlementClass, number> = {
  hamlet: 0.55,
  village: 1,
  town: 2,
  city: 3,
  capital: 4,
  metropolis: 5,
};

/** Centre-to-centre spacing in display tiles. The wider class wins. */
const GAP: Record<SettlementClass, number> = {
  hamlet: 2,
  village: 3,
  town: 6,
  city: 12,
  capital: 12,
  metropolis: 14,
};

/**
 * Rise over run. This terrain is rugged even on plains (a 128 m sample is
 * often steeper than 0.5), so the cap keeps cliff faces out and the score
 * still prefers the flattest shelf.
 */
/**
 * Fine-tile box for a place that still plays as one 3D zone. A 3×3 display
 * city is 48 tiles on a side and about nine times the old Ashfen bake, so the
 * single-zone classes stay inside this until wards (C4) split them.
 */
const SINGLE_ZONE_BOX = 32;

const SLOPE_MAX: Record<SettlementClass, number> = {
  hamlet: 2.4,
  village: 2,
  town: 1.6,
  city: 1.15,
  capital: 0.95,
  metropolis: 0.7,
};

interface SatSpec {
  hamlets: readonly [number, number];
  villages: readonly [number, number];
  industry: readonly [number, number];
  /** A market town, metropolis only. */
  town: readonly [number, number];
  dist: readonly [number, number];
  townDist: readonly [number, number];
}

const SAT: Record<SettlementClass, SatSpec> = {
  hamlet: {
    hamlets: [0, 0],
    villages: [0, 0],
    industry: [0, 0],
    town: [0, 0],
    dist: [2, 2],
    townDist: [6, 8],
  },
  village: {
    hamlets: [0, 1],
    villages: [0, 0],
    industry: [0, 0],
    town: [0, 0],
    dist: [1.5, 2],
    townDist: [6, 8],
  },
  town: {
    hamlets: [2, 4],
    villages: [0, 1],
    industry: [0, 0],
    town: [0, 0],
    dist: [1.5, 3],
    townDist: [6, 8],
  },
  city: {
    hamlets: [3, 6],
    villages: [1, 3],
    industry: [1, 1],
    town: [0, 0],
    dist: [2, 5],
    townDist: [6, 8],
  },
  capital: {
    hamlets: [6, 10],
    villages: [2, 4],
    industry: [1, 2],
    town: [0, 0],
    dist: [2, 6],
    townDist: [6, 8],
  },
  metropolis: {
    hamlets: [10, 16],
    villages: [4, 6],
    industry: [2, 3],
    town: [1, 1],
    dist: [2, 8],
    townDist: [6, 8],
  },
};

interface BiomeRow {
  hamlet: string;
  village: string;
  industry: string;
  use: string;
}

const ROWS: Record<number, BiomeRow> = {
  [Biome.Plains]: {
    hamlet: 'farm hamlet',
    village: 'mill village',
    industry: 'mill',
    use: 'wheat',
  },
  [Biome.Meadow]: {
    hamlet: 'orchard hamlet',
    village: 'farm village',
    industry: 'mill',
    use: 'orchard',
  },
  [Biome.Forest]: {
    hamlet: 'charcoal hamlet',
    village: 'logging camp',
    industry: 'logging camp',
    use: 'clearing',
  },
  [Biome.DarkForest]: {
    hamlet: 'hunter lodge',
    village: 'logging camp',
    industry: 'logging camp',
    use: 'clearing',
  },
  [Biome.Hills]: {
    hamlet: 'herder steading',
    village: 'mining hamlet',
    industry: 'mining hamlet',
    use: 'terrace',
  },
  [Biome.Heath]: {
    hamlet: 'mining hamlet',
    village: 'well-stop',
    industry: 'mining hamlet',
    use: 'pasture',
  },
  [Biome.Mountain]: {
    hamlet: 'mining hamlet',
    village: 'herder steading',
    industry: 'mining hamlet',
    use: 'terrace',
  },
  [Biome.Desert]: {
    hamlet: 'well-stop',
    village: 'caravanserai',
    industry: 'well-stop',
    use: 'oasis',
  },
  [Biome.Ashlands]: {
    hamlet: 'quarry hamlet',
    village: 'quarry hamlet',
    industry: 'quarry hamlet',
    use: 'quarry',
  },
  [Biome.Marsh]: {
    hamlet: 'stilt fishing hamlet',
    village: 'stilt fishing hamlet',
    industry: 'fishing hamlet',
    use: 'reed',
  },
  [Biome.Jungle]: {
    hamlet: 'stilt hamlet',
    village: 'plantation',
    industry: 'plantation',
    use: 'paddy',
  },
  [Biome.Taiga]: {
    hamlet: 'logging camp',
    village: 'herder steading',
    industry: 'logging camp',
    use: 'clearing',
  },
  [Biome.Snow]: {
    hamlet: 'herder steading',
    village: 'ice-fishing hamlet',
    industry: 'ice-fishing hamlet',
    use: 'snow',
  },
  [Biome.Sand]: {
    hamlet: 'fishing hamlet',
    village: 'port village',
    industry: 'fishing hamlet',
    use: 'salt',
  },
};

const PLAINS = ROWS[Biome.Plains]!;

export function biomeRow(biome: Biome): BiomeRow {
  return ROWS[biome] ?? PLAINS;
}

/** Roles a satellite of this biome is allowed to take. */
export function satelliteRolesFor(biome: Biome): readonly string[] {
  const row = biomeRow(biome);
  return [row.hamlet, row.village, row.industry];
}

export function landUseRgb(use: string | undefined): [number, number, number] {
  switch (use) {
    case 'wheat':
      return [222, 190, 92];
    case 'pasture':
      return [138, 176, 78];
    case 'orchard':
      return [186, 128, 72];
    case 'clearing':
      return [126, 154, 78];
    case 'terrace':
      return [168, 140, 96];
    case 'quarry':
      return [148, 140, 132];
    case 'oasis':
      return [96, 168, 88];
    case 'reed':
      return [98, 142, 102];
    case 'paddy':
      return [112, 168, 96];
    case 'snow':
      return [214, 224, 230];
    case 'salt':
      return [214, 204, 176];
    case 'barren':
      return [132, 112, 96];
    default:
      return [196, 176, 96];
  }
}

export function settlementFillRgb(cls: SettlementClass | undefined): [number, number, number] {
  switch (cls) {
    case 'hamlet':
      return [196, 164, 104];
    case 'village':
      return [184, 136, 80];
    case 'town':
      return [168, 96, 68];
    case 'capital':
      return [124, 52, 48];
    case 'metropolis':
      return [96, 36, 42];
    case 'city':
      return [152, 64, 54];
    default:
      return [160, 124, 84];
  }
}

export interface GatePoint {
  x: number;
  y: number;
}

export interface SitingInput {
  seed: number;
  width: number;
  height: number;
  biomes: Uint8Array;
  heightM: Float32Array;
  rng: Rng;
  mainland?: Uint8Array;
  gates?: readonly GatePoint[];
  paths: Uint8Array;
  stampRoad: (x0: number, y0: number, x1: number, y1: number, rng: Rng) => void;
}

interface Candidate {
  x: number;
  y: number;
  biome: Biome;
  slope: number;
  coast: boolean;
  hill: boolean;
}

interface Ctx {
  seed: number;
  w: number;
  h: number;
  step: number;
  q: number;
  biomes: Uint8Array;
  heightM: Float32Array;
  mainland?: Uint8Array;
  gates: readonly GatePoint[];
  blocked: Set<number>;
  nodes: MapNode[];
  names: Set<string>;
  rng: Rng;
  roads: Float32Array | null;
  gw: number;
  paths: Uint8Array;
  stampRoad: SitingInput['stampRoad'];
}

const CARDINAL: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function placeSettlementsGen2(input: SitingInput): MapNode[] {
  const step = mapDisplayStep(input.width);
  const ctx: Ctx = {
    seed: input.seed >>> 0 || 1,
    w: input.width,
    h: input.height,
    step,
    q: Math.max(1, Math.floor(step / 2)),
    biomes: input.biomes,
    heightM: input.heightM,
    mainland: input.mainland,
    gates: input.gates ?? [],
    blocked: new Set<number>(),
    nodes: [],
    names: new Set<string>(),
    rng: input.rng,
    roads: null,
    gw: Math.max(1, Math.ceil(input.width / step)),
    paths: input.paths,
    stampRoad: input.stampRoad,
  };
  const candidates = collectCandidates(ctx);
  const roll = hash2(ctx.seed, 41, 9);
  const wantMetro = roll < 0.025;
  const wantCapital = roll >= 0.025 && roll < 0.09;
  const majors = planMajors(wantMetro, wantCapital);
  const placedMajors: MapNode[] = [];
  for (const major of majors) {
    const node = placeClass(ctx, candidates, major.cls, major.want, major, false);
    if (node) placedMajors.push(node);
  }
  // Ashfen is the start. If the upgrade took the only good sites, still force a city.
  if (!ctx.nodes.some((node) => node.id === 'ashfen')) {
    placeClass(
      ctx,
      candidates,
      'city',
      Biome.Plains,
      anchor('ashfen', 'Ashfen', 1101),
      false,
      true,
    );
  }
  linkRing(
    ctx,
    placedMajors.length
      ? placedMajors
      : ctx.nodes.filter(
          (n) =>
            n.settlementClass === 'city' ||
            n.settlementClass === 'capital' ||
            n.settlementClass === 'metropolis',
        ),
  );
  ctx.roads = roadDistance(ctx);

  const extraTowns = ctx.rng.int(1, 3);
  const extraVillages = ctx.rng.int(4, 8);
  const extraHamlets = ctx.rng.int(8, 16);
  placeClass(ctx, candidates, 'town', Biome.Hills, anchor('veldcross', 'Ironmarch', 1107), true);
  for (let i = 0; i < extraTowns; i++)
    placeClass(ctx, candidates, 'town', Biome.Plains, null, true);
  ctx.roads = roadDistance(ctx);
  placeClass(ctx, candidates, 'village', Biome.Desert, anchor('sunspire', 'Sunspire', 1108), true);
  for (let i = 0; i < extraVillages; i++)
    placeClass(ctx, candidates, 'village', Biome.Meadow, null, true);
  for (let i = 0; i < extraHamlets; i++)
    placeClass(ctx, candidates, 'hamlet', Biome.Plains, null, true);
  placeClass(
    ctx,
    candidates,
    'hamlet',
    Biome.Mountain,
    anchor('dunharrow', 'Dunharrow', 1104, 'camp'),
    true,
  );
  placeGrove(ctx, candidates, 'hollowmere', 'Shadowglen', 1102, Biome.Forest);
  placeGrove(ctx, candidates, 'rowancopse', 'Mythwood', 1106, Biome.DarkForest);
  placeGrove(ctx, candidates, 'jadewild', 'Jadewild', 1109, Biome.Jungle);
  ensureClass(ctx, candidates, 'town', Biome.Plains);
  ensureClass(ctx, candidates, 'village', Biome.Meadow);
  ensureClass(ctx, candidates, 'hamlet', Biome.Plains);
  if (
    !ctx.nodes.some(
      (node) =>
        node.settlementClass === 'city' ||
        node.settlementClass === 'capital' ||
        node.settlementClass === 'metropolis',
    )
  ) {
    placeClass(
      ctx,
      candidates,
      'city',
      Biome.Plains,
      anchor('ashfen', 'Ashfen', 1101),
      false,
      true,
    );
  }

  const primaries = ctx.nodes.filter((node) => node.settlementClass && !node.satelliteOf);
  for (const parent of primaries) {
    const cls = parent.settlementClass;
    if (!cls) continue;
    growOutskirts(ctx, parent, cls);
    placeSatellites(ctx, candidates, parent, cls);
  }
  return ctx.nodes;
}

interface Anchor {
  id: string;
  name: string;
  seed: number;
  kind?: NodeKind;
}

function anchor(id: string, name: string, seed: number, kind?: NodeKind): Anchor {
  return { id, name, seed, kind };
}

function planMajors(
  wantMetro: boolean,
  wantCapital: boolean,
): Array<{ cls: SettlementClass; want: Biome; id: string; name: string; seed: number }> {
  // The great site is never Ashfen: the start town stays one city-sized zone.
  if (wantMetro) {
    return [
      { cls: 'metropolis', want: Biome.Sand, id: 'saltgate', name: 'Saltgate', seed: 1103 },
      { cls: 'city', want: Biome.Plains, id: 'ashfen', name: 'Ashfen', seed: 1101 },
      { cls: 'city', want: Biome.Meadow, id: 'goldmere', name: 'Goldmere', seed: 1105 },
    ];
  }
  if (wantCapital) {
    return [
      { cls: 'capital', want: Biome.Meadow, id: 'goldmere', name: 'Goldmere', seed: 1105 },
      { cls: 'city', want: Biome.Plains, id: 'ashfen', name: 'Ashfen', seed: 1101 },
      { cls: 'city', want: Biome.Sand, id: 'saltgate', name: 'Saltgate', seed: 1103 },
    ];
  }
  return [
    { cls: 'city', want: Biome.Plains, id: 'ashfen', name: 'Ashfen', seed: 1101 },
    { cls: 'city', want: Biome.Meadow, id: 'goldmere', name: 'Goldmere', seed: 1105 },
    { cls: 'city', want: Biome.Sand, id: 'saltgate', name: 'Saltgate', seed: 1103 },
  ];
}

function collectCandidates(ctx: Ctx): Candidate[] {
  const stride = Math.max(1, ctx.step * 2);
  const margin = 2 * ctx.step;
  const out: Candidate[] = [];
  for (let y = margin; y < ctx.h - margin; y += stride) {
    for (let x = margin; x < ctx.w - margin; x += stride) {
      const biome = biomeAt(ctx, x, y);
      if (biome === Biome.Water) continue;
      if (ctx.mainland && !ctx.mainland[x + y * ctx.w]) continue;
      const slope = slopeAt(ctx, x, y);
      out.push({
        x,
        y,
        biome,
        slope,
        coast: nearBiome(ctx, x, y, 2, (b) => b === Biome.Water),
        hill: nearBiome(
          ctx,
          x,
          y,
          3,
          (b) => b === Biome.Hills || b === Biome.Mountain || b === Biome.Heath,
        ),
      });
    }
  }
  return out;
}

function ensureClass(
  ctx: Ctx,
  candidates: readonly Candidate[],
  cls: SettlementClass,
  want: Biome,
): void {
  if (ctx.nodes.some((node) => node.settlementClass === cls && !node.satelliteOf)) return;
  placeClass(ctx, candidates, cls, want, null, false, true);
}

function placeClass(
  ctx: Ctx,
  candidates: readonly Candidate[],
  cls: SettlementClass,
  want: Biome,
  named: Anchor | null,
  nearRoad: boolean,
  loose = false,
): MapNode | null {
  const ranked = rank(ctx, candidates, cls, want, nearRoad, loose);
  const limit = loose ? 80 : cls === 'metropolis' || cls === 'capital' ? 48 : 36;
  for (let i = 0; i < ranked.length && i < limit; i++) {
    const site = ranked[i]!;
    if (!spacingOk(ctx, site.x + 0.5, site.y + 0.5, cls)) continue;
    const tiles = growCore(
      ctx,
      site.x + 0.5,
      site.y + 0.5,
      cls,
      named?.seed ?? ctx.seed + site.x * 13 + site.y,
    );
    if (!tiles) continue;
    if (!insideMargin(ctx, tiles, cls)) continue;
    const node = makeNode(ctx, cls, site, tiles, named);
    claim(ctx, node.tiles);
    ctx.nodes.push(node);
    ctx.names.add(node.name);
    return node;
  }
  // A metropolis that found no coast or flat shelf becomes a capital, then a city.
  if (cls === 'metropolis') return placeClass(ctx, candidates, 'capital', want, named, nearRoad);
  if (cls === 'capital' && named) return placeClass(ctx, candidates, 'city', want, named, nearRoad);
  return null;
}

function placeGrove(
  ctx: Ctx,
  candidates: readonly Candidate[],
  id: string,
  name: string,
  seed: number,
  want: Biome,
): void {
  const ranked = rank(ctx, candidates, 'hamlet', want, false);
  for (let i = 0; i < ranked.length && i < 20; i++) {
    const site = ranked[i]!;
    if (!spacingOk(ctx, site.x + 0.5, site.y + 0.5, 'hamlet')) continue;
    const tiles = growCore(ctx, site.x + 0.5, site.y + 0.5, 'hamlet', seed);
    if (!tiles || !insideMargin(ctx, tiles, 'hamlet')) continue;
    const bounds = boundsFromTiles(tiles);
    const node: MapNode = {
      id,
      name,
      origin: 'authored',
      kind: 'grove',
      biome: site.biome,
      cx: site.x + 0.5,
      cy: site.y + 0.5,
      radius: Math.max(1, (bounds.x1 - bounds.x0) / 2, (bounds.y1 - bounds.y0) / 2),
      seed,
      tiles,
      ...bounds,
    };
    claim(ctx, tiles);
    ctx.nodes.push(node);
    ctx.names.add(name);
    return;
  }
}

function rank(
  ctx: Ctx,
  candidates: readonly Candidate[],
  cls: SettlementClass,
  want: Biome,
  nearRoad: boolean,
  loose = false,
): Candidate[] {
  const inset = insetFine(ctx, cls) * (loose ? 0.62 : 1);
  const slopeMax = loose ? 8 : SLOPE_MAX[cls];
  const scored: Array<{ site: Candidate; score: number }> = [];
  for (const site of candidates) {
    if (site.slope > slopeMax) continue;
    if (site.x < inset || site.y < inset || site.x >= ctx.w - inset || site.y >= ctx.h - inset)
      continue;
    if (cls === 'metropolis' && !site.coast && !nearGate(ctx, site.x, site.y, 10)) continue;
    if (cls === 'metropolis' && site.slope > 0.55) continue;
    let score = (1 - Math.min(1, site.slope / Math.max(0.05, slopeMax))) * 1.5;
    if (site.biome === want) score += 0.85;
    else if (fallbackBiome(want, site.biome)) score += 0.35;
    if (site.coast)
      score += cls === 'metropolis' || cls === 'capital' || want === Biome.Sand ? 1.15 : 0.3;
    if (site.hill && (cls === 'city' || cls === 'capital' || cls === 'town')) score += 0.28;
    const road = roadAt(ctx, site.x, site.y);
    if (nearRoad && road < 3) score += (cls === 'town' ? 1.6 : 0.7) * (1 - road / 3);
    if (nearGate(ctx, site.x, site.y, 8))
      score += cls === 'city' || cls === 'capital' || cls === 'metropolis' ? 0.55 : 0.15;
    scored.push({ site, score });
  }
  scored.sort((a, b) => b.score - a.score || a.site.y - b.site.y || a.site.x - b.site.x);
  return scored.map((item) => item.site);
}

function fallbackBiome(want: Biome, got: Biome): boolean {
  if (want === Biome.Sand) return got === Biome.Plains || got === Biome.Meadow;
  if (want === Biome.Mountain)
    return got === Biome.Hills || got === Biome.Snow || got === Biome.Heath;
  if (want === Biome.Desert)
    return got === Biome.Sand || got === Biome.Heath || got === Biome.Plains;
  if (want === Biome.Meadow) return got === Biome.Plains || got === Biome.Hills;
  if (want === Biome.Forest) return got === Biome.Meadow || got === Biome.Plains;
  if (want === Biome.DarkForest) return got === Biome.Forest || got === Biome.Marsh;
  if (want === Biome.Jungle) return got === Biome.Forest || got === Biome.Marsh;
  return got === Biome.Plains || got === Biome.Meadow || got === Biome.Hills;
}

function growCore(
  ctx: Ctx,
  cx: number,
  cy: number,
  cls: SettlementClass,
  seed: number,
): Vec2[] | null {
  const q = ctx.q;
  const qx = Math.floor(cx / q);
  const qy = Math.floor(cy / q);
  const radiusQ = Math.max(0.55, (SPAN[cls] / 2) * (ctx.step / q));
  const reach = Math.ceil(radiusQ + 1.5);
  const cells: Array<{ x: number; y: number }> = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const angle = Math.atan2(dy, dx);
      const n = fbm(Math.cos(angle) * 1.6 + 3, Math.sin(angle) * 1.6 + 3, seed + 17, 3);
      const limit = radiusQ * (0.78 + 0.4 * n);
      const dist = Math.hypot(dx, dy);
      if (dist > limit && !(dx === 0 && dy === 0)) continue;
      const cell = { x: qx + dx, y: qy + dy };
      if (!quadrantOk(ctx, cell.x, cell.y, cls)) continue;
      cells.push(cell);
    }
  }
  if (!cells.length) return null;
  const opened =
    cls === 'town' || cls === 'city' || cls === 'capital' || cls === 'metropolis'
      ? openQuadrants(cells)
      : cells;
  const kept = opened.length ? opened : cells;
  const expectQ = Math.max(1, Math.floor(radiusQ * radiusQ * 0.9));
  if (kept.length < expectQ && (cls === 'city' || cls === 'capital' || cls === 'metropolis'))
    return null;
  const fine = quadrantsToFine(ctx, kept);
  return fine.length ? fine : null;
}

function openQuadrants(
  cells: readonly { x: number; y: number }[],
): Array<{ x: number; y: number }> {
  const set = new Set(cells.map((cell) => quadKey(cell.x, cell.y)));
  const thick = cells.filter((cell) => {
    return (
      (set.has(quadKey(cell.x + 1, cell.y)) &&
        set.has(quadKey(cell.x, cell.y + 1)) &&
        set.has(quadKey(cell.x + 1, cell.y + 1))) ||
      (set.has(quadKey(cell.x - 1, cell.y)) &&
        set.has(quadKey(cell.x, cell.y - 1)) &&
        set.has(quadKey(cell.x - 1, cell.y - 1)))
    );
  });
  return thick.length >= 4 ? thick : cells.slice();
}

function growOutskirts(ctx: Ctx, node: MapNode, cls: SettlementClass): void {
  const q = ctx.q;
  const core = new Set<number>();
  for (const tile of node.tiles) core.add(quadKey(Math.floor(tile.x / q), Math.floor(tile.y / q)));
  const ringQ = Math.max(1, Math.round((RING[cls] * ctx.step) / q));
  const box = boundsOfKeys(core);
  const extra: Array<{ x: number; y: number }> = [];
  for (let y = box.y0 - ringQ; y <= box.y1 + ringQ; y++) {
    for (let x = box.x0 - ringQ; x <= box.x1 + ringQ; x++) {
      const key = quadKey(x, y);
      if (core.has(key)) continue;
      let nearest = Infinity;
      for (const have of core) {
        const hx = Math.floor(have / 8192) - 4096;
        const hy = (have % 8192) - 4096;
        nearest = Math.min(nearest, Math.hypot(hx - x, hy - y));
        if (nearest <= ringQ) break;
      }
      if (nearest > ringQ) continue;
      if (!quadrantOk(ctx, x, y, cls)) continue;
      const angle = Math.atan2(y - (box.y0 + box.y1) / 2, x - (box.x0 + box.x1) / 2);
      const lobe = Math.pow(Math.abs(Math.cos(angle * 2)), 0.65);
      const noise = hash2(x, y, ctx.seed + node.seed);
      const hamletCap = cls === 'hamlet' && extra.length >= 2;
      if (hamletCap) continue;
      if (cls !== 'hamlet' && noise > 0.42 + lobe * 0.48) continue;
      extra.push({ x, y });
    }
  }
  if (!extra.length) return;
  const tiles = quadrantsToFine(ctx, extra);
  if (!tiles.length || !insideMargin(ctx, tiles, cls)) return;
  node.outskirts = tiles;
  node.landUse = biomeRow(node.biome).use;
  claim(ctx, tiles);
}

function placeSatellites(
  ctx: Ctx,
  candidates: readonly Candidate[],
  parent: MapNode,
  cls: SettlementClass,
): void {
  const spec = SAT[cls];
  if (
    spec.hamlets[1] === 0 &&
    spec.villages[1] === 0 &&
    spec.industry[1] === 0 &&
    spec.town[1] === 0
  ) {
    return;
  }
  const slots: Array<{ cls: SettlementClass; slot: 'hamlet' | 'village' | 'industry' | 'town' }> =
    [];
  pushSlots(slots, 'town', 'town', ctx.rng.int(spec.town[0], spec.town[1]));
  pushSlots(slots, 'hamlet', 'industry', ctx.rng.int(spec.industry[0], spec.industry[1]));
  pushSlots(slots, 'village', 'village', ctx.rng.int(spec.villages[0], spec.villages[1]));
  pushSlots(slots, 'hamlet', 'hamlet', ctx.rng.int(spec.hamlets[0], spec.hamlets[1]));
  const rays = 8;
  let index = 0;
  for (const slot of slots) {
    const distMin = slot.slot === 'town' ? spec.townDist[0] : spec.dist[0];
    const distMax = slot.slot === 'town' ? spec.townDist[1] : spec.dist[1];
    let placed = false;
    for (let ray = 0; ray < rays && !placed; ray++) {
      const angle = (ray / rays) * Math.PI * 2 + hash2(parent.seed, index, ray) * 0.4;
      for (let dist = distMin; dist <= distMax + 0.01 && !placed; dist += 0.8) {
        const reach = parent.radius / ctx.step + dist;
        const x = Math.round(parent.cx + Math.cos(angle) * reach * ctx.step);
        const y = Math.round(parent.cy + Math.sin(angle) * reach * ctx.step);
        const site = nearestCandidate(candidates, x, y, ctx.step * 1.4);
        if (!site) continue;
        if (!spacingOk(ctx, site.x + 0.5, site.y + 0.5, slot.cls)) continue;
        if (!satelliteClear(ctx, parent, site.x + 0.5, site.y + 0.5, slot.cls)) continue;
        const role = roleFor(site, slot.slot);
        if (!roleOk(ctx, site, role)) continue;
        const tiles = growCore(
          ctx,
          site.x + 0.5,
          site.y + 0.5,
          slot.cls,
          parent.seed + index * 17 + ray,
        );
        if (!tiles || !insideMargin(ctx, tiles, slot.cls)) continue;
        if (!insideMargin(ctx, tiles, cls)) continue;
        const node = makeNode(ctx, slot.cls, site, tiles, null);
        node.satelliteOf = parent.id;
        node.satelliteRole = role;
        node.id = `sat-${parent.id}-${index}`;
        if (!satelliteFits(ctx, parent, node)) continue;
        claim(ctx, node.tiles);
        ctx.nodes.push(node);
        ctx.names.add(node.name);
        ctx.stampRoad(
          Math.floor(parent.cx),
          Math.floor(parent.cy),
          Math.floor(node.cx),
          Math.floor(node.cy),
          new Rng((parent.seed ^ (index * 97 + 3)) >>> 0 || 1),
        );
        placed = true;
        index++;
      }
    }
  }
}

function pushSlots(
  slots: Array<{ cls: SettlementClass; slot: 'hamlet' | 'village' | 'industry' | 'town' }>,
  cls: SettlementClass,
  slot: 'hamlet' | 'village' | 'industry' | 'town',
  count: number,
): void {
  for (let i = 0; i < count; i++) slots.push({ cls, slot });
}

function roleFor(site: Candidate, slot: 'hamlet' | 'village' | 'industry' | 'town'): string {
  if (slot === 'town') return 'market town';
  return biomeRow(site.biome)[slot];
}

function roleOk(ctx: Ctx, site: Candidate, role: string): boolean {
  if (role.includes('fishing'))
    return site.coast || nearBiome(ctx, site.x, site.y, 2, (b) => b === Biome.Water);
  if (role.includes('mining') || role.includes('quarry')) {
    return (
      site.hill ||
      site.biome === Biome.Hills ||
      site.biome === Biome.Mountain ||
      site.biome === Biome.Heath ||
      site.biome === Biome.Ashlands
    );
  }
  return true;
}

function nearestCandidate(
  candidates: readonly Candidate[],
  x: number,
  y: number,
  reach: number,
): Candidate | null {
  let best: Candidate | null = null;
  let bestD = reach * reach;
  for (const site of candidates) {
    const d = (site.x - x) ** 2 + (site.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = site;
    }
  }
  return best;
}

function approxRadius(ctx: Ctx, cls: SettlementClass): number {
  return Math.max(ctx.q, (SPAN[cls] * ctx.step) / 2);
}

function edgeGap(
  ctx: Ctx,
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): number {
  return (Math.hypot(ax - bx, ay - by) - ar - br) / ctx.step;
}

function satelliteClear(
  ctx: Ctx,
  parent: MapNode,
  x: number,
  y: number,
  cls: SettlementClass,
): boolean {
  const radius = approxRadius(ctx, cls);
  if (edgeGap(ctx, x, y, radius, parent.cx, parent.cy, parent.radius) < 1) return false;
  for (const node of ctx.nodes) {
    if (node.id === parent.id) continue;
    const gap = edgeGap(ctx, x, y, radius, node.cx, node.cy, node.radius);
    if (node.satelliteOf === parent.id && gap < 1.2) return false;
    if (!node.satelliteOf && node.settlementClass && gap < 1) return false;
  }
  return true;
}

function satelliteFits(ctx: Ctx, parent: MapNode, node: MapNode): boolean {
  if (edgeGap(ctx, node.cx, node.cy, node.radius, parent.cx, parent.cy, parent.radius) < 1)
    return false;
  for (const other of ctx.nodes) {
    if (other.satelliteOf !== parent.id) continue;
    if (edgeGap(ctx, node.cx, node.cy, node.radius, other.cx, other.cy, other.radius) < 1.15)
      return false;
  }
  return true;
}

function makeNode(
  ctx: Ctx,
  cls: SettlementClass,
  site: Candidate,
  tiles: Vec2[],
  named: Anchor | null,
): MapNode {
  const fitted =
    cls === 'capital' || cls === 'metropolis' ? tiles : clipToBox(tiles, SINGLE_ZONE_BOX);
  const bounds = boundsFromTiles(fitted);
  const kind = named?.kind ?? kindFor(cls);
  const id = named?.id ?? `${cls}-${ctx.nodes.length}`;
  const name = named?.name ?? generatedName(ctx.rng, ctx.names, kind);
  return {
    id,
    name,
    origin: named ? 'authored' : 'generated',
    kind,
    settlementClass: kind === 'camp' ? undefined : cls,
    biome: site.biome,
    cx: site.x + 0.5,
    cy: site.y + 0.5,
    radius: Math.max(ctx.q, (bounds.x1 - bounds.x0) / 2, (bounds.y1 - bounds.y0) / 2),
    seed: named?.seed ?? (ctx.seed ^ (site.x * 19 + site.y * 131)) >>> 0,
    tiles: fitted,
    ...bounds,
  };
}

function clipToBox(tiles: readonly Vec2[], span: number): Vec2[] {
  if (!tiles.length) return [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const tile of tiles) {
    if (tile.x < x0) x0 = tile.x;
    if (tile.y < y0) y0 = tile.y;
    if (tile.x > x1) x1 = tile.x;
    if (tile.y > y1) y1 = tile.y;
  }
  if (x1 - x0 < span && y1 - y0 < span) return tiles.slice();
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const half = span / 2;
  return tiles.filter((tile) => Math.abs(tile.x - cx) <= half && Math.abs(tile.y - cy) <= half);
}

function kindFor(cls: SettlementClass): NodeKind {
  if (cls === 'hamlet') return 'hamlet';
  if (cls === 'village') return 'village';
  if (cls === 'town') return 'town';
  return 'city';
}

function linkRing(ctx: Ctx, nodes: readonly MapNode[]): void {
  if (nodes.length < 2) return;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    const b = nodes[(i + 1) % nodes.length]!;
    ctx.stampRoad(
      Math.floor(a.cx),
      Math.floor(a.cy),
      Math.floor(b.cx),
      Math.floor(b.cy),
      new Rng((ctx.seed ^ (i * 4099 + 11)) >>> 0 || 1),
    );
  }
}

/** Cities stay 12 apart. A town may sit 6 from a city, so it can stand on the road between them. */
function pairGap(a: SettlementClass, b: SettlementClass): number {
  const cityish = (cls: SettlementClass) =>
    cls === 'city' || cls === 'capital' || cls === 'metropolis';
  if (cityish(a) && cityish(b)) return Math.max(GAP[a], GAP[b]);
  return Math.min(GAP[a], GAP[b]);
}

function spacingOk(ctx: Ctx, x: number, y: number, cls: SettlementClass): boolean {
  const step = ctx.step;
  for (const node of ctx.nodes) {
    const other = node.settlementClass;
    if (!other || node.satelliteOf) continue;
    const need = pairGap(cls, other);
    const d = Math.hypot(x - node.cx, y - node.cy) / step;
    if (d < need) return false;
  }
  return true;
}

function insideMargin(ctx: Ctx, tiles: readonly Vec2[], cls: SettlementClass): boolean {
  const margin = SIZE_CLASS[cls].chunkEdgeMargin * ctx.step;
  const x1 = ctx.w - margin;
  const y1 = ctx.h - margin;
  for (const tile of tiles) {
    if (tile.x < margin || tile.y < margin || tile.x >= x1 || tile.y >= y1) return false;
  }
  return true;
}

function insetFine(ctx: Ctx, cls: SettlementClass): number {
  const margin = SIZE_CLASS[cls].chunkEdgeMargin * ctx.step;
  const reach = (SPAN[cls] / 2 + RING[cls] * 0.35) * ctx.step;
  return margin + reach;
}

function quadrantOk(ctx: Ctx, qx: number, qy: number, cls: SettlementClass): boolean {
  const q = ctx.q;
  const margin = SIZE_CLASS[cls].chunkEdgeMargin * ctx.step;
  const x0 = qx * q;
  const y0 = qy * q;
  if (x0 < margin || y0 < margin || x0 + q > ctx.w - margin || y0 + q > ctx.h - margin)
    return false;
  const key = quadKey(qx, qy);
  if (ctx.blocked.has(key)) return false;
  const cx = Math.min(ctx.w - 1, x0 + (q >> 1));
  const cy = Math.min(ctx.h - 1, y0 + (q >> 1));
  const biome = biomeAt(ctx, cx, cy);
  if (biome === Biome.Water) return false;
  if (ctx.mainland && !ctx.mainland[cx + cy * ctx.w]) return false;
  return true;
}

function quadrantsToFine(ctx: Ctx, cells: readonly { x: number; y: number }[]): Vec2[] {
  const q = ctx.q;
  const tiles: Vec2[] = [];
  const ordered = cells.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  for (const cell of ordered) {
    const x0 = cell.x * q;
    const y0 = cell.y * q;
    for (let y = 0; y < q; y++) {
      for (let x = 0; x < q; x++) {
        const tx = x0 + x;
        const ty = y0 + y;
        if (tx < 0 || ty < 0 || tx >= ctx.w || ty >= ctx.h) continue;
        tiles.push({ x: tx, y: ty });
      }
    }
  }
  return tiles;
}

function claim(ctx: Ctx, tiles: readonly Vec2[]): void {
  const q = ctx.q;
  for (const tile of tiles)
    ctx.blocked.add(quadKey(Math.floor(tile.x / q), Math.floor(tile.y / q)));
}

function quadKey(x: number, y: number): number {
  return (x + 4096) * 8192 + (y + 4096);
}

function boundsOfKeys(keys: Set<number>): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const key of keys) {
    const x = Math.floor(key / 8192) - 4096;
    const y = (key % 8192) - 4096;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function biomeAt(ctx: Ctx, x: number, y: number): Biome {
  if (x < 0 || y < 0 || x >= ctx.w || y >= ctx.h) return Biome.Water;
  return ctx.biomes[x + y * ctx.w] as Biome;
}

function heightAt(ctx: Ctx, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= ctx.w || y >= ctx.h) return 0;
  return ctx.heightM[x + y * ctx.w] ?? 0;
}

function slopeAt(ctx: Ctx, x: number, y: number): number {
  const h0 = heightAt(ctx, x, y);
  // A display tile on a 1× map is one fine tile, too short to judge a hillside.
  const d = Math.max(4, ctx.step);
  let max = 0;
  for (const [dx, dy] of CARDINAL) {
    const rise = Math.abs(heightAt(ctx, x + dx * d, y + dy * d) - h0);
    max = Math.max(max, rise / (d * 8));
  }
  return max;
}

function nearBiome(
  ctx: Ctx,
  x: number,
  y: number,
  tiles: number,
  pred: (biome: Biome) => boolean,
): boolean {
  const dist = tiles * ctx.step;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const sx = Math.round(x + Math.cos(angle) * dist);
    const sy = Math.round(y + Math.sin(angle) * dist);
    if (pred(biomeAt(ctx, sx, sy))) return true;
  }
  return pred(biomeAt(ctx, x, y));
}

function nearGate(ctx: Ctx, x: number, y: number, tiles: number): boolean {
  const reach = tiles * ctx.step;
  for (const gate of ctx.gates) {
    if (Math.hypot(gate.x - x, gate.y - y) <= reach) return true;
  }
  return false;
}

function roadDistance(ctx: Ctx): Float32Array {
  const step = ctx.step;
  const gw = ctx.gw;
  const gh = Math.max(1, Math.ceil(ctx.h / step));
  const dist = new Float32Array(gw * gh);
  dist.fill(255);
  const qx: number[] = [];
  const qy: number[] = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!cellHasRoad(ctx, x, y, step)) continue;
      dist[y * gw + x] = 0;
      qx.push(x);
      qy.push(y);
    }
  }
  for (let i = 0; i < qx.length; i++) {
    const x = qx[i]!;
    const y = qy[i]!;
    const base = dist[y * gw + x]!;
    if (base >= 254) continue;
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const next = base + 1;
      if (dist[ny * gw + nx]! <= next) continue;
      dist[ny * gw + nx] = next;
      qx.push(nx);
      qy.push(ny);
    }
  }
  return dist;
}

function cellHasRoad(ctx: Ctx, gx: number, gy: number, step: number): boolean {
  const x0 = gx * step;
  const y0 = gy * step;
  const x1 = Math.min(ctx.w, x0 + step);
  const y1 = Math.min(ctx.h, y0 + step);
  const paths = ctx.paths;
  for (let y = y0; y < y1; y++) {
    const row = y * ctx.w;
    for (let x = x0; x < x1; x++) if (paths[row + x]) return true;
  }
  return false;
}

function roadAt(ctx: Ctx, x: number, y: number): number {
  const field = ctx.roads;
  if (!field) return 99;
  const gx = Math.max(0, Math.min(ctx.gw - 1, Math.floor(x / ctx.step)));
  const gy = Math.max(0, Math.min(Math.ceil(ctx.h / ctx.step) - 1, Math.floor(y / ctx.step)));
  return field[gy * ctx.gw + gx] ?? 99;
}
