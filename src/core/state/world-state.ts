import { defaultPlayerAvatar, isPlayerAvatar } from '../people/avatar';
import type { PlayerAvatar } from '../people/avatar';
import { DEFAULT_WORLD_SEED } from '../world/index';
import { GAME_HOURS_PER_REAL_SECOND, START_HOUR } from '../sim/clock';
import type { CfPin, PackedWorld, PlayerSave } from '../save/types';

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

  advanceClock(realSeconds: number): void {
    if (!(realSeconds > 0)) return;
    const before = Math.floor(this.clockHours * 60);
    this.clockHours += realSeconds * GAME_HOURS_PER_REAL_SECOND;
    const after = Math.floor(this.clockHours * 60);
    if (after !== before) this.record({ type: 'clock-tick', rev: this.bump() });
  }

  /** Drop the hero just outside the town on the side they left the 3D area. */
  placeHeroOutside(exit: AreaExit): void {
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

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
