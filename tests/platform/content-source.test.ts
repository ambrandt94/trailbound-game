import { expect, test } from 'vitest';
import { createFetchContentSource } from '../../src/platform/content-source';

test('fetch content source loads the index and an entry by id', async () => {
  const files = new Map<string, unknown>([
    [
      'https://game.example/content/index.json',
      {
        id: 'demo',
        version: 1,
        entries: [{ id: 'places/waystead', path: 'places/waystead.json' }],
      },
    ],
    ['https://game.example/content/places/waystead.json', { id: 'waystead', name: 'Waystead' }],
  ]);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const body = files.get(url);
    if (!body) return new Response('missing', { status: 404 });
    return Response.json(body);
  };
  const source = createFetchContentSource('https://game.example/', fetchImpl);
  const index = await source.loadIndex();
  expect(index.entries).toHaveLength(1);
  await expect(source.load('places/waystead')).resolves.toMatchObject({ name: 'Waystead' });
  await expect(source.load('missing')).rejects.toThrow(/unknown content id/);
});
