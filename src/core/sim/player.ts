import type { Facing, PlayerState } from '../world/models';

/** Local walker id. Matches the frozen map's hero id. */
export const LOCAL_PLAYER_ID = 'local';
export const DEFAULT_HERO_NAME = 'Wren';
export const DEFAULT_HERO_SHEET = 'townsfolk';
export const DEFAULT_HERO_CHAR = 0;

export function clampHeroName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  return name || DEFAULT_HERO_NAME;
}

export function defaultPlayerState(pos: { x: number; y: number } = { x: 80, y: 80 }): PlayerState {
  return {
    id: LOCAL_PLAYER_ID,
    name: DEFAULT_HERO_NAME,
    x: pos.x,
    y: pos.y,
    facing: 0 satisfies Facing,
    frame: 1,
    anim: 0,
    sheet: DEFAULT_HERO_SHEET,
    char: DEFAULT_HERO_CHAR,
  };
}
