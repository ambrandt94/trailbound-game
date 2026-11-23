import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseMusicManifest, type MusicTrack } from '../../src/core/music/catalog';
import { DEFAULT_MUSIC_CONTEXT, type MusicContext } from '../../src/core/music/context';
import { MusicDirector } from '../../src/core/music/director';
import { MUSIC_RULES } from '../../src/core/music/rules';
import { contextKey, pickTrack, sceneClass, scoreTracks } from '../../src/core/music/select';
import { Biome } from '../../src/core/world/models';
import { SCENARIOS } from './music-table.scenarios';

const manifest = JSON.parse(readFileSync('public/assets/audio/music/manifest.json', 'utf8'));
const { catalog, problems } = parseMusicManifest(manifest);
const tracks = catalog.tracks;
const ctx = (patch: Partial<MusicContext>): MusicContext => ({
  ...DEFAULT_MUSIC_CONTEXT,
  ...patch,
});
const pick = (patch: Partial<MusicContext>) => {
  const result = pickTrack(tracks, ctx(patch));
  if (!result) throw new Error('no pick');
  return result;
};

describe('the committed manifest', () => {
  test('parses clean with all 14 tracks and every file name matches its id', () => {
    expect(problems).toEqual([]);
    expect(tracks).toHaveLength(14);
    for (const track of tracks) expect(track.file).toBe(`${track.id}.ogg`);
  });

  test('every tag a track carries is one the rules table knows how to ask for', () => {
    const asked = new Set<string>();
    const walk = (list: readonly { tag: string }[] | undefined) =>
      list?.forEach((want) => asked.add(want.tag));
    Object.values(MUSIC_RULES.scene).forEach(walk);
    walk(MUSIC_RULES.minigame);
    walk(MUSIC_RULES.camp);
    walk(MUSIC_RULES.day);
    walk(MUSIC_RULES.night);
    Object.values(MUSIC_RULES.place).forEach(walk);
    Object.values(MUSIC_RULES.biome).forEach(walk);
    for (const tag of manifest.vocabulary as string[]) expect(asked.has(tag)).toBe(true);
  });
});

describe('selector scoring', () => {
  test('forest, day, 3D -> a forest track', () => {
    const result = pick({ scene: 'area', biome: Biome.Forest });
    expect(result.track.context).toContain('forest');
    expect(result.track.context).toContain('travel-day');
    expect(result.track.id).toBe('calm-bright-forest-loop');
  });

  test('forest, day, map -> the busier forest road track', () => {
    expect(pick({ scene: 'map', biome: Biome.Forest }).track.id).toBe('forest-road-caravan');
  });

  test('desert and beach biomes pick their own tracks', () => {
    expect(pick({ scene: 'area', biome: Biome.Desert }).track.id).toBe('caravan-over-dunes');
    expect(pick({ scene: 'area', biome: Biome.Sand }).track.id).toBe('on-the-road-beach-loop');
  });

  test('a settlement -> a town track, in 3D and on the map, day or night', () => {
    for (const night of [false, true]) {
      for (const scene of ['area', 'map'] as const) {
        const result = pick({ scene, place: 'town', biome: Biome.Forest, night });
        expect(result.track.context).toContain('town');
      }
    }
    expect(pick({ scene: 'area', place: 'hamlet' }).track.id).toBe('calm-town');
  });

  test('a grove -> the grove track', () => {
    expect(pick({ scene: 'area', place: 'grove', biome: Biome.Meadow }).track.id).toBe(
      'holy-grove-loop',
    );
  });

  test('night travel -> the night track, over a forest day track', () => {
    expect(pick({ scene: 'area', biome: Biome.Plains, night: true }).track.id).toBe(
      'on-the-road-night-loop',
    );
    expect(pick({ scene: 'area', biome: Biome.Forest, night: true }).track.id).toBe(
      'on-the-road-night-loop',
    );
    expect(pick({ scene: 'map', biome: Biome.Desert, night: true }).track.id).toBe(
      'on-the-road-night-loop',
    );
  });

  test('a minigame -> the minigame track, anywhere', () => {
    for (const patch of [
      { scene: 'area' as const, biome: Biome.Forest },
      { scene: 'area' as const, place: 'town' },
      { scene: 'map' as const, night: true },
    ]) {
      expect(pick({ ...patch, minigame: true }).track.context).toContain('minigame');
    }
  });

  test('title -> the title theme; camp -> a camp track', () => {
    expect(pick({ scene: 'title' }).track.id).toBe('menu-theme');
    const camp = pick({ scene: 'area', biome: Biome.Forest, camp: true, night: true });
    expect(camp.track.context).toContain('camp');
    expect(sceneClass(ctx({ scene: 'area', camp: true }))).toBe('camp');
  });

  test('the table scenarios all resolve to something sensible', () => {
    for (const scenario of SCENARIOS) {
      const result = pickTrack(tracks, scenario.ctx);
      expect(result, scenario.name).not.toBeNull();
    }
  });

  test('no match at all falls back to a travel-day track, then to anything', () => {
    const odd: MusicTrack[] = [
      {
        id: 'a',
        name: 'a',
        file: 'a.ogg',
        loop: true,
        context: ['travel-day'],
        intensity: 0.5,
        durationSec: 60,
        kind: 'ambient',
      },
      {
        id: 'b',
        name: 'b',
        file: 'b.ogg',
        loop: true,
        context: ['title'],
        intensity: 0.4,
        durationSec: 60,
        kind: 'ambient',
      },
    ];
    // Camp asks for the camp tag; nothing carries it, so the fallback tags decide.
    const camp = pickTrack(odd, ctx({ scene: 'area', camp: true }));
    expect(camp?.track.id).toBe('a');
    const bare = [odd[1]] as MusicTrack[];
    expect(pickTrack(bare, ctx({ scene: 'area' }))?.track.id).toBe('b');
    expect(pickTrack([], ctx({}))).toBeNull();
  });

  test('intensity breaks ties: the quieter forest track wins in 3D, the busier on the map', () => {
    const forest3d = scoreTracks(tracks, ctx({ scene: 'area', biome: Biome.Forest }));
    const forestMap = scoreTracks(tracks, ctx({ scene: 'map', biome: Biome.Forest }));
    expect(forest3d[0]?.track.id).toBe('calm-bright-forest-loop');
    expect(forestMap[0]?.track.id).toBe('forest-road-caravan');
  });
});

