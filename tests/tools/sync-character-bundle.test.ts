import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { CF_PIN } from '../../src/app/version';
import { syncCharacterBundle } from '../../tools/sync-character-bundle.mjs';

test('the vendored pin is Character Forge 1.1.0 generator 1', async () => {
  const pin = JSON.parse(await readFile('public/vendor/character-forge/current.json', 'utf8')) as {
    version: string;
    generatorVersion: number;
  };
  expect(pin).toEqual({ version: '1.1.0', generatorVersion: 1 });
  expect(CF_PIN).toEqual({ version: '1.1.0', generatorVersion: '1' });
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
