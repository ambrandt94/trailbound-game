import { buildAreaExport, type AreaExport } from '../area/build-area';
import { resolveAreaAt } from '../area/area-window';
import { defaultPlayerAvatar, isPlayerAvatar } from '../people/avatar';
import type { PlayerAvatar } from '../people/avatar';
import type { CfPin, PackedWorld, PlayerSave, PartySave } from '../save/types';
import { GAME_HOURS_PER_REAL_SECOND, START_HOUR } from '../sim/clock';
import {
  applyOvernight,
  applyWagonAction,
  createParty,
  normalizeParty,
  resolveMinigame,
  sleepHours,
  type MinigameResult,
  type PartyState,
  type ResolvedMinigame,
  type WagonActionId,
} from '../sim/party';
import { hoursForTu, tuOfDay } from '../sim/time';
import { exploredTileKeys, tileExplored } from '../sim/fog';
import { defaultPlayerState } from '../sim/player';
import { Rng } from '../world/noise';
import { spawnEntities, spawnResidents, stepEntities, stepResidentRoutines } from '../sim/entities';
import { generateChunk, neighborMap } from '../world/chunk-gen';
import {
  DEFAULT_WORLD_SETTINGS,
  GAME_HOURS_PER_REAL_SEC,
  TRAVEL_SIM_BUDGET_SEC,
  TRAVEL_SIM_STEP_SEC,
  TILE,
  chunkKey,
  clamp,
  clampSettings,
  nodeContaining,
  travelGameHours,
  wrapX,
  type ChunkData,
  type MapEntity,
  type MapNode,
  type PlayerState,
  type WorldData,
  type WorldSettings,
} from '../world/models';
import { tierForKind } from '../world/settlement-tiers';
import { defaultPlayerStart, generateWorld } from '../world/world-gen';
import { DEFAULT_WORLD_SEED } from '../world/index';

export type AreaSide = 'north' | 'east' | 'south' | 'west';

/** Edge-exit payload shared by the map and the 3D view. `pos` runs 0..1 along that edge. */
export interface AreaExit {
  side: AreaSide;
  pos: number;
  yaw: number;
  /** Escape. Put the traveller back on the tile they entered from. */
  cancel?: boolean;
}

export interface TownRef {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface HeroPose {
  x: number;
  y: number;
  yaw: number;
}

/** Inclusive world-tile span of the settlement the hero last entered. */
export interface PlaceFootprint {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface AreaEntry {
  placeId: string;
  placeName: string;
  tier: string | null;
}

export interface AreaHandoff {
  areaExport: AreaExport;
  entry: AreaEntry;
}

export type WorldEvent =
  | { type: 'clock-tick'; rev: number }
  | { type: 'area-exit'; rev: number; exit: AreaExit }
  | { type: 'avatar-changed'; rev: number }
  | { type: 'loaded'; rev: number };

/** How far outside the town center an area exit places the hero. Farther than the enter radius. */
export const HERO_OUTSIDE_TOWN = 1.9;

export class WorldState {
  clockHours = START_HOUR;
  /** Party supplies. The wagon flag stays true so a later save can keep it. */
  party: PartyState = createParty();
  rev = 0;
  readonly events: WorldEvent[] = [];
  seed = DEFAULT_WORLD_SEED;
  hero: HeroPose = { x: 0, y: 0, yaw: 0 };
  avatar: PlayerAvatar = defaultPlayerAvatar();
  town: TownRef = { id: 'waystead', name: 'Waystead', x: 8, y: 8 };
  data: WorldData | null = null;
  entities: MapEntity[] = [];
  player: PlayerState = defaultPlayerState();
  footprint: PlaceFootprint | null = null;
  readonly chunks = new Map<string, ChunkData>();
  readonly visited = new Set<string>();
  /** Where the hero stood when the current area was entered. */
  private entryPose: HeroPose | null = null;
  private readonly areaCache = new Map<string, AreaExport>();
  private simRng = new Rng(DEFAULT_WORLD_SEED);
  private explored = new Set<string>();

