import { expect, test } from 'vitest';
import { GAME_HOURS_PER_REAL_SECOND, START_HOUR } from '../../src/core/sim/clock';
import {
  AREA_TIME_SCALE,
  HEMI_SKY_COOL,
  HOURS_PER_TU,
  KEY_LIGHT_COOL,
  TU_PER_DAY,
  areaHoursPerRealSec,
  dayBand,
  dayLightAt,
  hoursForTu,
  hoursUntilNextDawn,
  tuOfDay,
} from '../../src/core/sim/time';

test('a day of 24 hours is 100 TU on the same clock', () => {
  expect(hoursForTu(TU_PER_DAY)).toBeCloseTo(24, 6);
  expect(HOURS_PER_TU * TU_PER_DAY).toBeCloseTo(24, 6);
  expect(tuOfDay(0)).toBe(0);
  expect(tuOfDay(24)).toBe(0);
  expect(tuOfDay(START_HOUR)).toBeCloseTo((START_HOUR / 24) * 100, 5);
  expect(tuOfDay(-1)).toBeCloseTo(tuOfDay(23), 5);
});

test('lighting bands follow TU, and night stays a readable blue', () => {
  expect(dayBand(0)).toBe('dawn');
  expect(dayBand(9.9)).toBe('dawn');
  expect(dayBand(10)).toBe('day');
  expect(dayBand(59.9)).toBe('day');
  expect(dayBand(60)).toBe('dusk');
  expect(dayBand(74.9)).toBe('dusk');
  expect(dayBand(75)).toBe('night');
  expect(dayBand(99)).toBe('night');
  const day = dayLightAt(12);
  const dusk = dayLightAt(16.8);
  const night = dayLightAt(22);
  expect(day.band).toBe('day');
  expect(dusk.band).toBe('dusk');
  expect(night.band).toBe('night');
  expect(dusk.sunWarmth).toBeGreaterThan(0.7);
  expect(dusk.sunIntensity).toBeLessThan(day.sunIntensity);
  expect(dusk.sunIntensity).toBeGreaterThan(night.sunIntensity);
  expect(night.sunIntensity).toBeGreaterThan(0.18);
  expect(night.sunIntensity).toBeLessThan(0.36);
  expect(night.hemi).toBeLessThan(day.hemi);
  expect(night.hemi).toBeGreaterThan(0.16);
  expect(night.sunWarmth).toBeLessThan(-0.6);
  expect(night.sunWarmth).toBeGreaterThan(-0.92);
  expect(night.shadeCool).toBeGreaterThan(1);
  expect(night.shadeCool).toBeLessThan(1.35);
  expect(night.shadowSoft).toBeGreaterThan(1.6);
  expect(night.shadowSoft).toBeLessThan(2.8);
  expect(night.skyTop).not.toBe('#000000');
  const nightSky = Number.parseInt(night.skyTop.slice(5, 7), 16);
  const nightRed = Number.parseInt(night.skyTop.slice(1, 3), 16);
  expect(nightSky).toBeGreaterThan(nightRed);
  expect(night.mapNight).toBeGreaterThan(day.mapNight);
  const edge = dayLightAt((10 / 100) * 24);
  expect(edge.band).toBe('day');
  expect(edge.sunHour).toBeGreaterThan(dayLightAt(1).sunHour);
  expect(night.sunHour).toBeLessThan(6);
});

test('areas run at about a third of the map clock', () => {
  expect(AREA_TIME_SCALE).toBeGreaterThan(0.3);
  expect(AREA_TIME_SCALE).toBeLessThan(0.36);
  expect(areaHoursPerRealSec()).toBeCloseTo(GAME_HOURS_PER_REAL_SECOND * AREA_TIME_SCALE, 6);
});

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Spread of the channels. Near-white tints stay low; a cobalt grade does not. */
function chroma(hex: string): number {
  const [r, g, b] = channels(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function luma(hex: string): number {
  const [r, g, b] = channels(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Hot magenta is both red and blue sitting well above green. */
function magenta(hex: string): boolean {
  const [r, g, b] = channels(hex);
  return r > g + 12 && b > g + 12;
}

test('night grade stays cool and readable, and the ground never crosses magenta', () => {
  const night = dayLightAt(22);
  const day = dayLightAt(12);
  /* The cel shader rotates shadow hue by shHue (20°) times shadeCool.
     Past ~30° warm roofs swing through magenta and grass through cyan. */
  expect(night.shadeCool * 20).toBeLessThan(27);
  expect(night.sunIntensity).toBeGreaterThan(day.sunIntensity * 0.18);
  expect(night.sunIntensity).toBeLessThan(day.sunIntensity * 0.45);
  expect(night.hemi).toBeLessThan(day.hemi * 0.55);
  expect(chroma(night.grass)).toBeLessThan(0.08);
  expect(luma(night.grass)).toBeGreaterThan(0.88);
  expect(luma(night.skyTop)).toBeGreaterThan(0.07);
  expect(luma(night.skyTop)).toBeLessThan(0.16);
  const [skyR, , skyB] = channels(night.skyTop);
  expect(skyB).toBeGreaterThan(skyR + 24);
  expect(luma(night.haze)).toBeGreaterThan(0.16);
  expect(luma(night.haze)).toBeLessThan(0.4);
  expect(night.fog).toBeGreaterThan(0.9);
  expect(night.fog).toBeLessThan(1.35);
  expect(night.bright).toBeGreaterThan(0.32);
  expect(night.bright).toBeLessThan(0.6);
  expect(day.bright).toBeGreaterThan(0.95);
  expect(chroma(KEY_LIGHT_COOL)).toBeLessThan(0.25);
  const [keyR, , keyB] = channels(KEY_LIGHT_COOL);
  expect(keyB).toBeGreaterThan(keyR);
  expect(luma(KEY_LIGHT_COOL)).toBeGreaterThan(0.8);
  expect(chroma(HEMI_SKY_COOL)).toBeLessThan(0.35);
  expect(luma(HEMI_SKY_COOL)).toBeGreaterThan(0.55);

  for (let hour = 0; hour < 24; hour += 0.25) {
    const light = dayLightAt(hour);
    expect(magenta(light.grass), `grass ${light.grass} at ${hour}`).toBe(false);
    expect(magenta(light.haze), `haze ${light.haze} at ${hour}`).toBe(false);
  }
});

test('sleep lands on the next dawn, which is the next midnight', () => {
  expect(hoursUntilNextDawn(21.6)).toBeCloseTo(2.4, 5);
  expect(hoursUntilNextDawn(0)).toBe(24);
  expect(hoursUntilNextDawn(24)).toBe(24);
});
