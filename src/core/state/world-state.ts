import { buildAreaExport, type AreaExport } from '../area/build-area';
import { resolveAreaAt, resolveConvoyArea } from '../area/area-window';
import { defaultPlayerAvatar, isPlayerAvatar } from '../people/avatar';
import type { PlayerAvatar } from '../people/avatar';
import type { CfPin, PackedWorld, PlayerSave, PartySave } from '../save/types';
import { GAME_HOURS_PER_REAL_SECOND, START_HOUR } from '../sim/clock';
import { mapTimeRuns } from '../sim/map-pace';
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
import { HOURS_PER_TU, hoursForTu, tuOfDay } from '../sim/time';
import {
  advanceCaravan,
  advanceCaravanTiles,
  appendRoute,
  canEditRoute,
  caravanSave,
  caravanSpeedMod,
  clearRoute,
  createCaravan,
  hasRoute,
  isRolling,
  loadCaravan,
  setRoute,
  type CaravanEvent,
  type CaravanPlace,
  type CaravanState,
  type CaravanTarget,
} from '../sim/caravan';
import { planRoute } from '../world/route-plan';
import { tileToLocal, type AreaFrame, type ConvoyBounds } from '../sim/convoy';
import { exploredTileKeys, tileExplored } from '../sim/fog';
import { defaultPlayerState } from '../sim/player';
import { Rng } from '../world/noise';
import { spawnEntities, spawnResidents, stepEntities, stepResidentRoutines } from '../sim/entities';
import { generateChunk, neighborMap } from '../world/chunk-gen';
import {
  Biome,
  DEFAULT_WORLD_SETTINGS,
  GAME_HOURS_PER_REAL_SEC,
  TRAVEL_SIM_BUDGET_SEC,
  TRAVEL_SIM_STEP_SEC,
  TILE,
  chunkKey,
  biomeAt,
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
  /** Set when the area is a convoy window cut around the rolling caravan. */
  convoy?: ConvoyHandoff;
}

/** Where a convoy window sits: local metres ↔ fine world tiles, and its playable box. */
export interface ConvoyHandoff {
  frame: AreaFrame;
  bounds: ConvoyBounds;
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
  /** The party's wagons on the map. Separate from the hero, who may scout on foot. */
  caravan: CaravanState = createCaravan(0, 0);
  /** Hero rides with the caravan. Any map move key sets this false (scouting). */
  heroAboard = true;
  /**
   * True while a 3D area is open. The clock no longer rolls the caravan; a
   * convoy area moves it by the metres its wagon covers (`rollConvoy`).
   */
  areaHold = false;
  /** Arrivals and stops since the scene last read them. */
  readonly caravanEvents: CaravanEvent[] = [];
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
      this.caravan = createCaravan(start.x, start.y);
      this.caravan.todayDay = Math.floor(this.clockHours / 24);
      this.heroAboard = true;
      this.areaHold = false;
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
   * Idle map frame under the pace settings. With "time moves only when I
   * move" on this does nothing; off, a rolling caravan runs the clock at the
   * zoomed map rate times the map speed step. Returns whether time ran.
   */
  stepMapIdle(
    realSeconds: number,
    hoursPerRealSec: number,
    speed: number,
    onlyWhenMoving: boolean,
  ) {
    if (!this.mapClockRuns(false, onlyWhenMoving)) return false;
    this.stepIdle(realSeconds, hoursPerRealSec * Math.max(1, speed));
    return true;
  }