  /** Build the seeded continent. Pass `keepHero` when a save already placed the walker. */
  beginGeneratedWorld(
    seed = this.seed,
    options?: { keepHero?: boolean; settings?: WorldSettings },
  ): void {
    this.seed = seed;
    this.entryPose = null;
    this.areaCache.clear();
    const settings =
      options?.settings ?? clampSettings({ ...DEFAULT_WORLD_SETTINGS, worldScale: 16 });
    this.data = generateWorld(seed, settings);
    this.chunks.clear();
    this.entities = [...spawnEntities(this.data, seed), ...spawnResidents(this.data, seed)];
    this.simRng = new Rng((seed ^ 0x91a2) >>> 0 || 1);
    this.visited.clear();
    this.explored = exploredTileKeys(this.data, this.visited);
    if (!options?.keepHero) {
      this.clockHours = START_HOUR;
      this.party = createParty();
      const start = defaultPlayerStart(this.data);
      this.hero = { x: start.x, y: start.y, yaw: 0 };
      const home = this.data.nodes.find((node) => node.id === 'ashfen') ?? this.data.nodes[0];
      if (home) this.rememberTown(home, false);
    } else {
      this.hero = {
        x: wrapX(this.hero.x, this.data.width),
        y: clamp(this.hero.y, 0.5, this.data.height - 0.5),
        yaw: this.hero.yaw,
      };
    }
    this.syncPlayer();
  }

  /**
   * Idle frame: the map clock and travellers advance together.
   * `hoursPerRealSec` is the zoomed map clock. Residents stay simulated, not drawn.
   */
  stepIdle(realSeconds: number, hoursPerRealSec = GAME_HOURS_PER_REAL_SECOND): void {
    if (!(realSeconds > 0)) return;
    const rate = hoursPerRealSec > 0 ? hoursPerRealSec : GAME_HOURS_PER_REAL_SECOND;
    this.advanceClock(realSeconds, rate);
    this.stepTravelers(realSeconds * (rate / GAME_HOURS_PER_REAL_SECOND));
  }

  /**
   * Charge a walk on the clock and step travellers by that same game time.
   * Distance is metres; pace is metres per game second.
   */
  advanceTravel(distanceMeters: number, paceMps: number): number {
    const hours = travelGameHours(distanceMeters, paceMps);
    if (hours <= 0) return 0;
    const budgetHours = TRAVEL_SIM_BUDGET_SEC * GAME_HOURS_PER_REAL_SEC;
    const applied = Math.min(hours, budgetHours);
    let simSec = applied / GAME_HOURS_PER_REAL_SEC;
    while (simSec > 1e-8) {
      const step = Math.min(simSec, TRAVEL_SIM_STEP_SEC);
      this.stepTravelers(step);
      this.addHours(step * GAME_HOURS_PER_REAL_SEC);
      simSec -= step;
    }
    return applied;
  }

  moveHero(dx: number, dy: number): void {
    const world = this.data;
    if (!world) {
      this.hero = { ...this.hero, x: this.hero.x + dx, y: this.hero.y + dy };
      this.syncPlayer();
      return;
    }
    const x = wrapX(this.hero.x + dx, world.width);
    const y = clamp(this.hero.y + dy, 0.5, world.height - 0.5);
    if (dx !== 0 || dy !== 0) this.hero.yaw = Math.atan2(dx, -dy);
    this.hero = { ...this.hero, x, y };
    this.syncPlayer();
  }

  settlementAt(x = this.hero.x, y = this.hero.y): MapNode | null {
    const world = this.data;
    if (!world) return null;
    const node = nodeContaining(world.nodes, x, y);
    if (!node || !tierForKind(node.kind)) return null;
    return node;
  }

  /** Bake the place and remember its edge so the 3D exit lands outside it. */
  buildHandoff(node: MapNode): AreaHandoff {
    const world = this.data;
    if (!world) throw new Error('world is not generated');
    const key = tierForKind(node.kind) ? `settle:${node.id}` : `wild:${node.id}`;
    return this.bakeArea(world, node, key);
  }

