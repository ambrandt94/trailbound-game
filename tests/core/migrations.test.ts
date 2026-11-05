import { expect, test } from 'vitest';
import { migrate, SAVE_SCHEMA } from '../../src/core/save/migrations';
import type { PackedWorld, SaveManifest } from '../../src/core/save/types';

const core: PackedWorld = {
  clockHours: 8,
  worldSeed: 7741,
  player: { name: 'Traveller', mapX: 1, mapY: 2, yaw: 0 },
  gameVersion: '0.0.0',
  cfPin: { version: 'unvendored', generatorVersion: 'none' },
};

function manifest(schema: number): SaveManifest {
  return {
    schema,
    gameVersion: '0.0.0',
    worldSeed: 7741,
    clockHours: 8,
    player: { name: 'Traveller', mapX: 1, mapY: 2, yaw: 0 },
    cfPin: { version: 'unvendored', generatorVersion: 'none' },
    savedAt: '2026-11-05T00:00:00.000Z',
  };
}

test('schema 3 is the current save and passes through', () => {
  expect(SAVE_SCHEMA).toBe(3);
  const current = manifest(3);
  const result = migrate(current, core);
  expect(result.manifest).toBe(current);
  expect(result.core).toBe(core);
});

test('older schemas are rejected until the G3 migration lands', () => {
  expect(() => migrate(manifest(2), core)).toThrow(/schema 2/);
  expect(() => migrate(manifest(4), core)).toThrow(/schema 4/);
});
