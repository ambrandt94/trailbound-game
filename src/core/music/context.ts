/** What the game is doing right now, as far as the soundtrack cares. */
export interface MusicContext {
  /** Which screen is up. The map and 3D zones are the two play views. */
  scene: 'title' | 'map' | 'area';
  /**
   * Kind of place under the party: a settlement kind (`city`, `town`, `village`,
   * `hamlet`, `grove`, `camp`, `shore`, ...), a POI kind, or null in open country.
   * It is `describeMapStand(...).kind`, minus `wilderness` and `water`.
   */
  place: string | null;
  /** World biome id under the caravan (or the hero on foot). Same source as the day-cycle HUD. */
  biome: number | null;
  /** From the shared day-cycle clock. */
  night: boolean;
  /** The caravan is halted (camp). */
  camp: boolean;
  /** A minigame is open. */
  minigame: boolean;
}

export const DEFAULT_MUSIC_CONTEXT: MusicContext = {
  scene: 'map',
  place: null,
  biome: null,
  night: false,
  camp: false,
  minigame: false,
};

/** Coarse class of the context. A change of class is a real scene change, not a flicker. */
export type MusicSceneClass = 'title' | 'minigame' | 'camp' | 'town' | 'map' | 'travel';
