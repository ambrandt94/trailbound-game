/**
 * Building roles for settlement generation 3. A role is what a building is
 * for. Culture renames it and the biome set gives it a form. `unassigned` is
 * a real value: the lot is placed, and the gap stays visible.
 */
export type BuildingRole =
  | 'home'
  | 'manor'
  | 'market'
  | 'shop'
  | 'inn'
  | 'bakery'
  | 'warehouse'
  | 'smithy'
  | 'workshop'
  | 'stables'
  | 'wagonwright'
  | 'barn'
  | 'farmstead'
  | 'dock'
  | 'temple'
  | 'shrine'
  | 'healer'
  | 'town_hall'
  | 'guildhall'
  | 'bank'
  | 'barracks'
  | 'guard_post'
  | 'watchtower'
  | 'gatehouse'
  | 'keep'
  | 'arena'
  | 'unassigned';

export type RoleGroup = 'dwelling' | 'trade' | 'craft' | 'faith' | 'civic' | 'martial' | 'none';

export interface RoleStyle {
  role: BuildingRole;
  label: string;
  /** Overlay colour for the role's group. No pure black. */
  colour: string;
  glyph: string;
  group: RoleGroup;
}

export interface RoleDemand {
  role: BuildingRole;
  /** Exactly this many. */
  count?: number;
  /** Share of the lots that remain after the counted roles. */
  share?: number;
  /** Only once the rolled building count reaches this. */
  minBuildings?: number;
}

const GROUP_COLOUR: Record<RoleGroup, string> = {
  dwelling: '#e4d2b0',
  trade: '#e0a045',
  craft: '#c46a3a',
  faith: '#c9c4ea',
  civic: '#7ea0c4',
  martial: '#c45a5a',
  none: '#a3a096',
};

function style(role: BuildingRole, label: string, glyph: string, group: RoleGroup): RoleStyle {
  return { role, label, colour: GROUP_COLOUR[group], glyph, group };
}

export const ROLE_STYLE: Record<BuildingRole, RoleStyle> = {
  home: style('home', 'Home', 'Ho', 'dwelling'),
  manor: style('manor', 'Manor', 'Ma', 'dwelling'),
  market: style('market', 'Market', 'Mk', 'trade'),
  shop: style('shop', 'Shop', 'Sh', 'trade'),
  inn: style('inn', 'Inn', 'In', 'trade'),
  bakery: style('bakery', 'Bakery', 'Bk', 'trade'),
  warehouse: style('warehouse', 'Warehouse', 'Wh', 'trade'),
  smithy: style('smithy', 'Smithy', 'Sm', 'craft'),
  workshop: style('workshop', 'Workshop', 'Ws', 'craft'),
  stables: style('stables', 'Stables', 'St', 'craft'),
  wagonwright: style('wagonwright', 'Wagonwright', 'Wg', 'craft'),
  barn: style('barn', 'Barn', 'Bn', 'craft'),
  farmstead: style('farmstead', 'Farmstead', 'Fm', 'craft'),
  dock: style('dock', 'Dock', 'Dk', 'craft'),
  temple: style('temple', 'Temple', 'Tp', 'faith'),
  shrine: style('shrine', 'Shrine', 'Sr', 'faith'),
  healer: style('healer', 'Healer', 'Hl', 'faith'),
  town_hall: style('town_hall', 'Town hall', 'Th', 'civic'),
  guildhall: style('guildhall', 'Guildhall', 'Gd', 'civic'),
  bank: style('bank', 'Bank', 'Ba', 'civic'),
  barracks: style('barracks', 'Barracks', 'Br', 'martial'),
  guard_post: style('guard_post', 'Guard post', 'Gp', 'martial'),
  watchtower: style('watchtower', 'Watchtower', 'Wt', 'martial'),
  gatehouse: style('gatehouse', 'Gatehouse', 'Gh', 'martial'),
  keep: style('keep', 'Keep', 'Kp', 'martial'),
  arena: style('arena', 'Arena', 'Ar', 'martial'),
  unassigned: style('unassigned', 'Unassigned', '?', 'none'),
};

export const BUILDING_ROLES = Object.keys(ROLE_STYLE) as BuildingRole[];

/** Today's kit specialties keep a role, so older plans still read. */
export const ROLE_FOR_SPECIALTY: Record<string, BuildingRole> = {
  tent: 'home',
  hovel: 'home',
  cottage: 'home',
  townhouse: 'home',
  manor: 'manor',
  general_store: 'shop',
  bakery: 'bakery',
  tavern: 'inn',
  bank: 'bank',
  apothecary: 'healer',
  cartographer: 'shop',
  market_stall: 'market',
  smithy: 'smithy',
  carpenter: 'workshop',
  stables: 'stables',
  wagonwright: 'wagonwright',
  barn: 'barn',
  healer: 'healer',
  temple_small: 'shrine',
  temple: 'temple',
  town_hall: 'town_hall',
  guildhall: 'guildhall',
};

export function roleGroupColour(group: RoleGroup): string {
  return GROUP_COLOUR[group];
}
