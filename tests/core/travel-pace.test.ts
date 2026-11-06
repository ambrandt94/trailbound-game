import { expect, test } from 'vitest';
import {
  DETAIL_END,
  MAP_WALK_SCREEN_PX,
  METERS_PER_WORLD_TILE,
  TILE,
  WALK_SPEED_GLOBE,
  clockTravelTilesPerSec,
  formatMapClockRate,
  mapClockHoursPerRealSec,
  mapClockScale,
  paceMps,
  playerWalkSpeed,
  sprintPaceRatio,
  travelChargePaceMps,
  travelGameHours,
  travelPaceHint,
  travelSpeedTilesPerSec,
} from '../../src/core/world/models';

test('kingdom zoom keeps the full clock and street zoom slows it to a steady screen speed', () => {
  const clock = clockTravelTilesPerSec(false);
  for (const scale of [0.016, 0.02, 0.05]) {
    expect(mapClockScale(scale)).toBe(1);
    expect(playerWalkSpeed(scale, false)).toBeCloseTo(clock, 6);
    expect(travelSpeedTilesPerSec('overworld', false, scale)).toBeCloseTo(clock, 6);
    expect(formatMapClockRate(scale)).toBe('');
  }
  expect(playerWalkSpeed(0.02, false)).toBe(playerWalkSpeed(0.05, false));
  for (const scale of [1, DETAIL_END, 9, 32, 160]) {
    const tiles = playerWalkSpeed(scale, false);
    expect(tiles).toBeLessThan(clock);
    expect(tiles * scale * TILE).toBeCloseTo(MAP_WALK_SCREEN_PX, 4);
    expect(travelSpeedTilesPerSec('street', false, scale)).toBeCloseTo(tiles, 6);
    expect(mapClockHoursPerRealSec(scale)).toBeCloseTo((8 / 60) * mapClockScale(scale), 8);
    expect(formatMapClockRate(scale).startsWith('×')).toBe(true);
  }
});

test('sprint stays double the walk at the same zoom', () => {
  expect(playerWalkSpeed(9, true)).toBeCloseTo(playerWalkSpeed(9, false) * sprintPaceRatio(), 6);
  expect(playerWalkSpeed(0.02, true)).toBeCloseTo(playerWalkSpeed(0.02, false) * 2, 6);
  expect(playerWalkSpeed(0.02, true)).not.toBeCloseTo(playerWalkSpeed(80, true), 1);
  expect(clockTravelTilesPerSec(true)).toBeCloseTo(clockTravelTilesPerSec(false) * 2, 6);
  expect(clockTravelTilesPerSec(true, 32)).toBeCloseTo(clockTravelTilesPerSec(false, 32) * 2, 6);
});

test('travel time charges 5 or 10 km/h no matter the camera scale', () => {
  const far = travelChargePaceMps(0.016, false);
  const street = travelChargePaceMps(DETAIL_END, true);
  expect(far).toBeCloseTo(paceMps(false), 8);
  expect(street).toBeCloseTo(paceMps(true), 8);
  const metres = 106;
  expect(travelGameHours(metres, travelChargePaceMps(0.2, false))).toBeCloseTo(
    travelGameHours(metres, travelChargePaceMps(40, false)),
    8,
  );
  expect(travelGameHours(METERS_PER_WORLD_TILE, paceMps(false))).toBeGreaterThan(0);
});

test('globe pan stays on its own speed and the hint is the clock pace', () => {
  expect(travelSpeedTilesPerSec('globe', false, 0.01)).toBe(WALK_SPEED_GLOBE);
  expect(travelSpeedTilesPerSec('globe', true, 12)).toBeCloseTo(WALK_SPEED_GLOBE * 2, 6);
  expect(travelPaceHint(0.02)).toBe(travelPaceHint(20));
  expect(travelPaceHint(1)).toContain('5 km/h');
  expect(travelPaceHint(1)).toContain('10 km/h');
  expect(travelPaceHint(9)).not.toContain('street');
});
