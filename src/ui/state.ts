import { signal } from '@preact/signals';
import { DEFAULT_SETTINGS, type GameSettings } from '../core/state/settings';

export type UiScreen = 'boot' | 'title' | 'play';

export const screen = signal<UiScreen>('boot');
export const bootMessage = signal('Loading the road…');
export const bootError = signal<string | null>(null);
export const canContinue = signal(false);
export const settingsOpen = signal(false);
export const settings = signal<GameSettings>({ ...DEFAULT_SETTINGS });
export const clockText = signal('Day 1  08:00');
export const hint = signal('');
export const nearTown = signal(false);
export const savedFlash = signal('');

export interface UiCommands {
  newGame(): void;
  continueGame(): void;
  openSettings(): void;
  closeSettings(): void;
  changeSettings(partial: Partial<GameSettings>): void;
  save(): void;
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
};

export function bindCommands(next: UiCommands): void {
  commands.newGame = next.newGame;
  commands.continueGame = next.continueGame;
  commands.openSettings = next.openSettings;
  commands.closeSettings = next.closeSettings;
  commands.changeSettings = next.changeSettings;
  commands.save = next.save;
}
