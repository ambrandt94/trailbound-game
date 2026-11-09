import { expect, test } from 'vitest';
import {
  MAP_WALK_SCREEN_PX,
  MAP_ZOOM_CAP,
  TILE,
  formatMapClockRate,
  mapClockScale,
  playerWalkSpeed,
} from '../../src/core/world/models';

test('at the zoom cap the clock is slow enough to stop and not the old street extreme', () => {
  const tiles = playerWalkSpeed(MAP_ZOOM_CAP, false);
  expect(tiles).toBeGreaterThan(1);
  expect(tiles).toBeLessThan(4);
  expect(tiles * MAP_ZOOM_CAP * TILE).toBeCloseTo(MAP_WALK_SCREEN_PX, 4);
  expect(mapClockScale(MAP_ZOOM_CAP)).toBeGreaterThan(0.02);
  expect(mapClockScale(MAP_ZOOM_CAP)).toBeGreaterThan(mapClockScale(10));
  expect(formatMapClockRate(MAP_ZOOM_CAP)).toBe('×0.03');
  expect(formatMapClockRate(0.02)).toBe('');
});
