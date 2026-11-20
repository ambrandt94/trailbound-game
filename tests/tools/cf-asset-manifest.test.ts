import { existsSync } from 'node:fs';
import { expect, test } from 'vitest';
import { CF2_PIN, characterForgeV2Paths } from '../../src/render/characters/cf-pin';
import { verifyShaManifest } from '../../tools/cf-asset-manifest.mjs';

const root = `public/${characterForgeV2Paths().base}`;

test('Character Forge 2.1.1 is vendored beside the v1 pin and matches its sha256 manifests', () => {
  expect(CF2_PIN).toEqual({ version: '2.1.1', generatorVersion: '1' });
  expect(characterForgeV2Paths().runtime).toBe('vendor/character-forge/2.1.1/cf-runtime.mjs');
  expect(existsSync(`${root}cf-runtime.mjs`)).toBe(true);
  expect(existsSync(`${root}LICENSES.md`)).toBe(true);
  expect(existsSync(`${root}licenses.json`)).toBe(true);
  expect(existsSync(`${root}assets.json`)).toBe(true);
  const assets = verifyShaManifest(root.replace(/\/$/, ''), 'assets.json');
  const bundle = verifyShaManifest(root.replace(/\/$/, ''), 'bundle.json');
  expect(assets, assets.join('\n')).toEqual([]);
  expect(bundle, bundle.join('\n')).toEqual([]);
});
