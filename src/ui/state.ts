import { signal } from '@preact/signals';
import type { WagonActionId, WagonRow } from '../core/sim/party';
import { DEFAULT_SETTINGS, type GameSettings } from '../core/state/settings';

export type UiScreen = 'boot' | 'title' | 'play' | 'creator';

export const screen = signal<UiScreen>('boot');
export const bootMessage = signal('Loading the road…');
export const bootError = signal<string | null>(null);
export const canContinue = signal(false);
export const settingsOpen = signal(false);
export const settings = signal<GameSettings>({ ...DEFAULT_SETTINGS });
export const clockText = signal('Day 1  08:00');
/** Empty at the full map clock. A short multiplier while zoom has slowed time. */
export const clockRate = signal('');
/** Party supplies and the TU of the shared clock. */
export const partyHud = signal('');
export const hint = signal('');
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

export interface UiCommands {
  newGame(): void;
  continueGame(): void;
  openSettings(): void;
  closeSettings(): void;
  changeSettings(partial: Partial<GameSettings>): void;
  save(): void;
  editAvatar(): void;
  enterPlace(): void;
  wagonAct(id: WagonActionId): void;
  closeWagon(): void;
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
  enterPlace() {
    return;
  },
  wagonAct(_id: WagonActionId) {
    return;
  },
  closeWagon() {
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
  commands.enterPlace = next.enterPlace;
  commands.wagonAct = next.wagonAct;
  commands.closeWagon = next.closeWagon;
}
