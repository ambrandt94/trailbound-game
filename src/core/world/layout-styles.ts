/**
 * Culture layout styles. A style says how a settlement is arranged. It does
 * not choose materials. That is the biome building set.
 */
import type { BuildingRole, RoleDemand } from './building-roles';
import type { CultureId } from './culture';
import type { SettlementClass } from './city-plan';

export type { CultureId };

export type StreetPattern =
  | { kind: 'organic'; branchAngleDeg: [number, number]; curviness: number; laneDensity: number }
  | { kind: 'radial'; rings: number; spokes: [number, number]; ringJitter: number }
  | { kind: 'gridish'; angleDeg: number | 'terrain'; warp: number };

export interface LotRule {
  frontage: [number, number];
  depth: [number, number];
  setback: [number, number];
  /** Face the street edge, the camp centre, or a jittered heading. */
  facing: 'street' | 'centre' | 'free';
  yawJitterDeg: number;
  clustering: 'row' | 'detached' | 'ring' | 'cluster';
}

export interface DistrictKind {
  id: string;
  roles: Array<{ role: BuildingRole; w: number }>;
  seedAt: 'centre' | 'main_gate' | 'gates' | 'water' | 'high_ground' | 'edge';
}

export interface DefenceRule {
  kind: 'none' | 'hedge' | 'palisade' | 'spiked_palisade' | 'curtain';
  towers: 'none' | 'corners' | 'gates' | 'every_n';
  gates: [number, number];
}

export interface LayoutStyle {
  id: CultureId;
  label: string;
  implemented: boolean;
  stubOf?: CultureId;
  streets: StreetPattern;
  centre: 'plaza' | 'green' | 'fire_ring' | 'great_hall' | 'none';
  defence: Partial<Record<SettlementClass, DefenceRule>>;
  lots: LotRule;
  districts: DistrictKind[];
  /** `null` drops the role. A role renames it. */
  roleRewrite: Partial<Record<BuildingRole, BuildingRole | null>>;
  extraDemand: RoleDemand[];
  roleLabels: Partial<Record<BuildingRole, string>>;
  /** Building size multiplier. Mouse towns stay small. */
  scale: number;
  verticality: 'ground' | 'stacked';
  /** Culture's share of street curviness, before the biome blend. */
  curviness: number;
}

const HUMAN_DISTRICTS: DistrictKind[] = [
  {
    id: 'market',
    seedAt: 'centre',
    roles: [
      { role: 'market', w: 4 },
      { role: 'shop', w: 3 },
      { role: 'inn', w: 3 },
      { role: 'bakery', w: 2 },
    ],
  },
  {
    id: 'civic',
    seedAt: 'high_ground',
    roles: [
      { role: 'town_hall', w: 4 },
      { role: 'temple', w: 3 },
      { role: 'guildhall', w: 2 },
      { role: 'bank', w: 2 },
      { role: 'healer', w: 2 },
    ],
  },
  {
    id: 'craft',
    seedAt: 'gates',
    roles: [
      { role: 'smithy', w: 3 },
      { role: 'workshop', w: 3 },
      { role: 'stables', w: 2 },
      { role: 'wagonwright', w: 2 },
      { role: 'warehouse', w: 1 },
    ],
  },
  {
    id: 'residential',
    seedAt: 'edge',
    roles: [
      { role: 'home', w: 6 },
      { role: 'manor', w: 1 },
      { role: 'farmstead', w: 1 },
    ],
  },
];

const ORC_DISTRICTS: DistrictKind[] = [
  {
    id: 'hall',
    seedAt: 'centre',
    roles: [
      { role: 'town_hall', w: 4 },
      { role: 'arena', w: 3 },
      { role: 'shrine', w: 2 },
    ],
  },
  {
    id: 'garrison',
    seedAt: 'gates',
    roles: [
      { role: 'barracks', w: 4 },
      { role: 'guard_post', w: 3 },
      { role: 'smithy', w: 2 },
      { role: 'watchtower', w: 1 },
    ],
  },
  {
    id: 'camp',
    seedAt: 'edge',
    roles: [
      { role: 'home', w: 5 },
      { role: 'workshop', w: 1 },
      { role: 'stables', w: 1 },
    ],
  },
];

