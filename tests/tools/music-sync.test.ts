import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildManifest, syncMusic } from '../../tools/music-sync.mjs';

const track = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  name: id,
  file: `audio/${id}.ogg`,
  format: 'ogg',
  loop: true,
  context: ['map'],
  intensity: 0.5,
  durationSec: 10,
  kind: 'ambient',
  ...patch,
});
const meta = { source: 'test', contextVocabulary: ['map', 'town'] };

function bundle(catalog: Record<string, unknown>, ids: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'music-bundle-'));
  mkdirSync(path.join(dir, 'audio'));
  writeFileSync(path.join(dir, 'music.json'), JSON.stringify(catalog));
  for (const id of ids) writeFileSync(path.join(dir, 'audio', `${id}.ogg`), 'OggS-fake');
  return dir;
}

describe('music-sync', () => {
  test('builds a sorted manifest with file names next to it', () => {
    const manifest = buildManifest({ _meta: meta, b: track('b'), a: track('a', { mood: 'calm' }) });
    expect(manifest.tracks.map((t) => t.id)).toEqual(['a', 'b']);
    expect(manifest.tracks[0]).toMatchObject({ file: 'a.ogg', mood: 'calm' });
    expect(manifest.vocabulary).toEqual(['map', 'town']);
  });

  test('lists every problem at once', () => {
    const bad = {
      _meta: meta,
      a: track('a', { intensity: 2, context: ['volcano'], loop: 'yes' }),
      b: track('x'),
      c: track('c', { context: [] }),
    };
    expect(() => buildManifest(bad)).toThrow(
      /loop must be a boolean[\s\S]*unknown context tag "volcano"[\s\S]*intensity[\s\S]*does not match its key[\s\S]*at least one tag/,
    );
  });

  test('copies the files, writes the manifest, and drops OGGs the export no longer has', () => {
    const dir = bundle({ _meta: meta, a: track('a'), b: track('b') }, ['a', 'b']);
    const dest = mkdtempSync(path.join(tmpdir(), 'music-dest-'));
    writeFileSync(path.join(dest, 'old.ogg'), 'OggS');
    const result = syncMusic(dir, { destRoot: dest });
    expect(result.tracks).toBe(2);
    expect(readdirSync(dest).sort()).toEqual(['a.ogg', 'b.ogg', 'manifest.json']);
    expect(JSON.parse(readFileSync(path.join(dest, 'manifest.json'), 'utf8')).tracks).toHaveLength(
      2,
    );
  });

  test('a missing audio file or a non-Ogg file stops the sync before anything is written', () => {
    const missing = bundle({ _meta: meta, a: track('a') }, []);
    const dest = mkdtempSync(path.join(tmpdir(), 'music-dest-'));
    expect(() => syncMusic(missing, { destRoot: dest })).toThrow(/is missing/);
    const notOgg = bundle({ _meta: meta, a: track('a') }, []);
    writeFileSync(path.join(notOgg, 'audio', 'a.ogg'), 'RIFFxxxx');
    expect(() => syncMusic(notOgg, { destRoot: dest })).toThrow(/not an Ogg/);
    expect(readdirSync(dest)).toEqual([]);
  });

  test('the committed manifest matches what the tool builds from the committed catalog fields', () => {
    const manifest = JSON.parse(readFileSync('public/assets/audio/music/manifest.json', 'utf8'));
    expect(manifest.version).toBe(1);
    expect(manifest.tracks.length).toBeGreaterThan(0);
  });
});
