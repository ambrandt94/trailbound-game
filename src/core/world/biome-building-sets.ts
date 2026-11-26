/**
 * Biome building sets. A set says what a role is built as. It does not choose
 * the street plan. Culture can override a form through `formsByCulture`.
 */
import type { BuildingRole } from './building-roles';
import { ROLE_STYLE } from './building-roles';
import type { CultureId } from './culture';
import { Biome, type Biome as BiomeId } from './models';
import type { LayoutStyle } from './layout-styles';

export type BiomeSetId =
  | 'temperate'
  | 'coastal'
  | 'arid'
  | 'alpine'
  | 'tropical'
  | 'wetland'
  | 'volcanic'
  | 'deep_forest'
  | 'grassland'
  | 'snow'
  | 'sea_shack';

export type BuildingFormKind =
  | 'house'
  | 'hut'
  | 'tent'
  | 'yurt'
  | 'teepee'
  | 'cabin'
  | 'igloo'
  | 'stilt'
  | 'longhouse'
  | 'block';

export interface BuildingForm {
  form: BuildingFormKind;
  /** Kit id or a `{style}` pattern. */
  kit: string;
  materials: { wall: string; roof: string; trim?: string };
  placeholder?: boolean;
}

export interface BiomeBuildingSet {
  id: BiomeSetId;
  implemented: boolean;
  stubOf?: BiomeSetId;
  kitSuffix: string;
  forms: Partial<Record<BuildingRole, BuildingForm>>;
  formsByCulture?: Partial<Record<CultureId, Partial<Record<BuildingRole, BuildingForm>>>>;
  fallback: BuildingForm;
  site: { stilts?: boolean; huddle?: number; roofPitch?: 'flat' | 'low' | 'steep' };
}

export interface ResolvedBuilding {
  role: BuildingRole;
  label: string;
  form: BuildingForm;
  scale: number;
  placeholder: boolean;
  kitId: string;
}

/** Catalog id for each role. Roles without their own kit use the nearest one. */
export const ROLE_KIT: Record<BuildingRole, string> = {
  home: 'cottage',
  manor: 'manor',
  market: 'market_stall',
  shop: 'general_store',
  inn: 'tavern',
  bakery: 'bakery',
  warehouse: 'barn',
  smithy: 'smithy',
  workshop: 'carpenter',
  stables: 'stables',
  wagonwright: 'wagonwright',
  barn: 'barn',
  farmstead: 'barn',
  dock: 'market_stall',
  temple: 'temple',
  shrine: 'temple_small',
  healer: 'healer',
  town_hall: 'town_hall',
  guildhall: 'guildhall',
  bank: 'bank',
  barracks: 'townhouse',
  guard_post: 'hovel',
  watchtower: 'hovel',
  gatehouse: 'town_hall',
  keep: 'manor',
  arena: 'market_stall',
  unassigned: 'hovel',
};

const PLACEHOLDER_ROLES = new Set<BuildingRole>([
  'barracks',
  'guard_post',
  'watchtower',
  'gatehouse',
  'arena',
  'warehouse',
  'dock',
  'farmstead',
  'unassigned',
]);

function house(kitId: string, placeholder = false): BuildingForm {
  return {
    form: placeholder ? 'block' : 'house',
    kit: kitId,
    materials: { wall: '#cbb892', roof: '#8d4b3a' },
    ...(placeholder ? { placeholder: true } : {}),
  };
}

function temperateForms(): Partial<Record<BuildingRole, BuildingForm>> {
  const forms: Partial<Record<BuildingRole, BuildingForm>> = {};
  for (const role of Object.keys(ROLE_KIT) as BuildingRole[]) {
    forms[role] = house(ROLE_KIT[role], PLACEHOLDER_ROLES.has(role) || role === 'unassigned');
  }
  return forms;
}

const CABIN: BuildingForm = {
  form: 'cabin',
  kit: 'cottage',
  materials: { wall: '#8d5a32', roof: '#6b3e24', trim: '#c4a574' },
  placeholder: true,
};

