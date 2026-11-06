import { buildAreaExport, type AreaExport } from '../area/build-area';
import { resolveAreaAt } from '../area/area-window';
import { defaultPlayerAvatar, isPlayerAvatar } from '../people/avatar';
import type { PlayerAvatar } from '../people/avatar';
import type { CfPin, PackedWorld, PlayerSave } from '../save/types';
import { GAME_HOURS_PER_REAL_SECOND, START_HOUR } from '../sim/clock';
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
  private readonly areaCache = new Map<string, AreaExport>();
  private simRng = new Rng(DEFAULT_WORLD_SEED);
  private explored = new Set<string>();

  /** Build the seeded continent. Pass `keepHero` when a save already placed the walker. */
  beginGeneratedWorld(
    seed = this.seed,
    options?: { keepHero?: boolean; settings?: WorldSettings },
  ): void {
    this.seed = seed;
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

  /** Drop the hero just outside the town on the side they left the 3D area. */
  placeHeroOutside(exit: AreaExit): void {
    const foot = this.footprint;
    if (foot) {
      const alongX = foot.minX + clamp01(exit.pos) * Math.max(0, foot.maxX - foot.minX);
      const alongY = foot.minY + clamp01(exit.pos) * Math.max(0, foot.maxY - foot.minY);
      const margin = 1.2;
      let x = this.town.x;
      let y = this.town.y;
      switch (exit.side) {
        case 'north':
          x = alongX;
          y = foot.minY - margin;
          break;
        case 'south':
          x = alongX;
          y = foot.maxY + margin;
          break;
        case 'west':
          x = foot.minX - margin;
          y = alongY;
          break;
        case 'east':
          x = foot.maxX + margin;
          y = alongY;
          break;
        default: {
          const unknown: never = exit.side;
          throw new Error(`unknown exit side ${String(unknown)}`);
        }
      }
      this.hero = { x, y, yaw: exit.yaw };
      this.syncPlayer();
      this.record({ type: 'area-exit', rev: this.bump(), exit: { ...exit } });
      return;
    }
    const along = (clamp01(exit.pos) - 0.5) * 1.4;
    const tx = this.town.x;
    const ty = this.town.y;
    let x = tx;
    let y = ty;
    switch (exit.side) {
      case 'north':
        x = tx + along;
        y = ty - HERO_OUTSIDE_TOWN;
        break;
      case 'south':
        x = tx + along;
        y = ty + HERO_OUTSIDE_TOWN;
        break;
      case 'west':
        x = tx - HERO_OUTSIDE_TOWN;
        y = ty + along;
        break;
      case 'east':
        x = tx + HERO_OUTSIDE_TOWN;
        y = ty + along;
        break;
      default: {
        const unknown: never = exit.side;
        throw new Error(`unknown exit side ${String(unknown)}`);
      }
    }
    this.hero = { x, y, yaw: exit.yaw };
    this.syncPlayer();
    this.record({ type: 'area-exit', rev: this.bump(), exit: { ...exit } });
  }

  load(core: PackedWorld): void {
    this.clockHours = core.clockHours;
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
      gameVersion: meta.gameVersion,
      cfPin: { ...meta.cfPin },
    };
  }

  private addHours(hours: number): void {
    if (!(hours > 0)) return;
    const before = Math.floor(this.clockHours * 60);
    this.clockHours += hours;
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

function facingFromYaw(yaw: number): 0 | 1 | 2 | 3 {
  const dx = Math.sin(yaw);
  const dy = -Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 2;
  return dy < 0 ? 3 : 0;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
