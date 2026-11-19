/**
 * Biome recipes for the sky strip's terrain. Pure data and lookups, no DOM.
 *
 * The strip is drawn back to front:
 *   1. the sky gradient, sun and moon (unchanged);
 *   2. optional `behind` details, such as the sea band of a coast;
 *   3. one BASE ground mask: a tileable horizontal silhouette in gray;
 *   4. zero or more DETAIL overlays (trees, rocks, snowcaps...), tileable and tintable.
 * Every mask is a slot in `manifest.json` (see `BASE_SLOTS` and `detailSlot`). A
 * recipe only names slots and colours, so a new biome is a few lines here.
 *
 * Tints are written for full noon light. The renderer multiplies them by the
 * light of the hour (`groundLight` in `core/sim/day-cycle.ts`), so dawn, noon,
 * dusk and night still read. The `default` recipe is the original hills strip,
 * tinted by the sky's own ground colour, and is what unknown biomes get.
 */

export type BaseId = 'hills' | 'flatland' | 'grass' | 'mountains' | 'coastline' | 'dunes';

export type DetailId =
  'pine' | 'broadleaf' | 'scrub' | 'rocks' | 'snowcaps' | 'cactus' | 'reeds' | 'water' | 'waves';

/** Which tint of the recipe colours a layer. */
export type TintKind = 'ground' | 'detail' | 'water' | 'accent';

export interface DetailLayer {
  id: DetailId;
  /** Tint to use. Defaults to `water` for the sea band and waves, `detail` otherwise. */
  tint?: TintKind;
  /** Slide the strip sideways by this many native pixels, so one strip can be reused as two layers. */
  dx?: number;
  /** Lift the strip this many pixels off the strip floor. */
  dy?: number;
  /** Brightness multiplier, for a darker or hazier layer. */
  mul?: number;
  /** Draw before the base mask (the sea behind a beach). */
  behind?: boolean;
}

export interface BiomeRecipe {
  id: string;
  label: string;
  base: BaseId;
  details: readonly DetailLayer[];
  /** Hex colours for noon light. A missing ground tint means "use the sky's ground colour". */
  tints: { ground?: string; detail?: string; water?: string; accent?: string };
}

/** Manifest slot of every base mask. `hills` is the original `terrain_mask`. */
export const BASE_SLOTS: Readonly<Record<BaseId, string>> = {
  hills: 'terrain_mask',
  flatland: 'ground_flat',
  grass: 'ground_grass',
  mountains: 'ground_mountains',
  coastline: 'ground_coast',
  dunes: 'ground_dunes',
};

export function detailSlot(id: DetailId): string {
  return `detail_${id}`;
}

export const BASE_IDS = Object.keys(BASE_SLOTS) as BaseId[];
export const DETAIL_IDS: readonly DetailId[] = [
  'pine',
  'broadleaf',
  'scrub',
  'rocks',
  'snowcaps',
  'cactus',
  'reeds',
  'water',
  'waves',
];

export const DEFAULT_RECIPE: BiomeRecipe = {
  id: 'default',
  label: 'Default hills',
  base: 'hills',
  details: [],
  tints: {},
};

const sea: DetailLayer = { id: 'water', behind: true };
const foam: DetailLayer = { id: 'waves' };