const LONG_CABIN: BuildingForm = {
  form: 'longhouse',
  kit: 'town_hall',
  materials: { wall: '#7a4e2c', roof: '#5c3a22', trim: '#d7c4a1' },
  placeholder: true,
};

const YURT: BuildingForm = {
  form: 'yurt',
  kit: 'tent',
  materials: { wall: '#e6d2a8', roof: '#b5523a', trim: '#8d5a32' },
  placeholder: true,
};

const TEEPEE: BuildingForm = {
  form: 'teepee',
  kit: 'tent',
  materials: { wall: '#f0e2c4', roof: '#a5683c', trim: '#6b4428' },
  placeholder: true,
};

const HIDE: BuildingForm = {
  form: 'tent',
  kit: 'tent',
  materials: { wall: '#c4a574', roof: '#8d5a32', trim: '#6b3e24' },
  placeholder: true,
};

function orcTents(): Partial<Record<BuildingRole, BuildingForm>> {
  return {
    home: HIDE,
    manor: HIDE,
    barracks: HIDE,
    guard_post: HIDE,
    shrine: { ...HIDE, form: 'tent', kit: 'temple_small' },
    arena: { ...HIDE, form: 'tent', kit: 'market_stall' },
    town_hall: { ...HIDE, form: 'longhouse', kit: 'town_hall' },
  };
}

function thin(id: BiomeSetId, suffix: string, pitch: 'flat' | 'low' | 'steep'): BiomeBuildingSet {
  return {
    id,
    implemented: true,
    kitSuffix: suffix,
    forms: {},
    formsByCulture: { orc: orcTents() },
    fallback: house('cottage'),
    site: { roofPitch: pitch },
  };
}

const forestForms = (): Partial<Record<BuildingRole, BuildingForm>> => {
  const forms: Partial<Record<BuildingRole, BuildingForm>> = {};
  for (const role of Object.keys(ROLE_KIT) as BuildingRole[]) forms[role] = CABIN;
  forms.town_hall = LONG_CABIN;
  forms.temple = LONG_CABIN;
  forms.guildhall = LONG_CABIN;
  forms.keep = LONG_CABIN;
  forms.unassigned = { ...CABIN, form: 'block', materials: { wall: '#b7b2a6', roof: '#8e8a80' } };
  return forms;
};

export const BIOME_BUILDING_SETS: Record<string, BiomeBuildingSet> = {
  temperate: {
    id: 'temperate',
    implemented: true,
    kitSuffix: 'temperate',
    forms: temperateForms(),
    formsByCulture: { orc: orcTents() },
    fallback: house('cottage'),
    site: { roofPitch: 'low' },
  },
  deep_forest: {
    id: 'deep_forest',
    implemented: true,
    kitSuffix: 'temperate',
    forms: forestForms(),
    fallback: CABIN,
    site: { roofPitch: 'steep', huddle: 0.4 },
  },
  grassland: {
    id: 'grassland',
    implemented: true,
    kitSuffix: 'arid',
    forms: {
      home: YURT,
      manor: YURT,
      farmstead: TEEPEE,
      barn: TEEPEE,
      barracks: TEEPEE,
      shrine: TEEPEE,
      unassigned: { ...YURT, form: 'block', materials: { wall: '#b7b2a6', roof: '#8e8a80' } },
    },
    fallback: YURT,
    site: { roofPitch: 'low' },
  },
  coastal: thin('coastal', 'coastal', 'low'),
  arid: thin('arid', 'arid', 'flat'),
  alpine: thin('alpine', 'alpine', 'steep'),
  tropical: thin('tropical', 'tropical', 'low'),
  wetland: { ...thin('wetland', 'wetland', 'low'), site: { stilts: true, roofPitch: 'low' } },
  volcanic: thin('volcanic', 'alpine', 'low'),
  snow: {
    id: 'snow',
    implemented: false,
    stubOf: 'alpine',
    kitSuffix: 'alpine',
    forms: {
      home: {
        form: 'igloo',
        kit: 'cottage',
        materials: { wall: '#e7eef2', roof: '#d5e0e6' },
        placeholder: true,
      },
    },
    fallback: {
      form: 'igloo',
      kit: 'cottage',
      materials: { wall: '#e7eef2', roof: '#d5e0e6' },
      placeholder: true,
    },
    site: { roofPitch: 'low' },
  },
  sea_shack: {
    id: 'sea_shack',
    implemented: false,
    stubOf: 'coastal',
    kitSuffix: 'coastal',
    forms: {
      home: {
        form: 'stilt',
        kit: 'hovel',
        materials: { wall: '#c4a574', roof: '#8d5a32' },
        placeholder: true,
      },
    },
    fallback: {
      form: 'stilt',
      kit: 'hovel',
      materials: { wall: '#c4a574', roof: '#8d5a32' },
      placeholder: true,
    },
    site: { stilts: true, roofPitch: 'low' },
  },
};