  /**
   * Area for this world position. A settlement bakes the whole town.
   * Any other land bakes the snapped window around it. Deep water returns null.
   * Repeat calls for the same area reuse the cached export.
   */
  buildHandoffHere(x = this.hero.x, y = this.hero.y): AreaHandoff | null {
    const world = this.data;
    if (!world) return null;
    const resolved = resolveAreaAt(world, x, y);
    if (!resolved) return null;
    return this.bakeArea(world, resolved.node, resolved.cacheKey);
  }

  isExplored(x: number, y: number): boolean {
    const world = this.data;
    if (!world) return true;
    return tileExplored(world, x, y, this.explored);
  }

  /** Generate a few street chunks per frame so a zoom-in does not hitch. */
  ensureChunks(x0: number, y0: number, x1: number, y1: number, budget = 8): ChunkData[] {
    const world = this.data;
    const made: ChunkData[] = [];
    if (!world) return made;
    for (let y = y0; y <= y1 && made.length < budget; y++) {
      for (let x = x0; x <= x1 && made.length < budget; x++) {
        const key = chunkKey(x, y);
        if (this.chunks.has(key)) continue;
        const chunk = generateChunk(world, x, y, neighborMap(this.chunks, x, y));
        this.chunks.set(key, chunk);
        made.push(chunk);
      }
    }
    return made;
  }

  advanceClock(realSeconds: number, hoursPerRealSec = GAME_HOURS_PER_REAL_SECOND): void {
    if (!(realSeconds > 0) || !(hoursPerRealSec > 0)) return;
    this.addHours(realSeconds * hoursPerRealSec);
  }

  /** Drop the hero on the map tile that matches how they left the 3D area. */
  placeHeroOutside(exit: AreaExit): void {
    const world = this.data;
    const landed = landAfterAreaExit(
      exit,
      this.footprint,
      this.entryPose,
      this.town,
      world ? { width: world.width, height: world.height } : null,
    );
    this.hero = landed;
    this.syncPlayer();
    this.record({ type: 'area-exit', rev: this.bump(), exit: { ...exit } });
  }

  /** Spend TU or sleep from the wagon. Play activities open a minigame instead. */
  useWagon(id: WagonActionId): string {
    const result = applyWagonAction(this.party, id, tuOfDay(this.clockHours));
    this.party = result.party;
    if (result.tu > 0) this.addHours(hoursForTu(result.tu));
    if (result.sleep) {
      const day = Math.floor(this.clockHours / 24);
      const target = (day + 1) * 24;
      this.addHours(Math.max(sleepHours(this.clockHours), target - this.clockHours));
    }
    return result.message;
  }

  /**
   * One place for a finished minigame: party, purse, and clock.
   * The save writes this same party the next time the game persists.
   */
  applyMinigameResult(result: MinigameResult): ResolvedMinigame {
    const resolved = resolveMinigame(this.party, result);
    this.party = resolved.party;
    if (resolved.tu > 0) this.addHours(hoursForTu(resolved.tu));
    return resolved;
  }

  load(core: PackedWorld): void {
    this.clockHours = core.clockHours;
    this.party = normalizeParty(core.party);
    this.seed = core.worldSeed;
    this.hero = {
      x: core.player.mapX,
      y: core.player.mapY,
      yaw: core.player.yaw,
    };
    this.avatar = copyAvatar(core.player.avatar, core.player.name);
    if (this.data) {
      this.hero = {
        x: wrapX(this.hero.x, this.data.width),
        y: clamp(this.hero.y, 0.5, this.data.height - 0.5),
        yaw: this.hero.yaw,
      };
    }
    this.syncPlayer();
    this.record({ type: 'loaded', rev: this.bump() });
  }

  setAvatar(avatar: PlayerAvatar): void {
    this.avatar = copyAvatar(avatar, avatar.name);
    this.record({ type: 'avatar-changed', rev: this.bump() });
  }

  toPacked(meta: { gameVersion: string; cfPin: CfPin; playerName?: string }): PackedWorld {
    const avatar = copyAvatar(this.avatar, this.avatar.name || meta.playerName || 'Traveller');
    const player: PlayerSave = {
      name: avatar.name,
      mapX: this.hero.x,
      mapY: this.hero.y,
      yaw: this.hero.yaw,
      avatar,
    };
    return {
      clockHours: this.clockHours,
      worldSeed: this.seed,
      player,
      party: partySave(this.party),
      gameVersion: meta.gameVersion,
      cfPin: { ...meta.cfPin },
    };
  }

