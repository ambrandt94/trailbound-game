import { expect, test } from 'vitest';
import {
  DEFAULT_AREA_LOOK,
  ORIGINAL_VISUAL_KEYS,
  applyFeelPreset,
  fieldsInGroup,
  normalizeAreaLook,
  visualNumbers,
} from '../../src/core/state/area-look';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/state/settings';
import { createMemorySettings } from '../../src/platform/settings';

test('every original visual control is in the settings schema', () => {
  const keys = new Set(fieldsInGroup('Pixelation').map((field) => field.key));
  for (const group of [
    'Outlines',
    'Lighting',
    'Color grading',
    'Atmosphere',
    'Textures',
    'Camera',
    'World',
    'Debug',
  ] as const) {
    for (const field of fieldsInGroup(group)) keys.add(field.key);
  }
  for (const key of ORIGINAL_VISUAL_KEYS) expect(keys.has(key)).toBe(true);
  expect(DEFAULT_AREA_LOOK.px).toBe(2);
  expect(DEFAULT_AREA_LOOK.camDist).toBe(60);
  expect(DEFAULT_AREA_LOOK.fog).toBe(1);
  expect(DEFAULT_AREA_LOOK.outline).toBe(true);
  expect(DEFAULT_AREA_LOOK.walkMps).toBe(1.6);
  expect(DEFAULT_AREA_LOOK.sprintMps).toBe(5.5);
  expect(normalizeAreaLook({ maxSpeed: 9 }).walkMps).toBe(1.6);
});

test('saved looks clamp and old saves without a look keep the shipped defaults', () => {
  expect(normalizeSettings({}).look.camDist).toBe(60);
  expect(normalizeSettings({ look: { camDist: 500, fog: -2, grass: 'nope' } }).look).toMatchObject({
    camDist: 80,
    fog: 0,
    grass: '#ffffff',
    px: 2,
  });
  const next = normalizeSettings({
    look: { px: 4, litDither: false, litPat: 1, camYaw: 10.25, fps: 1 },
  });
  expect(next.look.px).toBe(4);
  expect(next.look.litDither).toBe(false);
  expect(next.look.litPat).toBe(1);
  expect(next.look.camYaw).toBe(10.25);
  expect(next.look.fps).toBe(true);
  expect(visualNumbers(next.look).litDither).toBe(0);
  expect(visualNumbers(next.look).fps).toBe(1);
  expect(visualNumbers(next.look).px).toBe(4);
});

test('the settings store round-trips the 3D look', () => {
  const store = createMemorySettings();
  expect(store.load().look).toEqual(DEFAULT_SETTINGS.look);
  const look = normalizeAreaLook({
    ...DEFAULT_AREA_LOOK,
    dither: 0.2,
    camDist: 9,
    camPitch: 42,
    camFov: 36,
    camLag: 0.1,
  });
  store.save({ ...store.load(), look });
  expect(store.load().look.dither).toBeCloseTo(0.2);
  expect(store.load().look.camDist).toBe(9);
  expect(store.load().master).toBe(DEFAULT_SETTINGS.master);
});

test('feel presets restore the controller sidebar values', () => {
  const tuned = normalizeAreaLook({ ...DEFAULT_AREA_LOOK, maxSpeed: 9, camDist: 4 });
  const souls = applyFeelPreset(tuned, 'Souls-like');
  expect(souls.feelPreset).toBe('Souls-like');
  expect(souls.walkMps).toBe(1.3);
  expect(souls.sprintMps).toBe(4.4);
  expect(souls.camDist).toBe(11);
  expect(souls.turn).toBe(7);
  expect(souls.px).toBe(2);
  const back = applyFeelPreset(souls, 'Default');
  expect(back.walkMps).toBe(DEFAULT_AREA_LOOK.walkMps);
  expect(back.sprintMps).toBe(DEFAULT_AREA_LOOK.sprintMps);
  expect(back.camDist).toBe(DEFAULT_AREA_LOOK.camDist);
  expect(back.camYaw).toBe(45);
});
