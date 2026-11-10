import type { MinigameDef } from './types';

const games = new Map<string, MinigameDef>();

export function registerMinigame(def: MinigameDef): void {
  if (games.has(def.id)) throw new Error(`minigame ${def.id} is already registered`);
  games.set(def.id, def);
}

export function getMinigame(id: string): MinigameDef | undefined {
  return games.get(id);
}

export function listMinigames(): MinigameDef[] {
  return [...games.values()];
}

/** Test hook. Production boot registers once. */
export function clearMinigames(): void {
  games.clear();
}
