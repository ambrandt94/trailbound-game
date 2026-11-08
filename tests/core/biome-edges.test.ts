import { expect, test } from 'vitest';
import { DEFAULT_WORLD_SETTINGS } from '../../src/core/world/models';
import { generateWorld } from '../../src/core/world/world-gen';
import { BIOME_NAMES, authoredPair } from '../../src/render/map/terrain-pick';

test('seed 7741 lists land biome pairs that have no authored edge set', () => {
  const world = generateWorld(7741, { ...DEFAULT_WORLD_SETTINGS, worldScale: 16 });
  const seen = new Set<string>();
  const width = world.width;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < width; x++) {
      const here = world.biomes[x + y * width] ?? 0;
      if (here === 0) continue;
      const east = x + 1 < width ? (world.biomes[x + 1 + y * width] ?? 0) : 0;
      const south = y + 1 < world.height ? (world.biomes[x + (y + 1) * width] ?? 0) : 0;
      for (const other of [east, south]) {
        if (other === 0 || other === here) continue;
        const lo = Math.min(here, other);
        const hi = Math.max(here, other);
        seen.add(`${lo}:${hi}`);
      }
    }
  }
  const missing = [...seen]
    .filter((key) => {
      const [a, b] = key.split(':').map((part) => Number(part));
      return !authoredPair(a ?? 0, b ?? 0);
    })
    .map((key) => {
      const [a, b] = key.split(':').map((part) => Number(part));
      return `${BIOME_NAMES[a ?? 0]}/${BIOME_NAMES[b ?? 0]}`;
    })
    .sort();
  expect(missing).toEqual([
    'DarkForest/Hills',
    'Forest/DarkForest',
    'Forest/Hills',
    'Forest/Jungle',
    'Forest/Marsh',
    'Forest/Taiga',
    'Heath/Desert',
    'Heath/Mountain',
    'Heath/Taiga',
    'Hills/Heath',
    'Hills/Jungle',
    'Hills/Mountain',
    'Hills/Snow',
    'Hills/Taiga',
    'Marsh/Jungle',
    'Meadow/Desert',
    'Meadow/Forest',
    'Meadow/Heath',
    'Meadow/Hills',
    'Meadow/Jungle',
    'Meadow/Taiga',
    'Mountain/Taiga',
    'Plains/Desert',
    'Plains/Forest',
    'Plains/Heath',
    'Plains/Hills',
    'Plains/Meadow',
    'Plains/Snow',
    'Plains/Taiga',
    'Sand/Desert',
    'Sand/Forest',
    'Sand/Heath',
    'Sand/Jungle',
    'Sand/Marsh',
    'Sand/Snow',
    'Sand/Taiga',
    'Snow/Taiga',
  ]);
}, 60_000);
