import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { CF_PIN } from '../../src/app/version';
import { characterForgePaths, readCfPin } from '../../src/render/characters/cf-pin';
import { syncCharacterBundle } from '../../tools/sync-character-bundle.mjs';

test('the vendored pin is Character Forge 1.2.1 generator 1 and the loader follows it', async () => {
  const pin = JSON.parse(await readFile('public/vendor/character-forge/current.json', 'utf8')) as {
    version: string;
    generatorVersion: number;
  };
  expect(pin).toEqual({ version: '1.2.1', generatorVersion: 1 });
  expect(CF_PIN).toEqual({ version: pin.version, generatorVersion: String(pin.generatorVersion) });
  expect(characterForgePaths().runtime).toBe(
    `vendor/character-forge/${CF_PIN.version}/cf-runtime.mjs`,
  );
  expect(characterForgePaths().base).toBe(`vendor/character-forge/${CF_PIN.version}/`);
  expect(existsSync(`public/${characterForgePaths().runtime}`)).toBe(true);
  const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  expect(sha('public/vendor/character-forge/1.2.0/bundle.json')).toBe(
    'bf94f33dd30629d2cfaae51ae389a5c8d40a4d76acf11e71efc5f628555a28ff',
  );
  expect(sha('public/vendor/character-forge/1.2.0/cf-runtime.mjs')).toBe(
    'fb8a7ef8e7e918d7f24c1a175f1c1ef42a10300f2899a13149b8d31bb75cdc90',
  );
  expect(sha('public/vendor/character-forge/1.2.1/bundle.json')).toBe(
    '35a4f51f91193030ea3844331f2055f33d71b09a58ee08f1db94f36edc8fa6a9',
  );
  expect(sha('public/vendor/character-forge/1.2.1/cf-runtime.mjs')).toBe(
    '3280ddb5e7f655e829cb0fc9455035cb6044fb8eddb422fc1725b91f1a2b209c',
  );
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
  expect(result).toMatchObject({ version: '9.9.9', generatorVersion: 3, files: 3 });
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