const RECIPE_LIST: readonly BiomeRecipe[] = [
  DEFAULT_RECIPE,
  {
    id: 'open_water',
    label: 'Open water',
    base: 'flatland',
    details: [sea, foam],
    tints: { ground: '#24547f', water: '#2f7fc0' },
  },
  {
    id: 'beach',
    label: 'Beach and coast',
    base: 'coastline',
    details: [sea, foam],
    tints: { ground: '#e6cd92', water: '#3a9ad0' },
  },
  {
    id: 'plains',
    label: 'Plains',
    base: 'flatland',
    details: [{ id: 'scrub', dx: 7 }],
    tints: { ground: '#93c24c', detail: '#6f9a3a' },
  },
  {
    id: 'meadow',
    label: 'Meadow',
    base: 'grass',
    details: [{ id: 'scrub', dx: 3 }],
    tints: { ground: '#52b24c', detail: '#2f8f40' },
  },
  {
    id: 'forest',
    label: 'Forest',
    base: 'grass',
    details: [{ id: 'broadleaf', mul: 0.8, dx: 17 }, { id: 'broadleaf' }],
    tints: { ground: '#3f9a45', detail: '#2f8a3c' },
  },
  {
    id: 'dark_forest',
    label: 'Dark forest',
    base: 'hills',
    details: [{ id: 'broadleaf', mul: 0.7, dx: 11 }, { id: 'pine' }],
    tints: { ground: '#357a45', detail: '#2a6a3a' },
  },
  {
    id: 'hills',
    label: 'Hills',
    base: 'hills',
    details: [{ id: 'scrub', dx: 12 }],
    tints: { ground: '#5fa845', detail: '#4a8a3a' },
  },
  {
    id: 'badlands',
    label: 'Badlands',
    base: 'hills',
    details: [
      { id: 'rocks', dx: 5 },
      { id: 'scrub', dx: 20, mul: 0.8 },
    ],
    tints: { ground: '#c0703a', detail: '#8f6a4a' },
  },
  {
    id: 'marsh',
    label: 'Marsh',
    base: 'flatland',
    details: [{ id: 'water', behind: true, dx: 9 }, { id: 'reeds' }],
    tints: { ground: '#5a7a4a', detail: '#7ea04a', water: '#4a8080' },
  },
  {
    id: 'mountains',
    label: 'Mountains',
    base: 'mountains',
    details: [{ id: 'rocks', dx: 14 }],
    tints: { ground: '#8c867a', detail: '#a09a90' },
  },
  {
    id: 'snow_mountains',
    label: 'Snowy mountains',
    base: 'mountains',
    details: [
      { id: 'snowcaps', tint: 'accent' },
      { id: 'rocks', dx: 14 },
    ],
    tints: { ground: '#8da3bd', detail: '#a8b6c8', accent: '#f2f8ff' },
  },
  {
    id: 'taiga',
    label: 'Taiga',
    base: 'hills',
    details: [{ id: 'pine', mul: 0.85, dx: 18 }, { id: 'pine' }],
    tints: { ground: '#46805e', detail: '#2a6044' },
  },
  {
    id: 'desert',
    label: 'Desert',
    base: 'dunes',
    details: [{ id: 'cactus' }],
    tints: { ground: '#e2ba6a', detail: '#5f9a4a' },
  },
  {
    id: 'jungle',
    label: 'Jungle',
    base: 'hills',
    details: [
      { id: 'broadleaf', mul: 0.75, dx: 9 },
      { id: 'broadleaf' },
      { id: 'reeds', mul: 0.9, dx: 5 },
    ],
    tints: { ground: '#2f8f3a', detail: '#1f8a3a' },
  },
  {
    id: 'ashlands',
    label: 'Ashlands',
    base: 'hills',
    details: [
      { id: 'rocks', dx: 2 },
      { id: 'scrub', dx: 16, mul: 0.7 },
    ],
    tints: { ground: '#5c5458', detail: '#7a6a68' },
  },
  // Reserved biome names (ids 15-26 are not emitted yet): reuse the masks above.
  {
    id: 'moor',
    label: 'Moor',
    base: 'hills',
    details: [{ id: 'scrub' }],
    tints: { ground: '#6f7f55', detail: '#8a6a9a' },
  },
  {
    id: 'savanna',
    label: 'Savanna',
    base: 'flatland',
    details: [
      { id: 'broadleaf', dx: 5 },
      { id: 'scrub', dx: 22 },
    ],
    tints: { ground: '#c8b04e', detail: '#8a8a3a' },
  },
  {
    id: 'steppe',
    label: 'Steppe',
    base: 'grass',
    details: [{ id: 'scrub', dx: 10 }],
    tints: { ground: '#b2b25a', detail: '#8a8a48' },
  },
  {
    id: 'tundra',
    label: 'Tundra',
    base: 'flatland',
    details: [{ id: 'rocks', dx: 9 }],
    tints: { ground: '#b4c4c8', detail: '#8a9496' },
  },
  {
    id: 'alpine_meadow',
    label: 'Alpine meadow',
    base: 'mountains',
    details: [{ id: 'scrub' }, { id: 'snowcaps', tint: 'accent' }],
    tints: { ground: '#6aa860', detail: '#4a9a50', accent: '#f2f8ff' },
  },
  {
    id: 'fen',
    label: 'Fen',
    base: 'flatland',
    details: [
      { id: 'water', behind: true, dx: 20 },
      { id: 'reeds', dx: 6 },
    ],
    tints: { ground: '#667a50', detail: '#8aa05a', water: '#507878' },
  },
  {
    id: 'mangrove',
    label: 'Mangrove',
    base: 'coastline',
    details: [sea, foam, { id: 'broadleaf', dx: 8, mul: 0.8 }],
    tints: { ground: '#4a7a4a', detail: '#2f7a3c', water: '#3a8a8a' },
  },
  {
    id: 'basalt_fields',
    label: 'Basalt fields',
    base: 'flatland',
    details: [{ id: 'rocks' }, { id: 'rocks', dx: 18, mul: 0.8 }],
    tints: { ground: '#4a4a52', detail: '#6a6a74' },
  },
  {
    id: 'splinter_wastes',
    label: 'Splinter wastes',
    base: 'mountains',
    details: [{ id: 'rocks', dx: 7 }],
    tints: { ground: '#7a5a64', detail: '#9a7a84' },
  },
  {
    id: 'ethereal_glade',
    label: 'Ethereal glade',
    base: 'grass',
    details: [{ id: 'broadleaf', dx: 8 }],
    tints: { ground: '#6ad0b8', detail: '#8ae8d0' },
  },
  {
    id: 'salt_flats',
    label: 'Salt flats',
    base: 'flatland',
    details: [],
    tints: { ground: '#e4e8ec' },
  },
  {
    id: 'fungal_grove',
    label: 'Fungal grove',
    base: 'grass',
    details: [
      { id: 'scrub', dx: 2 },
      { id: 'broadleaf', mul: 0.9, dx: 14 },
    ],
    tints: { ground: '#7a5a9a', detail: '#b06ac0' },
  },
];

