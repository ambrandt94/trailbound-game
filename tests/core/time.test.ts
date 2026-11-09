import { expect, test } from 'vitest';
import { GAME_HOURS_PER_REAL_SECOND, START_HOUR } from '../../src/core/sim/clock';
import {
  AREA_TIME_SCALE,
  HOURS_PER_TU,
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
  const night = dayLightAt(21);
  expect(day.band).toBe('day');
  expect(night.band).toBe('night');
  expect(night.sunIntensity).toBeGreaterThan(0.2);
  expect(night.sunIntensity).toBeLessThan(day.sunIntensity);
  expect(night.skyTop).not.toBe('#000000');
  expect(night.mapNight).toBeGreaterThan(day.mapNight);
  const edge = dayLightAt((10 / 100) * 24);
  expect(edge.band).toBe('day');
  expect(edge.sunHour).toBeGreaterThan(dayLightAt(1).sunHour);
  const deep = dayLightAt(22);
  expect(deep.band).toBe('night');
  expect(deep.sunHour).toBeLessThan(6);
  expect(deep.sunIntensity).toBeLessThan(0.7);
});

test('areas run at about a third of the map clock', () => {
  expect(AREA_TIME_SCALE).toBeGreaterThan(0.3);
  expect(AREA_TIME_SCALE).toBeLessThan(0.36);
  expect(areaHoursPerRealSec()).toBeCloseTo(GAME_HOURS_PER_REAL_SECOND * AREA_TIME_SCALE, 6);
});

test('sleep lands on the next dawn, which is the next midnight', () => {
  expect(hoursUntilNextDawn(21.6)).toBeCloseTo(2.4, 5);
  expect(hoursUntilNextDawn(0)).toBe(24);
  expect(hoursUntilNextDawn(24)).toBe(24);
});