/** Biome → building set. Snow and sea shacks stay registered for later art. */
export function biomeSetFor(biome: BiomeId): BiomeSetId {
  switch (biome) {
    case Biome.Plains:
    case Biome.Meadow:
      return 'grassland';
    case Biome.Forest:
    case Biome.DarkForest:
    case Biome.Taiga:
      return 'deep_forest';
    case Biome.Water:
    case Biome.Sand:
      return 'coastal';
    case Biome.Desert:
    case Biome.Badlands:
      return 'arid';
    case Biome.Marsh:
      return 'wetland';
    case Biome.Mountain:
    case Biome.Snow:
      return 'alpine';
    case Biome.Jungle:
      return 'tropical';
    case Biome.Ashlands:
      return 'volcanic';
    default:
      return 'temperate';
  }
}

export function resolveBiomeSet(id: string): { set: BiomeBuildingSet; stubbed: boolean } {
  const raw = BIOME_BUILDING_SETS[id] ?? BIOME_BUILDING_SETS.temperate!;
  if (!raw.implemented && raw.stubOf) {
    const base = BIOME_BUILDING_SETS[raw.stubOf] ?? BIOME_BUILDING_SETS.temperate!;
    return { set: base, stubbed: true };
  }
  return { set: raw, stubbed: false };
}

/**
 * How winding the streets are. Human towns on grassland stay gentle.
 * Rougher biomes and cultures bend the roads further.
 */
export function biomeCurviness(biome: BiomeId): number {
  switch (biome) {
    case Biome.Plains:
    case Biome.Meadow:
    case Biome.Sand:
      return 0.18;
    case Biome.Hills:
    case Biome.Desert:
      return 0.4;
    case Biome.Forest:
    case Biome.Taiga:
      return 0.58;
    case Biome.DarkForest:
    case Biome.Badlands:
    case Biome.Ashlands:
    case Biome.Marsh:
    case Biome.Mountain:
    case Biome.Jungle:
      return 0.82;
    default:
      return 0.45;
  }
}

export function blendCurviness(style: LayoutStyle, biome: BiomeId): number {
  const culture = style.curviness;
  const ground = biomeCurviness(biome);
  return Math.min(1, Math.max(0, culture * 0.62 + ground * 0.38));
}

export function resolveBuilding(
  role: BuildingRole,
  style: LayoutStyle,
  set: BiomeBuildingSet,
  salt = 0,
): ResolvedBuilding {
  let form = set.formsByCulture?.[style.id]?.[role] ?? set.forms[role];
  if (!form && Object.keys(set.forms).length === 0) {
    form = house(ROLE_KIT[role], PLACEHOLDER_ROLES.has(role));
  }
  form = form ?? set.fallback;
  if (set.id === 'grassland' && (role === 'home' || role === 'manor' || role === 'farmstead')) {
    form = salt % 2 === 0 ? YURT : TEEPEE;
  }
  const label = style.roleLabels[role] ?? ROLE_STYLE[role].label;
  return {
    role,
    label,
    form,
    scale: style.scale,
    placeholder: !!form.placeholder || role === 'unassigned',
    kitId: form.kit,
  };
}