describe('no repeat', () => {
  test('a context with several fits rotates instead of repeating the playing track', () => {
    const camp = ctx({ scene: 'area', camp: true });
    const first = pickTrack(tracks, camp);
    const firstId = first?.track.id ?? '';
    const second = pickTrack(tracks, camp, { avoidId: firstId });
    expect(second?.track.id).not.toBe(firstId);
    expect(second?.track.context).toContain('camp');
    const lastPlayed = new Map([
      [firstId, 10],
      [second?.track.id ?? '', 20],
    ]);
    const third = pickTrack(tracks, camp, { avoidId: second?.track.id, lastPlayed });
    expect(third?.track.id).not.toBe(second?.track.id);
  });

  test('with only one fit, avoiding the playing track still returns it', () => {
    const night = pickTrack(tracks, ctx({ scene: 'area', night: true }), {
      avoidId: 'on-the-road-night-loop',
    });
    expect(night?.track.id).toBe('on-the-road-night-loop');
  });
});

describe('director hysteresis', () => {
  const forest = ctx({ scene: 'area', biome: Biome.Forest });
  const desert = ctx({ scene: 'area', biome: Biome.Desert });
  const plains = ctx({ scene: 'area', biome: Biome.Plains });

  test('the first context starts a track at once, with no fade-out', () => {
    const director = new MusicDirector(tracks);
    const decision = director.update(forest, 0);
    expect(decision?.reason).toBe('first');
    expect(decision?.track.id).toBe('calm-bright-forest-loop');
    expect(decision?.fadeSec).toBe(0);
  });

  test('a biome flicker shorter than the hold never switches', () => {
    const director = new MusicDirector(tracks);
    director.update(forest, 0);
    // Past the minimum track time so only the hold is in play.
    for (let t = 50; t < 53.9; t += 0.25) expect(director.update(desert, t)).toBeNull();
    expect(director.update(forest, 53.95)).toBeNull();
    expect(director.pending).toBeNull();
    expect(director.playing?.id).toBe('calm-bright-forest-loop');
    // The desert shows up again: the hold starts over.
    expect(director.update(desert, 60)).toBeNull();
    expect(director.update(desert, 63.9)).toBeNull();
  });

  test('a biome that holds 4 s switches, with the configured crossfade', () => {
    const director = new MusicDirector(tracks, { timing: { crossfadeSec: 3 } });
    director.update(forest, 0);
    expect(director.update(desert, 50)).toBeNull();
    expect(director.update(desert, 53.9)).toBeNull();
    const decision = director.update(desert, 54.01);
    expect(decision?.track.id).toBe('caravan-over-dunes');
    expect(decision?.reason).toBe('context');
    expect(decision?.fadeSec).toBe(3);
  });

  test('a biome change inside the minimum track time waits for it', () => {
    const director = new MusicDirector(tracks);
    director.update(forest, 0);
    expect(director.update(desert, 5)).toBeNull();
    expect(director.update(desert, 20)).toBeNull();
    expect(director.update(desert, 44.9)).toBeNull();
    expect(director.update(desert, 45.1)?.track.id).toBe('caravan-over-dunes');
  });

  test('a scene class change skips the minimum time and needs only the short hold', () => {
    const director = new MusicDirector(tracks);
    director.update(forest, 0);
    const game = ctx({ scene: 'area', biome: Biome.Forest, minigame: true });
    expect(director.update(game, 3)).toBeNull();
    expect(director.update(game, 4.4)).toBeNull();
    const decision = director.update(game, 4.6);
    expect(decision?.reason).toBe('class');
    expect(decision?.track.context).toContain('minigame');
  });

  test('map <-> 3D and entering a town are class changes', () => {
    const director = new MusicDirector(tracks);
    director.update(ctx({ scene: 'map', biome: Biome.Plains }), 0);
    const zoomed = ctx({ scene: 'area', biome: Biome.Forest });
    director.update(zoomed, 2);
    expect(director.update(zoomed, 3.6)?.reason).toBe('class');
    const town = ctx({ scene: 'area', biome: Biome.Forest, place: 'town' });
    director.update(town, 5);
    expect(director.update(town, 6.6)?.track.context).toContain('town');
  });

  test('when the playing track still fits the new context best, nothing switches', () => {
    const director = new MusicDirector(tracks);
    director.update(plains, 0);
    // A mountain and plains want the same tags: same key, so nothing is even pending.
    const mountain = ctx({ scene: 'area', biome: Biome.Mountain });
    expect(contextKey(mountain)).toBe(contextKey(plains));
    expect(director.update(mountain, 100)).toBeNull();
    expect(director.pending).toBeNull();
  });

  test('a long stay in a context with alternates rotates, never repeating the playing track', () => {
    const camp = ctx({ scene: 'area', camp: true });
    const director = new MusicDirector(tracks);
    const first = director.update(camp, 0);
    expect(director.update(camp, 100)).toBeNull();
    const second = director.update(camp, 450);
    expect(second?.reason).toBe('rotate');
    expect(second?.track.id).not.toBe(first?.track.id);
    const third = director.update(camp, 450 + 450);
    expect(third?.track.id).not.toBe(second?.track.id);
  });

  test('a one-track context never rotates', () => {
    const night = ctx({ scene: 'area', night: true });
    const director = new MusicDirector(tracks);
    director.update(night, 0);
    expect(director.update(night, 5000)).toBeNull();
  });

  test('a track that ends is replaced by another one that fits', () => {
    const camp = ctx({ scene: 'area', camp: true });
    const director = new MusicDirector(tracks);
    const first = director.update(camp, 0);
    director.trackEnded();
    const next = director.update(camp, 1);
    expect(next?.reason).toBe('ended');
    expect(next?.track.id).not.toBe(first?.track.id);
  });
});

