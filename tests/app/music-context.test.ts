import { describe, expect, test } from 'vitest';
import { buildMusicContext, type MusicContextInput } from '../../src/app/music-context';
import { createWorld } from '../../src/core/state/world-state';
import { Biome, type WorldData } from '../../src/core/world/models';

function flatWorld(biome: Biome): WorldData {
  const width = 8;
  const height = 8;
  return {
    width,
    height,
    biomes: new Uint8Array(width * height).fill(biome),
    pois: [],
    nodes: [],
  } as unknown as WorldData;
}

function input(
  patch: Partial<MusicContextInput> = {},
  hours = 9,
  biome = Biome.Forest,
): MusicContextInput {
  const world = createWorld({ id: 'waystead', name: 'Waystead', x: 3, y: 3 });
  world.data = flatWorld(biome);
  world.clockHours = hours;
  return { mode: 'map', view: 'map', world, minigameOpen: false, ...patch };
}

describe('buildMusicContext', () => {
  test('booting has no context; the title and creator are the title', () => {
    expect(buildMusicContext(input({ mode: 'boot' }))).toBeNull();
    expect(buildMusicContext(input({ mode: 'title' }))?.scene).toBe('title');
    expect(buildMusicContext(input({ mode: 'creator' }))?.scene).toBe('title');
  });

  test('map and 3D carry the biome under the party, the day-cycle HUD source', () => {
    const map = buildMusicContext(input());
    expect(map).toMatchObject({ scene: 'map', biome: Biome.Forest, night: false, minigame: false });
    expect(buildMusicContext(input({ view: 'area', mode: 'area' }))?.scene).toBe('area');
  });

  test('night comes from the clock band, not the lighting', () => {
    expect(buildMusicContext(input({}, 9))?.night).toBe(false);
    expect(buildMusicContext(input({}, 16))?.night).toBe(false); // dusk
    expect(buildMusicContext(input({}, 18))?.night).toBe(true); // TU 75
    expect(buildMusicContext(input({}, 24 + 3))?.night).toBe(false); // dawn
  });

  test('an open minigame is passed through', () => {
    expect(buildMusicContext(input({ minigameOpen: true }))?.minigame).toBe(true);
  });

  test('a map-less area (town fixture) counts as a town', () => {
    const base = input({ view: 'area', mode: 'area' });
    base.world.data = null;
    expect(buildMusicContext(base)).toMatchObject({ scene: 'area', place: 'town', biome: null });
  });
});
