import { expect, test } from 'vitest';
import * as THREE from 'three';
import { AREA_GROUND_COLOR, createAreaContent } from '../../src/render/area/area-content';
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

test('area content builds a lit cube, ground, and pawn without a black ground', () => {
  const content = createAreaContent();
  expect(content.cube).toBeInstanceOf(THREE.Mesh);
  expect(content.ground).toBeInstanceOf(THREE.Mesh);
  expect(content.pawn).toBeInstanceOf(THREE.Mesh);
  const lights = content.scene.children.filter((child) => child instanceof THREE.Light);
  expect(lights.length).toBeGreaterThanOrEqual(2);
  const material = content.ground.material;
  if (!(material instanceof THREE.MeshLambertMaterial)) throw new Error('expected lambert ground');
  expect(`#${material.color.getHexString()}`).toBe(AREA_GROUND_COLOR);
  expect(material.color.getHexString()).not.toBe('000000');
  const background = content.scene.background;
  if (!(background instanceof THREE.Color)) throw new Error('expected a sky color');
  expect(background.getHexString()).not.toBe('000000');
  content.dispose();
});