describe('World Gen theme', () => {
  const plains = ctx({ scene: 'map', biome: Biome.Plains });
  const worldgen = ctx({ scene: 'worldgen' });

  test('World Gen plays its own theme, whatever the road was doing', () => {
    expect(sceneClass(worldgen)).toBe('worldgen');
    expect(pick({ scene: 'worldgen' }).track.id).toBe('worldgen-theme');
    expect(pick({ scene: 'worldgen', night: true, biome: Biome.Forest }).track.id).toBe(
      'worldgen-theme',
    );
    // ...and never on the road or the title.
    expect(pick({ scene: 'map', biome: Biome.Plains }).track.id).not.toBe('worldgen-theme');
    expect(pick({ scene: 'title' }).track.id).toBe('menu-theme');
  });

  test('leaving World Gen goes back to the interrupted road track, resumed', () => {
    const director = new MusicDirector(tracks);
    const road = director.update(plains, 0);
    expect(road?.track.id).toBe('on-the-road-happy-loop');
    director.update(worldgen, 100);
    const into = director.update(worldgen, 102);
    expect(into?.track.id).toBe('worldgen-theme');
    expect(into?.reason).toBe('class');
    director.update(plains, 300);
    const back = director.update(plains, 302);
    expect(back?.track.id).toBe('on-the-road-happy-loop');
    expect(back?.reason).toBe('resume');
    expect(back?.resume).toBe(true);
  });

  test('no resume when the interrupted track no longer fits', () => {
    const director = new MusicDirector(tracks);
    director.update(plains, 0);
    director.update(worldgen, 100);
    director.update(worldgen, 102);
    const desert = ctx({ scene: 'map', biome: Biome.Desert });
    director.update(desert, 300);
    const next = director.update(desert, 302);
    expect(next?.track.id).toBe('caravan-over-dunes');
    expect(next?.resume).toBeUndefined();
  });
});
