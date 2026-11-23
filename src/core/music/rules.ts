/**
 * The tag rules. Everything that decides which track plays lives in this one
 * table, so retuning the soundtrack is an edit here, not a code change.
 *
 * Tags come from the Asset Matrix vocabulary:
 * title, worldgen, map, travel-day, travel-night, camp, town, forest, desert, beach, grove, minigame.
 * How scoring works: a track earns `wanted[tag]` for each tag it carries that
 * the context asks for, loses `unwanted[tag]` for each place/biome tag it carries
 * that the context did not ask for, and earns an intensity-fit bonus. See `select.ts`.
 */
import { Biome } from '../world/models';

export interface TagWant {
  tag: string;
  weight: number;
}

export const MUSIC_RULES = {
  /** Scene by itself. */
  scene: {
    title: [{ tag: 'title', weight: 12 }],
    /** The World Gen screen has its own theme, asked for as strongly as the title's. */
    worldgen: [{ tag: 'worldgen', weight: 12 }],
    map: [{ tag: 'map', weight: 2.5 }],
    area: [],
  } satisfies Record<'title' | 'worldgen' | 'map' | 'area', TagWant[]>,

  /** A minigame is open: the minigame tag outranks everything else. */
  minigame: [{ tag: 'minigame', weight: 12 }] satisfies TagWant[],

  /** The caravan is halted. */
  camp: [{ tag: 'camp', weight: 7 }] satisfies TagWant[],

  /**
   * Place kind under the party (`describeMapStand().kind`).
   * Settlements are the town tag; groves, camps, and shores have their own.
   */
  place: {
    city: [{ tag: 'town', weight: 6 }],
    town: [{ tag: 'town', weight: 6 }],
    village: [{ tag: 'town', weight: 6 }],
    hamlet: [{ tag: 'town', weight: 6 }],
    grove: [{ tag: 'grove', weight: 6 }],
    camp: [{ tag: 'camp', weight: 6 }],
    'abandoned-camp': [{ tag: 'camp', weight: 4 }],
    shore: [{ tag: 'beach', weight: 4 }],
  } as Record<string, TagWant[]>,

  /** Biome under the party, the same ids the day-cycle HUD reads. */
  biome: {
    [Biome.Sand]: [{ tag: 'beach', weight: 3.5 }],
    [Biome.Forest]: [{ tag: 'forest', weight: 3.5 }],
    [Biome.DarkForest]: [{ tag: 'forest', weight: 3.5 }],
    [Biome.Taiga]: [{ tag: 'forest', weight: 3 }],
    [Biome.Jungle]: [{ tag: 'forest', weight: 3 }],
    [Biome.Marsh]: [{ tag: 'forest', weight: 1.5 }],
    [Biome.Desert]: [{ tag: 'desert', weight: 3.5 }],
    [Biome.Badlands]: [{ tag: 'desert', weight: 2.5 }],
    [Biome.Ashlands]: [{ tag: 'desert', weight: 1.5 }],
  } as Record<number, TagWant[]>,

  /** Time of day. Only open travel (map or 3D, not town, camp, or a minigame) uses it. */
  day: [{ tag: 'travel-day', weight: 2 }] satisfies TagWant[],
  night: [{ tag: 'travel-night', weight: 5 }] satisfies TagWant[],
  /** A track for the other half of the day loses this much while travelling. */
  wrongTimePenalty: { 'travel-day': 2, 'travel-night': 3 } as Record<string, number>,

  /**
   * A track that carries one of these tags the context did not ask for loses
   * this much, so a desert track does not play on the plains just because it is
   * also a travel-day track.
   */
  unwanted: {
    forest: 2.5,
    desert: 2.5,
    beach: 2.5,
    grove: 3,
    camp: 1,
    town: 2,
    minigame: 2,
    title: 8,
    worldgen: 8,
  } as Record<string, number>,

  /** Preferred intensity (0..1) per class, and how much the fit is worth. */
  intensity: {
    weight: 2,
    nightShift: -0.1,
    byClass: {
      title: 0.4,
      worldgen: 0.45,
      minigame: 0.65,
      camp: 0.28,
      town: 0.35,
      map: 0.55,
      travel: 0.3,
    },
    /** Settlement size nudges the town preference. */
    byPlace: { city: 0.6, town: 0.45, village: 0.3, hamlet: 0.25 } as Record<string, number>,
  },

  /** With nothing matching at all, score these tags instead. */
  fallback: [
    { tag: 'travel-day', weight: 2 },
    { tag: 'map', weight: 1 },
  ] satisfies TagWant[],

  /** The playing track gets this bonus when the context changes, so it stays unless something fits clearly better. */
  stickiness: 0.75,
  /** Tracks within this score of the best are interchangeable; the one played longest ago wins. */
  tieMargin: 0.45,

  timing: {
    /** Equal-power crossfade length, seconds. */
    crossfadeSec: 2.5,
    /** A new biome/time/place context must hold this long before the music follows. */
    holdSec: 4,
    /** A change of scene class (map/3D, town, camp, minigame, title) only needs this. */
    classHoldSec: 1.5,
    /** Stay on a track at least this long unless the scene class changes. */
    minTrackSec: 45,
    /** With alternates in the same context, move on after this long or two loops, whichever is longer. */
    rotateMinSec: 150,
    /** Fade-in from silence (first track after the autoplay unlock). */
    fadeInSec: 1.5,
  },
};

export type MusicRules = typeof MUSIC_RULES;
