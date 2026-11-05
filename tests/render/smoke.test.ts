import { expect, test } from 'vitest';
import { cellColor } from '../../src/render/map/grid';
import { MapRenderer } from '../../src/render/map/map-renderer';

test('seeded map cells vary and the renderer can paint a canvas', () => {
  const colors = new Set([0, 1, 2, 3, 4, 5].map((index) => cellColor(index, index * 2, 7741)));
  expect(colors.size).toBeGreaterThan(1);
  expect(cellColor(2, 3, 7741)).toBe(cellColor(2, 3, 7741));

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 96;
  document.body.append(canvas);
  const renderer = new MapRenderer(canvas);
  expect(() =>
    renderer.draw({
      seed: 7741,
      heroX: 5.5,
      heroY: 8,
      heroYaw: 0,
      townX: 8,
      townY: 8,
      townName: 'Waystead',
    }),
  ).not.toThrow();
  renderer.dispose();
  expect(renderer.isDisposed).toBe(true);
});