  /**
   * Charge a walk on the clock and step travellers by that same game time.
   * Distance is metres; pace is metres per game second. `speed` is the map
   * speed step: a faster walk covers more game time per frame, so the sim
   * budget grows with it instead of cutting the walk short.
   */
  advanceTravel(distanceMeters: number, paceMps: number, speed = 1): number {
    const hours = travelGameHours(distanceMeters, paceMps);
    if (hours <= 0) return 0;
    const budgetHours = TRAVEL_SIM_BUDGET_SEC * Math.max(1, speed) * GAME_HOURS_PER_REAL_SEC;
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

  /** Walk the hero. Any real step leaves the caravan: the hero is scouting on foot. */
  moveHero(dx: number, dy: number): void {
    if (dx !== 0 || dy !== 0) this.heroAboard = false;
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

  /**
   * Convoy window centred on a point (the caravan, or a spot ahead of it on
   * the route), with the route painted through it as a track. Not cached:
   * the window moves with the wagons. Null in a settlement or on water.
   */
  buildConvoyHandoff(x = this.caravan.x, y = this.caravan.y): AreaHandoff | null {
    const world = this.data;
    if (!world || !hasRoute(this.caravan)) return null;
    const resolved = resolveConvoyArea(world, x, y);
    if (!resolved) return null;
    this.entryPose = { x: this.caravan.x, y: this.caravan.y, yaw: this.caravan.yaw };
    this.footprint = null;
    const node = resolved.node;
    this.town = { id: node.id, name: node.name, x: node.cx, y: node.cy };
    const areaExport = buildAreaExport(world, node, {
      timeOfDayHours: this.clockHours,
      trail: this.caravan.route,
    });
    const frame: AreaFrame = {
      innerOrigin: { ...areaExport.area.innerOrigin },
      metersPerTile: areaExport.units.metersPerTile,
    };
    const min = tileToLocal(frame, resolved.minX, resolved.minY);
    const max = tileToLocal(frame, resolved.maxX + 1, resolved.maxY + 1);
    return {
      areaExport,
      entry: { placeId: node.id, placeName: node.name, tier: tierForKind(node.kind) },
      convoy: { frame, bounds: { minX: min.x, maxX: max.x, minZ: min.z, maxZ: max.z } },
    };
  }

  /** True when the map clock should run this frame. See `mapClockRuns`. */
  mapClockRuns(heroMoving: boolean, onlyWhenMoving = false): boolean {
    return mapTimeRuns(this.caravan, heroMoving, onlyWhenMoving);
  }

  /** Roll the caravan by the metres the 3D convoy wagon covered. */
  rollConvoy(tiles: number): number {
    if (!(tiles > 0) || !isRolling(this.caravan)) return 0;
    return this.applyRoll(advanceCaravanTiles(this.caravan, tiles, this.caravanEnv()));
  }

  /** Put the hero back on the map after a convoy area: aboard, or where they walked to. */
  leaveConvoy(at: { x: number; y: number; yaw: number }, aboard: boolean): void {
    const world = this.data;
    if (aboard) {
      this.heroAboard = true;
      this.hero = { x: this.caravan.x, y: this.caravan.y, yaw: this.caravan.yaw };
    } else {
      this.heroAboard = false;
      const x = world ? wrapX(at.x, world.width) : at.x;
      const y = world ? clamp(at.y, 0.5, world.height - 0.5) : at.y;
      this.hero = { x, y, yaw: at.yaw };
    }
    this.syncPlayer();
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
    if (!exit.cancel) this.heroAboard = false;
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
      this.addHours(Math.max(sleepHours(this.clockHours), target - this.clockHours), false);
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
    const loaded = loadCaravan(core.caravan, this.hero);
    this.caravan = loaded.caravan;
    // A hero saved away from the wagons is scouting, whatever the flag says.
    const apart = Math.hypot(this.hero.x - this.caravan.x, this.hero.y - this.caravan.y) > 1;
    this.heroAboard = loaded.heroAboard && !apart;
    this.areaHold = false;
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
      caravan: caravanSave(this.caravan, this.heroAboard),
      gameVersion: meta.gameVersion,
      cfPin: { ...meta.cfPin },
    };
  }

  // ---------- caravan ----------

  /** Speed modifier for the caravan at a point: morale, mountains, wagon hook. */
  caravanSpeedAt(x = this.caravan.x, y = this.caravan.y): number {
    const world = this.data;
    const biome = world ? biomeAt(world, wrapX(x, world.width), y) : Biome.Plains;
    return caravanSpeedMod({
      morale: this.party.morale,
      inMountains: biome === Biome.Mountain || biome === Biome.Snow,
    });
  }

  /** Settlement under a point, for caravan stops. */
  caravanPlaceAt(x: number, y: number): CaravanPlace | null {
    const node = this.settlementAt(x, y);
    return node ? { id: node.id, name: node.name } : null;
  }

  /**
   * Route the caravan to a target. `append` adds a leg from the current
   * route end (Shift+click waypoints). Passengers cannot change the route.
   */
  routeCaravanTo(target: CaravanTarget, append = false): { ok: boolean; message: string } {
    const world = this.data;
    if (!world) return { ok: false, message: 'No map yet.' };
    if (!canEditRoute(this.caravan)) {
      return { ok: false, message: 'You ride as a passenger. The leader sets the route.' };
    }
    const extend = append && hasRoute(this.caravan);
    const lastTarget = this.caravan.targets.at(-1);
    const from = extend && lastTarget ? lastTarget : { x: this.caravan.x, y: this.caravan.y };
    const plan = planRoute(world, from, target);
    const label = target.name ?? 'that spot';
    if (!plan) return { ok: false, message: `No overland route to ${label}.` };
    if (extend) {
      this.caravan = appendRoute(this.caravan, plan.points, target);
      return { ok: true, message: `Waypoint added: ${label}.` };
    }
    this.caravan = setRoute(
      this.caravan,
      plan.points,
      [target],
      this.caravanPlaceAt(this.caravan.x, this.caravan.y),
    );
    this.caravan.todayDay = Math.floor(this.clockHours / 24);
    return { ok: true, message: `Route set to ${label}.` };
  }

  clearCaravanRoute(): boolean {
    if (!canEditRoute(this.caravan)) return false;
    this.caravan = clearRoute(this.caravan);
    return true;
  }

  /** Halt or resume. Passengers cannot. */
  setCaravanHalted(halted: boolean): boolean {
    if (!canEditRoute(this.caravan)) return false;
    this.caravan = { ...this.caravan, halted };
    return true;
  }

  /** Snap the hero back onto the caravan and ride along. */
  rejoinCaravan(): void {
    this.heroAboard = true;
    this.hero = { ...this.hero, x: this.caravan.x, y: this.caravan.y, yaw: this.caravan.yaw };
    this.syncPlayer();
  }

  /** Step off the wagon to scout on foot. */
  leaveCaravan(): void {
    this.heroAboard = false;
  }

  /** Drain arrivals and stops for the HUD. */
  takeCaravanEvents(): CaravanEvent[] {
    return this.caravanEvents.splice(0, this.caravanEvents.length);
  }

  private rollCaravan(tu: number): void {
    if (this.areaHold || !(tu > 0)) return;
    this.applyRoll(advanceCaravan(this.caravan, tu, this.caravanEnv()));
  }

  private caravanEnv() {
    return {
      day: Math.floor((this.clockHours + 1e-9) / 24),
      speedAt: (x: number, y: number) => this.caravanSpeedAt(x, y),
      settlementAt: (x: number, y: number) => this.caravanPlaceAt(x, y),
    };
  }

  private applyRoll(stepped: {
    caravan: CaravanState;
    events: CaravanEvent[];
    units: number;
  }): number {
    const world = this.data;
    const moved = stepped.caravan;
    if (world) moved.x = wrapX(moved.x, world.width);
    this.caravan = moved;
    for (const event of stepped.events) this.caravanEvents.push(event);
    if (this.caravanEvents.length > 8) this.caravanEvents.splice(0, this.caravanEvents.length - 8);
    if (this.heroAboard && stepped.units > 0) {
      this.hero = { ...this.hero, x: moved.x, y: moved.y, yaw: moved.yaw };
      this.syncPlayer();
    }
    return stepped.units;
  }

  /** `travel` false for sleep: the clock jumps but the wagons stay put. */
  private addHours(hours: number, travel = true): void {
    if (!(hours > 0)) return;
    const beforeDay = Math.floor(this.clockHours / 24 + 1e-9);
    const before = Math.floor(this.clockHours * 60);
    this.clockHours += hours;
    if (travel) this.rollCaravan(hours / HOURS_PER_TU);
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
  world.caravan = createCaravan(world.hero.x, world.hero.y);
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