  private addHours(hours: number): void {
    if (!(hours > 0)) return;
    const beforeDay = Math.floor(this.clockHours / 24 + 1e-9);
    const before = Math.floor(this.clockHours * 60);
    this.clockHours += hours;
    const afterDay = Math.floor((this.clockHours + 1e-6) / 24);
    const nights = Math.min(30, Math.max(0, afterDay - beforeDay));
    for (let i = 0; i < nights; i++) this.party = applyOvernight(this.party);
    const after = Math.floor(this.clockHours * 60);
    if (after !== before) this.record({ type: 'clock-tick', rev: this.bump() });
  }

  private stepTravelers(dt: number): void {
    const world = this.data;
    if (!world || !(dt > 0)) return;
    stepResidentRoutines(this.entities, this.clockHours);
    stepEntities(world, this.entities, dt, this.simRng);
  }

  private syncPlayer(): void {
    const facing = facingFromYaw(this.hero.yaw);
    this.player = {
      ...this.player,
      id: this.player.id || defaultPlayerState().id,
      x: this.hero.x,
      y: this.hero.y,
      facing,
    };
  }

  private bakeArea(world: WorldData, node: MapNode, cacheKey: string): AreaHandoff {
    this.entryPose = { x: this.hero.x, y: this.hero.y, yaw: this.hero.yaw };
    this.rememberTown(node, true);
    if (world.nodes.some((item) => item.id === node.id) && tierForKind(node.kind)) {
      this.visited.add(node.id);
      this.explored = exploredTileKeys(world, this.visited);
    }
    let areaExport = this.areaCache.get(cacheKey);
    if (!areaExport) {
      areaExport = buildAreaExport(world, node, { timeOfDayHours: this.clockHours });
      this.areaCache.set(cacheKey, areaExport);
    } else {
      areaExport.meta.timeOfDayHours = Math.round(this.clockHours * 1000) / 1000;
    }
    return {
      areaExport,
      entry: {
        placeId: node.id,
        placeName: node.name,
        tier: tierForKind(node.kind),
      },
    };
  }

  private rememberTown(node: MapNode, withFootprint: boolean): void {
    this.town = { id: node.id, name: node.name, x: node.cx, y: node.cy };
    if (!withFootprint) {
      this.footprint = null;
      return;
    }
    const tiles = node.tiles ?? [];
    if (!tiles.length) {
      this.footprint = null;
      return;
    }
    let minX = tiles[0]!.x;
    let maxX = tiles[0]!.x;
    let minY = tiles[0]!.y;
    let maxY = tiles[0]!.y;
    for (const tile of tiles) {
      if (tile.x < minX) minX = tile.x;
      if (tile.x > maxX) maxX = tile.x;
      if (tile.y < minY) minY = tile.y;
      if (tile.y > maxY) maxY = tile.y;
    }
    this.footprint = { minX, minY, maxX, maxY };
  }

  private bump(): number {
    this.rev += 1;
    return this.rev;
  }

