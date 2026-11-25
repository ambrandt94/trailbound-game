import { signal } from '@preact/signals';
import type { WagonActionId, WagonRow } from '../core/sim/party';
import { DEFAULT_SEASON, type SeasonId, type SeasonPreset } from '../core/sim/day-cycle';
import { DEFAULT_SETTINGS, type GameSettings } from '../core/state/settings';

export type UiScreen = 'boot' | 'title' | 'play' | 'creator' | 'worldgen' | 'dojo';

export const screen = signal<UiScreen>('boot');
export const bootMessage = signal('Loading the road…');
export const bootError = signal<string | null>(null);
export const canContinue = signal(false);
export const settingsOpen = signal(false);
export const settings = signal<GameSettings>({ ...DEFAULT_SETTINGS });
export const clockText = signal('Day 1  08:00');
/** What the serpentine day-cycle HUD draws. Null until the game has a clock. */
export interface DayCycleView {
  /** Continuous TU left in the day, `(0, 100]`. */
  tuRemaining: number;
  day: number;
  /** Which view is up. The paused tag only belongs on the map. */
  view: 'map' | 'area';
  /** World biome id under the caravan (or the hero on foot). Null without a map. */
  biome: number | null;
}
export const dayCycle = signal<DayCycleView | null>(null);
export interface DayCycleOptions {
  season: SeasonId | SeasonPreset;
  /** Beads at the left end under pre-dawn fog. 0 is off. */
  fogUnits: number;
  /**
   * Debug: force the sky strip's biome with a biome name or recipe id
   * ('Desert', 'snow_mountains'). Null follows the biome under the party.
   */
  biome: string | null;
}
export const dayCycleOptions = signal<DayCycleOptions>({
  season: DEFAULT_SEASON,
  fogUnits: 0,
  biome: null,
});
/** Empty at the full map clock. A short multiplier while zoom has slowed time. */
export const clockRate = signal('');
/** Party supplies and the TU of the shared clock. */
export const partyHud = signal('');
/** Controls cheat-sheet text for the current view. Shown in the help panel, not always on. */
export const hint = signal('');
/** What is under the hero right now ("Wagon · Wildflower meadow"). One short always-on line in 3D. */
export const prompt = signal('');
/** Session-only: every HUD element hidden (U). The settings store keeps the panel prefs. */
export const hudHidden = signal(false);
/** The "more" popover under the toolbar. */
export const hudMenuOpen = signal(false);
/** Bumped to flash the controls panel for a few seconds, e.g. on entering 3D. */
export const hintPulse = signal(0);
export const nearTown = signal(false);
export const savedFlash = signal('');
export const notice = signal('');
export const placeName = signal('');
export const placeTier = signal('');
export const placeKind = signal('');
export const standLine = signal('');
export const nearestLine = signal('');
export const canEnter = signal(false);
export const generating = signal(false);
/** 0..1 blue wash over the 2D map at night. */
export const mapNight = signal(0);
export const wagonOpen = signal(false);
export const wagonRows = signal<WagonRow[]>([]);
/** Caravan travel readout for the map HUD. Null outside the map. */
export interface TravelHud {
  role: 'leader' | 'solo' | 'passenger';
  /** Leader or solo. A passenger cannot route, halt, or clear. */
  editable: boolean;
  hasRoute: boolean;
  halted: boolean;
  /** Hero riding with the caravan. False while scouting on foot. */
  aboard: boolean;
  day: number;
  tu: number;
  todayUnits: number;
  goalUnits: number;
  destName: string;
  waypoints: number;
  remainingUnits: number;
  /** "≈ 38 TU · Day 2, TU 12", or empty without a route. */
  eta: string;
  /** Fable speed modifier right now. */
  speed: number;
  /** The map clock is frozen: nothing is travelling. */
  clockPaused: boolean;
  /** Map HUD or the 3D convoy HUD. */
  view: 'map' | 'area';
  /** 3D convoy readout. Null on the map and in areas without a rolling route. */
  convoy: ConvoyHud | null;
}

