import { expect, test } from 'vitest';
import { defaultPlayerAvatar } from '../../src/core/people/avatar';
import { migrate, SAVE_SCHEMA } from '../../src/core/save/migrations';
import type { PackedWorld, SaveManifest } from '../../src/core/save/types';

const avatar = {
  ...defaultPlayerAvatar('Mara'),
  seed: 42,
  recipeHash: 'abcdef0123456789',
  race: 'elf',
  gender: 'f' as const,
};

const core: PackedWorld = {
  clockHours: 8,
  worldSeed: 7741,
  player: { name: 'Mara', mapX: 1, mapY: 2, yaw: 0, avatar },
  gameVersion: '0.0.0',
  cfPin: { version: '1.2.0', generatorVersion: '1' },
};

function manifest(schema: number): SaveManifest {
  return {
    schema,
    gameVersion: '0.0.0',
    worldSeed: 7741,
    clockHours: 8,
    player: { name: 'Mara', mapX: 1, mapY: 2, yaw: 0, avatar },
    cfPin: { version: '1.2.0', generatorVersion: '1' },
    savedAt: '2026-11-05T00:00:00.000Z',
  };
}

test('schema 4 is the current save and passes through', () => {
  expect(SAVE_SCHEMA).toBe(4);
  const current = manifest(4);
  const result = migrate(current, core);
  expect(result.manifest).toBe(current);
  expect(result.core).toBe(core);
});

test('schema 3 gains a player avatar and keeps the hero', () => {
  const legacyCore: PackedWorld = {
    ...core,
    player: { name: 'Mara', mapX: 1, mapY: 2, yaw: 0 },
  };
  const legacy = manifest(3);
  legacy.player = { name: 'Mara', mapX: 1, mapY: 2, yaw: 0 };
  const result = migrate(legacy, legacyCore);
  expect(result.manifest.schema).toBe(4);
  expect(result.manifest.player.mapX).toBe(1);
  expect(result.manifest.player.avatar).toMatchObject({
    name: 'Mara',
    race: 'human',
    gender: 'm',
    generatorVersion: 1,
  });
  expect(result.core?.player.avatar?.name).toBe('Mara');
  expect(result.core?.player.mapY).toBe(2);
  expect(result.core?.clockHours).toBe(8);
  expect(result.manifest.player.avatar?.recipe).toBeUndefined();
  expect(result.core?.player.avatar?.recipe).toBeUndefined();
  expect(result.core?.player.avatar?.recipeHash).toBe('');
});

test('schemas other than 3 and 4 are rejected', () => {
  expect(() => migrate(manifest(2), core)).toThrow(/schema 2/);
  expect(() => migrate(manifest(5), core)).toThrow(/schema 5/);
});
