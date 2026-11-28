import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { CF_PIN } from '../../src/app/version';
import { characterForgePaths, readCfPin } from '../../src/render/characters/cf-pin';
import { syncCharacterBundle } from '../../tools/sync-character-bundle.mjs';

test('current.json and current-v2.json both pin 2.6.0 and the old skeleton is gone', async () => {
  const pin = JSON.parse(await readFile('public/vendor/character-forge/current.json', 'utf8')) as {
    version: string;
    generatorVersion: number;
  };
  const v2 = JSON.parse(
    await readFile('public/vendor/character-forge/current-v2.json', 'utf8'),
  ) as { version: string; generatorVersion: number };
  expect(pin).toEqual({ version: '2.6.0', generatorVersion: 1 });
  expect(v2).toEqual(pin);
  expect(CF_PIN).toEqual({ version: pin.version, generatorVersion: String(pin.generatorVersion) });
  expect(characterForgePaths().runtime).toBe(
    `vendor/character-forge/${CF_PIN.version}/cf-runtime.mjs`,
  );
  expect(characterForgePaths().base).toBe(`vendor/character-forge/${CF_PIN.version}/`);
  expect(existsSync(`public/${characterForgePaths().runtime}`)).toBe(true);
  expect(existsSync('public/vendor/character-forge/1.2.0')).toBe(false);
  expect(existsSync('public/vendor/character-forge/1.2.1')).toBe(false);
  expect(existsSync('public/vendor/character-forge/2.2.1')).toBe(false);
});

test('a pin that is not a version triple is refused', () => {
  expect(() => readCfPin({ version: '1.2', generatorVersion: 1 })).toThrow(/version/);
  expect(() => readCfPin({ version: '1.2.0', generatorVersion: 1.2 })).toThrow(/generatorVersion/);
  expect(() => characterForgePaths('latest')).toThrow(/version/);
});

test('sync copies a dist into public/vendor/character-forge/<version> and writes current.json', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'cf-dist-'));
  const dest = await mkdtemp(path.join(tmpdir(), 'cf-dest-'));
  await writeFile(
    path.join(dist, 'bundle.json'),
    JSON.stringify({ engine: { version: '9.9.9' }, generator: { version: 3 } }),
  );
  await writeFile(path.join(dist, 'cf-runtime.mjs'), 'export default {}\n');
  await writeFile(path.join(dist, 'note.txt'), 'hello');

  const result = syncCharacterBundle(dist, { destRoot: dest });
  expect(result).toMatchObject({
    version: '9.9.9',
    generatorVersion: 3,
    files: 3,
    pinFile: 'current.json',
  });
  const pin = JSON.parse(await readFile(path.join(dest, 'current.json'), 'utf8')) as {
    version: string;
    generatorVersion: number;
  };
  expect(pin).toEqual({ version: '9.9.9', generatorVersion: 3 });
  expect(await readFile(path.join(dest, '9.9.9', 'note.txt'), 'utf8')).toBe('hello');
  expect(await readFile(path.join(dest, '9.9.9', 'cf-runtime.mjs'), 'utf8')).toContain(
    'export default',
  );
});

test('sync of a 2.x dist writes current-v2.json and current.json to that version', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'cf2-dist-'));
  const dest = await mkdtemp(path.join(tmpdir(), 'cf2-dest-'));
  await writeFile(path.join(dest, 'current.json'), '{"version":"1.2.1","generatorVersion":1}\n');
  await writeFile(
    path.join(dist, 'bundle.json'),
    JSON.stringify({ engine: { version: '2.1.0' }, generator: { version: 1 } }),
  );
  await writeFile(path.join(dist, 'cf-runtime.mjs'), 'export default {}\n');

  const result = syncCharacterBundle(dist, { destRoot: dest });
  expect(result).toMatchObject({
    version: '2.1.0',
    generatorVersion: 1,
    pinFile: 'current-v2.json',
  });
  const active = JSON.parse(await readFile(path.join(dest, 'current.json'), 'utf8')) as {
    version: string;
    generatorVersion: number;
  };
  const side = JSON.parse(await readFile(path.join(dest, 'current-v2.json'), 'utf8')) as {
    version: string;
    generatorVersion: number;
  };
  expect(active).toEqual({ version: '2.1.0', generatorVersion: 1 });
  expect(side).toEqual({ version: '2.1.0', generatorVersion: 1 });
  expect(await readFile(path.join(dest, '2.1.0', 'cf-runtime.mjs'), 'utf8')).toContain(
    'export default',
  );
});

test('sync refuses a 1.x dist', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'cf1-dist-'));
  const dest = await mkdtemp(path.join(tmpdir(), 'cf1-dest-'));
  await writeFile(
    path.join(dist, 'bundle.json'),
    JSON.stringify({ engine: { version: '1.2.1' }, generator: { version: 1 } }),
  );
  await writeFile(path.join(dist, 'cf-runtime.mjs'), 'export default {}\n');
  expect(() => syncCharacterBundle(dist, { destRoot: dest })).toThrow(/old skeleton/);
  expect(existsSync(path.join(dest, '1.2.1'))).toBe(false);
});

test('sync refuses a file over the size guard', async () => {
  const dist = await mkdtemp(path.join(tmpdir(), 'cf-big-'));
  const dest = await mkdtemp(path.join(tmpdir(), 'cf-big-dest-'));
  await writeFile(
    path.join(dist, 'bundle.json'),
    JSON.stringify({ engine: { version: '9.9.8' }, generator: { version: 1 } }),
  );
  await writeFile(path.join(dist, 'cf-runtime.mjs'), 'export default {}\n');
  await writeFile(path.join(dist, 'huge.bin'), Buffer.alloc(80));
  expect(() => syncCharacterBundle(dist, { destRoot: dest, maxBytes: 70 })).toThrow(/70/);
});