export interface ConvoyHud {
  mode: 'walk' | 'bench' | 'free';
  /** `hint` past 30 m, `pull` while walking back past 40 m. */
  leash: 'ok' | 'hint' | 'pull';
  /** Hero to the lead wagon, metres. */
  dist: number;
  /** The wagon rolled off this zone. Follow it or return to the map. */
  gone?: boolean;
  /** The wagon is not in this zone yet: it is elsewhere on the road. */
  away?: boolean;
}
export const travelHud = signal<TravelHud | null>(null);
/** The map's planet globe: baked and usable (`ready`), and currently shown (`on`). */
export const mapGlobe = signal<{ ready: boolean; on: boolean }>({ ready: false, on: false });
/** Registered minigames, filled by the app so settings can launch them. */
export const minigameCatalog = signal<Array<{ id: string; name: string }>>([]);

export interface UiCommands {
  newGame(): void;
  continueGame(): void;
  openSettings(): void;
  closeSettings(): void;
  changeSettings(partial: Partial<GameSettings>): void;
  save(): void;
  editAvatar(): void;
  /** World Gen for the world in play, read-only (map More menu, pause menu); `flat` opens on the world map. */
  openWorldGen(view?: 'globe' | 'flat'): void;
  /** The map HUD's Chunk · Globe toggle (World opens World Gen on the world map). */
  mapView(kind: 'chunk' | 'globe'): void;
  enterPlace(): void;
  wagonAct(id: WagonActionId): void;
  closeWagon(): void;
  launchMinigame(id: string): void;
  clearRoute(): void;
  toggleHalt(): void;
  rejoinCaravan(): void;
  fitRoute(): void;
  openWagon(): void;
  /** 3D convoy: sit on the wagon bench, or step down to walk beside it. */
  toggleBench(): void;
  /** 3D convoy: walk back to the wagon. */
  rejoinWagon(): void;
  /** Title → the combat dojo. Does not load a save. */
  openDojo(): void;
  /** Dojo → title. */
  leaveDojo(): void;
}

export const commands: UiCommands = {
  newGame() {
    return;
  },
  continueGame() {
    return;
  },
  openSettings() {
    return;
  },
  closeSettings() {
    return;
  },
  changeSettings(_partial: Partial<GameSettings>) {
    return;
  },
  save() {
    return;
  },
  editAvatar() {
    return;
  },
  openWorldGen(_view?: 'globe' | 'flat') {
    return;
  },
  mapView(_kind: 'chunk' | 'globe') {
    return;
  },
  enterPlace() {
    return;
  },
  wagonAct(_id: WagonActionId) {
    return;
  },
  closeWagon() {
    return;
  },
  launchMinigame(_id: string) {
    return;
  },
  clearRoute() {
    return;
  },
  toggleHalt() {
    return;
  },
  rejoinCaravan() {
    return;
  },
  fitRoute() {
    return;
  },
  toggleBench() {
    return;
  },
  rejoinWagon() {
    return;
  },
  openWagon() {
    return;
  },
  openDojo() {
    return;
  },
  leaveDojo() {
    return;
  },
};

export function bindCommands(next: UiCommands): void {
  commands.newGame = next.newGame;
  commands.continueGame = next.continueGame;
  commands.openSettings = next.openSettings;
  commands.closeSettings = next.closeSettings;
  commands.changeSettings = next.changeSettings;
  commands.save = next.save;
  commands.editAvatar = next.editAvatar;
  commands.openWorldGen = next.openWorldGen;
  commands.mapView = next.mapView;
  commands.enterPlace = next.enterPlace;
  commands.wagonAct = next.wagonAct;
  commands.closeWagon = next.closeWagon;
  commands.launchMinigame = next.launchMinigame;
  commands.clearRoute = next.clearRoute;
  commands.toggleHalt = next.toggleHalt;
  commands.rejoinCaravan = next.rejoinCaravan;
  commands.fitRoute = next.fitRoute;
  commands.openWagon = next.openWagon;
  commands.toggleBench = next.toggleBench;
  commands.rejoinWagon = next.rejoinWagon;
  commands.openDojo = next.openDojo;
  commands.leaveDojo = next.leaveDojo;
}
