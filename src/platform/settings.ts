import { DEFAULT_SETTINGS, normalizeSettings, type GameSettings } from '../core/state/settings';

export interface SettingsStore {
  load(): GameSettings;
  save(next: GameSettings): void;
}

/** Preferences only. World saves go through SaveBackend, never localStorage. */
export const SETTINGS_KEY = 'tb-settings';

export function createMemorySettings(initial?: GameSettings): SettingsStore {
  let current = normalizeSettings(initial ?? DEFAULT_SETTINGS);
  return {
    load: () => normalizeSettings(current),
    save(next: GameSettings) {
      current = normalizeSettings(next);
    },
  };
}

export function createBrowserSettings(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null,
): SettingsStore {
  if (!storage) return createMemorySettings();
  return {
    load() {
      try {
        const raw = storage.getItem(SETTINGS_KEY);
        if (!raw) return normalizeSettings(DEFAULT_SETTINGS);
        return normalizeSettings(JSON.parse(raw) as unknown);
      } catch {
        return normalizeSettings(DEFAULT_SETTINGS);
      }
    },
    save(next: GameSettings) {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(next)));
    },
  };
}