export const RECIPES: Readonly<Record<string, BiomeRecipe>> = Object.fromEntries(
  RECIPE_LIST.map((r) => [r.id, r]),
);

/**
 * The game's biome names by world id. Ids 0-14 are what the world generator
 * writes; 15-26 are reserved. Kept equal to `BIOME_NAMES` in `core/area/build-area.ts`
 * (a test checks).
 */
export const BIOME_ID_NAMES: readonly string[] = [
  'Water',
  'Sand',
  'Plains',
  'Meadow',
  'Forest',
  'DarkForest',
  'Hills',
  'Badlands',
  'Marsh',
  'Mountain',
  'Snow',
  'Taiga',
  'Desert',
  'Jungle',
  'Ashlands',
  'Moor',
  'Savanna',
  'Steppe',
  'Tundra',
  'AlpineMeadow',
  'Fen',
  'Mangrove',
  'BasaltFields',
  'SplinterWastes',
  'EtherealGlade',
  'SaltFlats',
  'FungalGrove',
];

/** Biome name to recipe id. */
export const BIOME_RECIPE: Readonly<Record<string, string>> = {
  Water: 'open_water',
  Sand: 'beach',
  Plains: 'plains',
  Meadow: 'meadow',
  Forest: 'forest',
  DarkForest: 'dark_forest',
  Hills: 'hills',
  Badlands: 'badlands',
  Heath: 'badlands',
  Marsh: 'marsh',
  Mountain: 'mountains',
  Snow: 'snow_mountains',
  Taiga: 'taiga',
  Desert: 'desert',
  Jungle: 'jungle',
  Ashlands: 'ashlands',
  Moor: 'moor',
  Savanna: 'savanna',
  Steppe: 'steppe',
  Tundra: 'tundra',
  AlpineMeadow: 'alpine_meadow',
  Fen: 'fen',
  Mangrove: 'mangrove',
  BasaltFields: 'basalt_fields',
  SplinterWastes: 'splinter_wastes',
  EtherealGlade: 'ethereal_glade',
  SaltFlats: 'salt_flats',
  FungalGrove: 'fungal_grove',
};

/** The recipe for a biome given as a world id, a biome name or a recipe id. Anything else gets the default. */
export function recipeFor(biome: number | string | null | undefined): BiomeRecipe {
  if (biome === null || biome === undefined) return DEFAULT_RECIPE;
  if (typeof biome === 'number') {
    const name = BIOME_ID_NAMES[biome];
    const id = name ? BIOME_RECIPE[name] : undefined;
    return (id && RECIPES[id]) || DEFAULT_RECIPE;
  }
  const key = biome.trim();
  const byName = BIOME_RECIPE[key];
  if (byName) return RECIPES[byName] ?? DEFAULT_RECIPE;
  const lower = key.toLowerCase();
  const byId = RECIPES[lower];
  if (byId) return byId;
  const loose = Object.keys(BIOME_RECIPE).find((name) => name.toLowerCase() === lower);
  return (loose && RECIPES[BIOME_RECIPE[loose] ?? '']) || DEFAULT_RECIPE;
}

/** Every manifest slot a recipe draws, back to front. */
export function recipeSlots(recipe: BiomeRecipe): string[] {
  return [
    ...recipe.details.filter((d) => d.behind).map((d) => detailSlot(d.id)),
    BASE_SLOTS[recipe.base],
    ...recipe.details.filter((d) => !d.behind).map((d) => detailSlot(d.id)),
  ];
}

/** The colour kind a layer uses when its recipe does not say. */
export function layerTint(layer: DetailLayer): TintKind {
  return layer.tint ?? (layer.id === 'water' || layer.id === 'waves' ? 'water' : 'detail');
}
