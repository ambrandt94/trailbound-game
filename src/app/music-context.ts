import { describeMapStand } from '../core/area/area-window';
import type { MusicContext } from '../core/music/context';
import { hasRoute } from '../core/sim/caravan';
import { dayBand, tuOfDay } from '../core/sim/time';
import type { WorldState } from '../core/state/world-state';
import { biomeAtTile } from '../core/world/biome-at';
import type { AppMode } from './host';

export interface MusicContextInput {
  mode: AppMode;
  view: 'map' | 'area';
  world: Pick<WorldState, 'data' | 'heroAboard' | 'caravan' | 'hero' | 'clockHours'>;
  minigameOpen: boolean;
}

/**
 * What the soundtrack should react to, read from game state only.
 * Null while booting: nothing plays yet and nothing should change.
 * The biome comes from the same call the day-cycle HUD uses: under the caravan,
 * or under the hero when scouting on foot.
 */
export function buildMusicContext(input: MusicContextInput): MusicContext | null {
  const { mode, view, world } = input;
  if (mode === 'boot') return null;
  if (mode === 'title' || mode === 'creator') {
    return {
      scene: 'title',
      place: null,
      biome: null,
      night: false,
      camp: false,
      minigame: false,
    };
  }
  if (mode === 'worldgen') {
    return {
      scene: 'worldgen',
      place: null,
      biome: null,
      night: false,
      camp: false,
      minigame: false,
    };
  }
  const party = world.heroAboard ? world.caravan : world.hero;
  const scene = view === 'area' ? 'area' : 'map';
  let place: string | null = null;
  if (world.data) {
    const kind = describeMapStand(world.data, party.x, party.y).kind;
    place = kind === 'wilderness' || kind === 'water' ? null : kind;
  } else if (scene === 'area') {
    // A town fixture has no world map under it: it is a town.
    place = 'town';
  }
  return {
    scene,
    place,
    biome: biomeAtTile(world.data, party.x, party.y),
    night: dayBand(tuOfDay(world.clockHours)) === 'night',
    camp: hasRoute(world.caravan) && world.caravan.halted,
    minigame: input.minigameOpen,
  };
}
