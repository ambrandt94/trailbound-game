import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { buildAreaExport } from '../../src/core/area/build-area';
import { Biome, DEFAULT_WORLD_SETTINGS } from '../../src/core/world/models';
import { generateWorld } from '../../src/core/world/world-gen';

interface GoldenSettlement {
  id: string;
  name: string;
  kind: string;
  origin: string;
  biome: string;
  cx: number;
  cy: number;
  radius: number;
  seed: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tiles: number[][];
}

interface GoldenFile {
  width: number;
  height: number;
  ironmarch: { id: string; name: string; hash: string };
  settlements: GoldenSettlement[];
}

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/world-7741.json', import.meta.url)), 'utf8'),
) as GoldenFile;

test('seed 7741 at worldScale 16 matches the world-map settlement list and Ironmarch hash', () => {
  const world = generateWorld(7741, { ...DEFAULT_WORLD_SETTINGS, worldScale: 16 });
  expect(world.width).toBe(golden.width);
  expect(world.height).toBe(golden.height);
  const settlements = world.nodes
    .map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      origin: node.origin,
      biome: Biome[node.biome] ?? String(node.biome),
      cx: Math.round(node.cx * 1000) / 1000,
      cy: Math.round(node.cy * 1000) / 1000,
      radius: node.radius,
      seed: node.seed,
      x0: node.x0,
      y0: node.y0,
      x1: node.x1,
      y1: node.y1,
      tiles: (node.tiles ?? [])
        .map((tile) => [tile.x, tile.y])
        .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  expect(settlements).toEqual(golden.settlements);

  const ironmarch = world.nodes.find((node) => node.name === 'Ironmarch');
  const veldcross = world.nodes.find((node) => node.id === 'veldcross');
  expect(ironmarch).toBeDefined();
  expect(veldcross).toBe(ironmarch);
  expect(ironmarch?.id).toBe(golden.ironmarch.id);
  expect(ironmarch?.name).toBe(golden.ironmarch.name);
  if (!ironmarch) return;
  expect(buildAreaExport(world, ironmarch).meta.hash).toBe(golden.ironmarch.hash);
});
