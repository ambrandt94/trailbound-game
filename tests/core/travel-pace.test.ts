import { expect, test } from 'vitest';
import {
  DETAIL_END,
  DETAIL_START,
  METERS_PER_WORLD_TILE,
  WALK_SPEED_GLOBE,
  clockTravelTilesPerSec,
  paceMps,
  playerWalkSpeed,
  sprintPaceRatio,
  travelChargePaceMps,
  travelGameHours,
  travelPaceHint,
  travelSpeedTilesPerSec,
} from '../../src/core/world/models';

test('world-map walk speed is the clock pace at every zoom', () => {
  const clock = clockTravelTilesPerSec(false);
  const scales = [0.016, 0.2, 1, DETAIL_START - 0.05, DETAIL_START, DETAIL_END, 32, 160];
  for (const scale of scales) {
    expect(playerWalkSpeed(scale, false)).toBeCloseTo(clock, 6);
    expect(travelSpeedTilesPerSec('overworld', false, scale)).toBeCloseTo(clock, 6);
    expect(travelSpeedTilesPerSec('street', false, scale)).toBeCloseTo(clock, 6);
  }
  expect(playerWalkSpeed(0.02, false)).toBe(playerWalkSpeed(80, false));
});

test('sprint stays double the walk and still ignores zoom', () => {
  const walk = playerWalkSpeed(0.2, false);
  const sprint = playerWalkSpeed(9, true);
  expect(sprint).toBeCloseTo(walk * sprintPaceRatio(), 6);
  expect(playerWalkSpeed(0.02, true)).toBe(playerWalkSpeed(80, true));
  expect(clockTravelTilesPerSec(true)).toBeCloseTo(clockTravelTilesPerSec(false) * 2, 6);
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
