import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/state/settings';

test('voices default to 40 and mute is off', () => {
  expect(DEFAULT_SETTINGS.mapSkin).toBe('classic');
  expect(normalizeSettings({}).mapSkin).toBe('classic');
  expect(normalizeSettings({ mapSkin: 'trailbound48' }).mapSkin).toBe('trailbound48');
  expect(DEFAULT_SETTINGS.voices).toBe(40);
  expect(DEFAULT_SETTINGS.muteVoices).toBe(false);
  expect(normalizeSettings({}).voices).toBe(40);
  expect(normalizeSettings(null).muteVoices).toBe(false);
});

test('volumes clamp and mute stays a boolean', () => {
  const next = normalizeSettings({ voices: 140, master: -4, muteVoices: true, music: 12.4 });
  expect(next.voices).toBe(100);
  expect(next.master).toBe(0);
  expect(next.music).toBe(12);
  expect(next.muteVoices).toBe(true);
  expect(normalizeSettings({ voices: 'loud' }).voices).toBe(40);
});
