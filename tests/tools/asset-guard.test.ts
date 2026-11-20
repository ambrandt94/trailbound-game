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

test('asset guard rejects Kevin Iglesias animation names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tb-ki-'));
  writeFileSync(join(dir, 'KI_HumanM_anims.glb'), 'nope');
  writeFileSync(join(dir, 'notes-about-Kevin.txt'), 'nope');
  writeFileSync(join(dir, 'ki_manifest.json'), '{}');
  writeFileSync(join(dir, 'kaykit_anims.glb'), 'ok');
  const violations = findViolations(dir, { maxBytes: 10_000_000 });
  const flagged = violations.filter((line) => line.includes('Kevin Iglesias'));
  expect(flagged.some((line) => line.includes('KI_HumanM_anims.glb'))).toBe(true);
  expect(flagged.some((line) => line.includes('notes-about-Kevin.txt'))).toBe(true);
  expect(flagged.some((line) => line.includes('ki_manifest.json'))).toBe(true);
  expect(flagged.some((line) => line.includes('kaykit_anims.glb'))).toBe(false);
});

test('the repo has no Kevin Iglesias animation files', () => {
  const hits = findViolations(process.cwd()).filter((line) => line.includes('Kevin Iglesias'));
  expect(hits).toEqual([]);
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
