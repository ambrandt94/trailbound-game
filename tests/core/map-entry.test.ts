import { expect, test } from 'vitest';
import {
  MAP_ENTRY_COOLDOWN_SEC,
  MAP_RETURN_ZOOM,
  stepEntryCooldown,
  zoomAfterArea,
} from '../../src/core/world/map-zoom';
import { MAP_ZOOM_CAP } from '../../src/core/world/models';

test('leaving 3D eases a capped camera under the zoom cap', () => {
  expect(MAP_RETURN_ZOOM).toBeLessThan(MAP_ZOOM_CAP);
  expect(MAP_RETURN_ZOOM).toBeGreaterThan(MAP_ZOOM_CAP * 0.7);
  expect(zoomAfterArea(MAP_ZOOM_CAP)).toBe(MAP_RETURN_ZOOM);
  expect(zoomAfterArea(MAP_ZOOM_CAP - 1e-6)).toBe(MAP_RETURN_ZOOM);
  expect(zoomAfterArea(1.4)).toBe(1.4);
});

test('the entry cooldown swallows about half a second and then opens', () => {
  expect(MAP_ENTRY_COOLDOWN_SEC).toBeCloseTo(0.5, 5);
  expect(stepEntryCooldown(0.5, 0.2)).toBeCloseTo(0.3, 5);
  expect(stepEntryCooldown(0.1, 0.4)).toBe(0);
  expect(stepEntryCooldown(0, 1)).toBe(0);
  let left = MAP_ENTRY_COOLDOWN_SEC;
  left = stepEntryCooldown(left, 0.5);
  expect(left).toBe(0);
});
