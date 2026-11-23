import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseMusicManifest } from '../../src/core/music/catalog';
import { pickTrack } from '../../src/core/music/select';
import { SCENARIOS } from './music-table.scenarios';

const { catalog } = parseMusicManifest(
  JSON.parse(readFileSync('public/assets/audio/music/manifest.json', 'utf8')),
);

/** First entry is what plays first; the rest rotate in when the context lasts. */
const EXPECTED: Record<string, string[]> = {
  'Title screen': ['menu-theme'],
  'World Gen screen': ['worldgen-theme'],
  'Map, day, plains': ['on-the-road-happy-loop'],
  'Map, day, forest': ['forest-road-caravan'],
  'Map, day, desert': ['caravan-over-dunes'],
  'Map, day, sand coast': ['on-the-road-beach-loop'],
  'Map, night, plains': ['on-the-road-night-loop'],
  '3D travel, day, plains': ['on-the-road-happy-loop'],
  '3D travel, day, forest': ['calm-bright-forest-loop', 'forest-road-caravan'],
  '3D travel, day, dark forest': ['calm-bright-forest-loop', 'forest-road-caravan'],
  '3D travel, day, desert': ['caravan-over-dunes'],
  '3D travel, day, sand (beach)': ['on-the-road-beach-loop'],
  '3D travel, day, mountain': ['on-the-road-happy-loop'],
  '3D travel, night, plains': ['on-the-road-night-loop'],
  '3D travel, night, forest': ['on-the-road-night-loop'],
  '3D, holy grove': ['holy-grove-loop'],
  '3D, hamlet (day)': ['calm-town'],
  '3D, city (day)': ['calm-town', 'lively-camp-loop'],
  '3D, town (night)': ['calm-town'],
  'Map, in a town': ['calm-town'],
  'Camp (caravan halted), day': ['calm-camp', 'campfire-by-the-old-trail'],
  'Camp (caravan halted), night': ['calm-camp', 'campfire-by-the-old-trail'],
  'Minigame open (3D)': ['walk-with-purpose-loop'],
  'Minigame open in town': ['walk-with-purpose-loop'],
};

test('every scenario resolves to the documented track (and rotation partners)', () => {
  const rows: string[] = ['| Context | Plays | Then rotates to |', '|---|---|---|'];
  for (const scenario of SCENARIOS) {
    const pick = pickTrack(catalog.tracks, scenario.ctx);
    const ids = (pick?.candidates ?? []).map((entry) => entry.track.id);
    expect(ids, scenario.name).toEqual(EXPECTED[scenario.name]);
    rows.push(
      `| ${scenario.name} | \`${ids[0]}\` | ${
        ids
          .slice(1)
          .map((id) => `\`${id}\``)
          .join(', ') || '-'
      } |`,
    );
  }
  expect(Object.keys(EXPECTED)).toHaveLength(SCENARIOS.length);
  if (process.env.MUSIC_TABLE_OUT)
    writeFileSync(process.env.MUSIC_TABLE_OUT, `${rows.join('\n')}\n`);
});
