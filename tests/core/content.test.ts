import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseContentIndex, parsePlace } from '../../src/core/content/parse';

test('the example content index and place parse', () => {
  const index = parseContentIndex(JSON.parse(readFileSync('content/index.json', 'utf8')));
  expect(index.id).toBe('trailbound.content');
  expect(index.entries[0]?.id).toBe('places/waystead');
  const place = parsePlace(JSON.parse(readFileSync('content/places/waystead.json', 'utf8')));
  expect(place).toMatchObject({
    id: 'waystead',
    name: 'Waystead',
    kind: 'town',
    map: { x: 8, y: 8 },
  });
});

test('content paths cannot escape the content directory', () => {
  expect(() =>
    parseContentIndex({
      id: 'x',
      version: 1,
      entries: [{ id: 'secret', path: '../secret.json' }],
    }),
  ).toThrow(/invalid content path/);
  expect(() => parsePlace({ id: 'a' })).toThrow(/place content/);
});