  private record(event: WorldEvent): void {
    this.events.push(event);
    if (this.events.length > 32) this.events.shift();
  }
}

export function createWorld(town: TownRef, seed = DEFAULT_WORLD_SEED): WorldState {
  const world = new WorldState();
  world.seed = seed;
  world.town = { ...town };
  world.hero = { x: town.x - 2.5, y: town.y, yaw: 0 };
  world.clockHours = START_HOUR;
  return world;
}

export interface MapBounds {
  width: number;
  height: number;
}

/**
 * World tile under the drawn traveller. The map draws them at `hero * TILE`
 * and zooms with a uniform scale, so the tile does not change with zoom.
 */
export function heroTileOnScreen(
  heroX: number,
  heroY: number,
  cameraX: number,
  cameraY: number,
  scale: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  const safe = Math.max(scale, 1e-6);
  const sx = viewW / 2 + (heroX - cameraX) * TILE * safe;
  const sy = viewH / 2 + (heroY - cameraY) * TILE * safe;
  const wx = cameraX + (sx - viewW / 2) / (safe * TILE);
  const wy = cameraY + (sy - viewH / 2) / (safe * TILE);
  return { x: Math.floor(wx + 1e-8), y: Math.floor(wy + 1e-8) };
}

/**
 * Where a 3D exit stands on the map.
 * Escape returns to the entry tile. Walking off an edge stands in the centre
 * of the tile just outside that edge, lined up with where they crossed.
 */
export function landAfterAreaExit(
  exit: AreaExit,
  foot: PlaceFootprint | null,
  entry: HeroPose | null,
  town: { x: number; y: number },
  bounds: MapBounds | null,
): HeroPose {
  if (exit.cancel && entry) return fitHero(entry.x, entry.y, entry.yaw, bounds);
  if (foot) {
    const pos = clamp01(exit.pos);
    const spanX = Math.max(0, foot.maxX - foot.minX);
    const spanY = Math.max(0, foot.maxY - foot.minY);
    let x = foot.minX + 0.5 + pos * spanX;
    let y = foot.minY + 0.5 + pos * spanY;
    switch (exit.side) {
      case 'north':
        y = foot.minY - 0.5;
        break;
      case 'south':
        y = foot.maxY + 1.5;
        break;
      case 'west':
        x = foot.minX - 0.5;
        break;
      case 'east':
        x = foot.maxX + 1.5;
        break;
      default: {
        const unknown: never = exit.side;
        throw new Error(`unknown exit side ${String(unknown)}`);
      }
    }
    return fitHero(x, y, exit.yaw, bounds);
  }
  const along = (clamp01(exit.pos) - 0.5) * 1.4;
  let x = town.x;
  let y = town.y;
  switch (exit.side) {
    case 'north':
      x = town.x + along;
      y = town.y - HERO_OUTSIDE_TOWN;
      break;
    case 'south':
      x = town.x + along;
      y = town.y + HERO_OUTSIDE_TOWN;
      break;
    case 'west':
      x = town.x - HERO_OUTSIDE_TOWN;
      y = town.y + along;
      break;
    case 'east':
      x = town.x + HERO_OUTSIDE_TOWN;
      y = town.y + along;
      break;
    default: {
      const unknown: never = exit.side;
      throw new Error(`unknown exit side ${String(unknown)}`);
    }
  }
  return fitHero(x, y, exit.yaw, bounds);
}

function fitHero(x: number, y: number, yaw: number, bounds: MapBounds | null): HeroPose {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0.5;
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) {
    return { x: safeX, y: safeY, yaw: safeYaw };
  }
  return {
    x: wrapX(safeX, bounds.width),
    y: clamp(safeY, 0.5, Math.max(0.5, bounds.height - 0.5)),
    yaw: safeYaw,
  };
}

function copyAvatar(avatar: PlayerAvatar | undefined, name: string): PlayerAvatar {
  if (!isPlayerAvatar(avatar)) return defaultPlayerAvatar(name || 'Traveller');
  return {
    name: avatar.name,
    seed: avatar.seed,
    profileEntry: JSON.parse(JSON.stringify(avatar.profileEntry)) as PlayerAvatar['profileEntry'],
    generatorVersion: avatar.generatorVersion,
    recipeHash: avatar.recipeHash,
    race: avatar.race,
    gender: avatar.gender,
    recipe: avatar.recipe
      ? (JSON.parse(JSON.stringify(avatar.recipe)) as PlayerAvatar['recipe'])
      : undefined,
  };
}

function partySave(party: PartyState): PartySave {
  return {
    hasWagon: party.hasWagon,
    rawFood: party.rawFood,
    meals: party.meals,
    morale: party.morale,
    hungry: party.hungry,
    dirtyDishes: party.dirtyDishes,
    coins: party.coins,
  };
}

function facingFromYaw(yaw: number): 0 | 1 | 2 | 3 {
  const dx = Math.sin(yaw);
  const dy = -Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 2;
  return dy < 0 ? 3 : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
