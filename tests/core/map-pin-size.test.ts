import { expect, test } from 'vitest';
import { showsZonePreview } from '../../src/core/area/zone-history';
import {
  CLOSE_MARKER_SCALE,
  MAP_PIN_MIN_PROMINENT_PX,
  MAP_PIN_MIN_PX,
  MAP_PIN_PROMINENT_PX,
  MAP_PIN_PX,
  mapPinScreenPx,
} from '../../src/core/world/map-grid';
import { MAP_ZOOM_CAP, minScaleFor, WORLD_BASE } from '../../src/core/world/models';

test('map pins are full size from the close zoom in', () => {
  expect(mapPinScreenPx(CLOSE_MARKER_SCALE, false)).toBe(MAP_PIN_PX);
  expect(mapPinScreenPx(MAP_ZOOM_CAP, false)).toBe(MAP_PIN_PX);
  expect(mapPinScreenPx(MAP_ZOOM_CAP, true)).toBe(MAP_PIN_PROMINENT_PX);
});

test('map pins shrink as the map zooms out, down to a small minimum', () => {
  const out = minScaleFor(WORLD_BASE);
  expect(mapPinScreenPx(out, false)).toBe(MAP_PIN_MIN_PX);
  expect(mapPinScreenPx(out, true)).toBe(MAP_PIN_MIN_PROMINENT_PX);
  expect(mapPinScreenPx(0, false)).toBe(MAP_PIN_MIN_PX);
  let last = Infinity;
  for (const scale of [1.2, 0.9, 0.6, 0.4, 0.25, 0.15, 0.09]) {
    const px = mapPinScreenPx(scale, false);
    expect(px).toBeLessThanOrEqual(last);
    last = px;
  }
  const mid = mapPinScreenPx(0.6, false);
  expect(mid).toBeGreaterThan(MAP_PIN_MIN_PX);
  expect(mid).toBeLessThan(MAP_PIN_PX);
});

test('the zone preview hides over a town and shows elsewhere', () => {
  expect(showsZonePreview('town')).toBe(false);
  expect(showsZonePreview('grid')).toBe(true);
  expect(showsZonePreview('lean')).toBe(true);
  expect(showsZonePreview('remembered')).toBe(true);
});
