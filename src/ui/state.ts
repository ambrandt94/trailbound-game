import { signal } from '@preact/signals';
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
/** 0..1 ring while zoom-in at the cap is committing to 3D. */
export const diveIntent = signal(0);
/** 0..1 edge darkening near the zoom cap and during the dive. */
export const diveCue = signal(0);
export const hint = signal('');
export const nearTown = signal(false);
export const savedFlash = signal('');
export const placeName = signal('');
export const placeTier = signal('');
export const placeKind = signal('');
export const canEnter = signal(false);
export const generating = signal(false);

export interface UiCommands {
  newGame(): void;
  continueGame(): void;
  openSettings(): void;
  closeSettings(): void;
  changeSettings(partial: Partial<GameSettings>): void;
  save(): void;
  editAvatar(): void;
  enterPlace(): void;
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
}
