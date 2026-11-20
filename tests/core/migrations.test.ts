import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { defaultPlayerAvatar, isPlayerAvatar } from '../../src/core/people/avatar';
import type { PlayerAvatar } from '../../src/core/people/avatar';
import { assertPackedWorld, migrate, SAVE_SCHEMA } from '../../src/core/save/migrations';
import type { PackedWorld, SaveManifest } from '../../src/core/save/types';
import { createWorld } from '../../src/core/state/world-state';

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

test('schema 5 is the current save and passes through', () => {
  expect(SAVE_SCHEMA).toBe(5);
  const current = manifest(5);
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
  expect(result.manifest.schema).toBe(5);
  expect(result.manifest.player.mapX).toBe(1);
  expect(result.manifest.player.avatar).toMatchObject({
    name: 'Mara',
    race: 'human',
    gender: 'm',
    generatorVersion: 1,
    engine: 'cf1',
  });
  expect(result.core?.player.avatar?.name).toBe('Mara');
  expect(result.core?.player.mapY).toBe(2);
  expect(result.core?.clockHours).toBe(8);
  expect(result.manifest.player.avatar?.recipe).toBeUndefined();
  expect(result.core?.player.avatar?.recipe).toBeUndefined();
  expect(result.manifest.player.avatar?.legacyRecipe).toBeUndefined();
  expect(result.core?.player.avatar?.legacyRecipe).toBeUndefined();
  expect(result.core?.player.avatar?.recipeHash).toBe('');
});

test('schemas other than 3, 4, and 5 are rejected', () => {
  expect(() => migrate(manifest(2), core)).toThrow(/schema 2/);
  expect(() => migrate(manifest(6), core)).toThrow(/schema 6/);
});

test('schema 4 avatars become cf1 and keep the v1 recipe verbatim', () => {
  const fixtures = JSON.parse(
    readFileSync('tests/fixtures/cf-1.2.0-recipes.json', 'utf8'),
  ) as Record<string, { hash: string; engine: Record<string, unknown> }>;
  const names = Object.keys(fixtures).sort();
  expect(names.length).toBeGreaterThan(0);

  for (const name of names) {
    const row = fixtures[name];
    if (!row) throw new Error(`missing fixture ${name}`);
    const recipe = JSON.parse(JSON.stringify(row.engine)) as Record<string, unknown>;
    const before = JSON.parse(JSON.stringify(recipe)) as Record<string, unknown>;
    const schema4 = schema4Avatar(name, row.hash, recipe);
    expect(schema4.engine).toBeUndefined();
    expect(schema4.legacyRecipe).toBeUndefined();
    expect(isPlayerAvatar(schema4)).toBe(true);

    const packed = worldFor(schema4);
    expect(() => assertPackedWorld(packed)).not.toThrow();
    const saved = manifest(4);
    saved.player = { ...packed.player };
    const result = migrate(saved, packed);

    expect(result.manifest.schema).toBe(5);
    const loaded = result.core?.player.avatar;
    const listed = result.manifest.player.avatar;
    expect(loaded?.engine).toBe('cf1');
    expect(listed?.engine).toBe('cf1');
    expect(loaded?.recipe).toBe(recipe);
    expect(loaded?.recipe).toEqual(before);
    expect(loaded?.legacyRecipe).toEqual(before);
    expect(loaded?.legacyRecipe).not.toBe(recipe);
    expect(listed?.legacyRecipe).toEqual(before);
    expect(listed?.legacyRecipe).not.toBe(loaded?.legacyRecipe);
    const legacyBody = (loaded?.legacyRecipe as { S?: { height?: number } } | undefined)?.S;
    const liveBody = (loaded?.recipe as { S?: { height?: number } } | undefined)?.S;
    const listedBody = (listed?.legacyRecipe as { S?: { height?: number } } | undefined)?.S;
    expect(typeof legacyBody?.height).toBe('number');
    if (legacyBody && liveBody && listedBody && typeof legacyBody.height === 'number') {
      const height = legacyBody.height;
      legacyBody.height = height + 1;
      expect(liveBody.height).toBe(height);
      expect(listedBody.height).toBe(height);
      expect((recipe.S as { height?: number }).height).toBe(height);
      legacyBody.height = height;
    }
    expect(loaded?.recipeHash).toBe(row.hash);
    expect(recipe).toEqual(before);

    const world = createWorld({ id: 'waystead', name: 'Waystead', x: 1, y: 1 });
    if (!result.core) throw new Error('expected migrated core');
    world.load(result.core);
    expect(world.avatar.engine).toBe('cf1');
    expect(world.avatar.race).toBe(schema4.race);
    expect(world.avatar.recipe).toEqual(before);
    expect(world.avatar.legacyRecipe).toEqual(before);
    const again = world.toPacked({
      gameVersion: '0.0.0',
      cfPin: { version: '1.2.1', generatorVersion: '1' },
    });
    expect(again.player.avatar?.engine).toBe('cf1');
    expect(again.player.avatar?.legacyRecipe).toEqual(before);
    expect(again.player.avatar?.legacyRecipe).not.toBe(world.avatar.legacyRecipe);
  }
});

function schema4Avatar(
  name: string,
  recipeHash: string,
  recipe: Record<string, unknown>,
): PlayerAvatar {
  const next: PlayerAvatar = {
    ...defaultPlayerAvatar(name),
    seed: 7741,
    recipeHash,
    race: 'elf',
    gender: 'f',
    recipe,
  };
  delete next.engine;
  delete next.legacyRecipe;
  return next;
}

function worldFor(avatar: PlayerAvatar): PackedWorld {
  return {
    ...core,
    player: { name: avatar.name, mapX: 1, mapY: 2, yaw: 0, avatar },
  };
}