const hedge: DefenceRule = { kind: 'hedge', towers: 'none', gates: [1, 2] };
const palisade: DefenceRule = { kind: 'palisade', towers: 'gates', gates: [2, 3] };
const curtain: DefenceRule = { kind: 'curtain', towers: 'gates', gates: [2, 4] };
const spiked: DefenceRule = { kind: 'spiked_palisade', towers: 'gates', gates: [2, 4] };

export const LAYOUT_STYLES: Record<string, LayoutStyle> = {
  human: {
    id: 'human',
    label: 'Human',
    implemented: true,
    streets: { kind: 'organic', branchAngleDeg: [60, 110], curviness: 0.32, laneDensity: 0.7 },
    centre: 'plaza',
    defence: { hamlet: hedge, village: hedge, town: palisade, city: curtain },
    lots: {
      frontage: [7, 12],
      depth: [8, 12],
      setback: [1.5, 3],
      facing: 'street',
      yawJitterDeg: 8,
      clustering: 'detached',
    },
    districts: HUMAN_DISTRICTS,
    roleRewrite: {},
    extraDemand: [],
    roleLabels: {},
    scale: 1,
    verticality: 'ground',
    curviness: 0.32,
  },
  orc: {
    id: 'orc',
    label: 'Orc war camp',
    implemented: true,
    streets: { kind: 'radial', rings: 2, spokes: [3, 6], ringJitter: 0.14 },
    centre: 'fire_ring',
    defence: {
      village: spiked,
      town: spiked,
      city: spiked,
    },
    lots: {
      frontage: [6, 10],
      depth: [6, 10],
      setback: [1, 2.2],
      facing: 'centre',
      yawJitterDeg: 12,
      clustering: 'ring',
    },
    districts: ORC_DISTRICTS,
    roleRewrite: {
      bank: null,
      bakery: null,
      guildhall: null,
      temple: 'shrine',
      manor: 'home',
    },
    extraDemand: [
      { role: 'barracks', count: 2, minBuildings: 8 },
      { role: 'arena', count: 1, minBuildings: 10 },
    ],
    roleLabels: {
      barracks: 'War tent',
      town_hall: "Chief's hall",
      shrine: 'Totem',
      arena: 'Fighting pit',
      guard_post: 'Watch',
      home: 'Tent',
    },
    scale: 1,
    verticality: 'ground',
    curviness: 0.72,
  },
  mouse: {
    id: 'mouse',
    label: 'Mouse',
    implemented: false,
    stubOf: 'human',
    streets: { kind: 'organic', branchAngleDeg: [50, 120], curviness: 0.8, laneDensity: 1 },
    centre: 'green',
    defence: { hamlet: hedge, village: hedge },
    lots: {
      frontage: [4, 6],
      depth: [4, 6],
      setback: [0.4, 1],
      facing: 'street',
      yawJitterDeg: 16,
      clustering: 'cluster',
    },
    districts: HUMAN_DISTRICTS,
    roleRewrite: {},
    extraDemand: [],
    roleLabels: { home: 'Burrow' },
    scale: 0.4,
    verticality: 'stacked',
    curviness: 0.85,
  },
};

export function resolveLayoutStyle(id: string): {
  style: LayoutStyle;
  stubbed: boolean;
  requested: string;
} {
  const raw = LAYOUT_STYLES[id] ?? LAYOUT_STYLES.human!;
  if (!raw.implemented && raw.stubOf) {
    const base = LAYOUT_STYLES[raw.stubOf] ?? LAYOUT_STYLES.human!;
    return { style: base, stubbed: true, requested: raw.id };
  }
  return { style: raw, stubbed: false, requested: raw.id };
}
