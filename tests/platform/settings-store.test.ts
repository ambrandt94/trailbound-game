import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/state/settings';
import {
  createBrowserSettings,
  createMemorySettings,
  SETTINGS_KEY,
} from '../../src/platform/settings';

test('memory settings keep the voices default and round-trip', () => {
  const store = createMemorySettings();
  expect(store.load().voices).toBe(40);
  store.save({ ...DEFAULT_SETTINGS, voices: 15, muteVoices: true });
  expect(store.load()).toMatchObject({ voices: 15, muteVoices: true });
});

test('browser settings persist in the provided storage and ignore junk', () => {
  const bag = new Map<string, string>();
  const storage = {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => {
      bag.set(key, value);
    },
  };
  const store = createBrowserSettings(storage);
  expect(store.load().voices).toBe(DEFAULT_SETTINGS.voices);
  store.save({ ...store.load(), voices: 22 });
  expect(bag.get(SETTINGS_KEY)).toContain('"voices":22');
  bag.set(SETTINGS_KEY, '{not json');
  expect(createBrowserSettings(storage).load().voices).toBe(40);
});
