import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { findViolations } from '../../tools/asset-guard.mjs';

test('asset guard flags denied extensions and oversized files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tb-assets-'));
  writeFileSync(join(dir, 'hero.glb'), 'ok');
  writeFileSync(join(dir, 'Source.FBX'), 'nope');
  writeFileSync(join(dir, 'notes.txt'), 'x'.repeat(50));
  const violations = findViolations(dir, { maxBytes: 20 });
  expect(violations.some((line) => line.includes('Source.FBX') && line.includes('.fbx'))).toBe(
    true,
  );
  expect(violations.some((line) => line.includes('notes.txt') && line.includes('limit 20'))).toBe(
    true,
  );
  expect(violations.some((line) => line.includes('hero.glb'))).toBe(false);
});

test('asset guard skips dependency and build folders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tb-assets-skip-'));
  writeFileSync(join(dir, 'ok.json'), '{}');
  const nested = join(dir, 'node_modules');
  mkdirSync(nested);
  writeFileSync(join(nested, 'Source.blend'), 'x'.repeat(80));
  const violations = findViolations(dir, { maxBytes: 10 });
  expect(violations.some((line) => line.includes('blend') || line.includes('node_modules'))).toBe(
    false,
  );
  expect(violations.some((line) => line.includes('ok.json'))).toBe(false);
});
