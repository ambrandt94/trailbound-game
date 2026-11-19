import { Biome } from '../../src/core/world/models';
import { DEFAULT_MUSIC_CONTEXT, type MusicContext } from '../../src/core/music/context';

export interface Scenario {
  name: string;
  ctx: MusicContext;
}

const c = (patch: Partial<MusicContext>): MusicContext => ({ ...DEFAULT_MUSIC_CONTEXT, ...patch });

/** The contexts the PR table and the tests walk through. */
export const SCENARIOS: Scenario[] = [
  { name: 'Title screen', ctx: c({ scene: 'title' }) },
  { name: 'Map, day, plains', ctx: c({ scene: 'map', biome: Biome.Plains }) },
  { name: 'Map, day, forest', ctx: c({ scene: 'map', biome: Biome.Forest }) },
  { name: 'Map, day, desert', ctx: c({ scene: 'map', biome: Biome.Desert }) },
  { name: 'Map, day, sand coast', ctx: c({ scene: 'map', biome: Biome.Sand }) },
  { name: 'Map, night, plains', ctx: c({ scene: 'map', biome: Biome.Plains, night: true }) },
  { name: '3D travel, day, plains', ctx: c({ scene: 'area', biome: Biome.Plains }) },
  { name: '3D travel, day, forest', ctx: c({ scene: 'area', biome: Biome.Forest }) },
  { name: '3D travel, day, dark forest', ctx: c({ scene: 'area', biome: Biome.DarkForest }) },
  { name: '3D travel, day, desert', ctx: c({ scene: 'area', biome: Biome.Desert }) },
  { name: '3D travel, day, sand (beach)', ctx: c({ scene: 'area', biome: Biome.Sand }) },
  { name: '3D travel, day, mountain', ctx: c({ scene: 'area', biome: Biome.Mountain }) },
  { name: '3D travel, night, plains', ctx: c({ scene: 'area', biome: Biome.Plains, night: true }) },
  { name: '3D travel, night, forest', ctx: c({ scene: 'area', biome: Biome.Forest, night: true }) },
  { name: '3D, holy grove', ctx: c({ scene: 'area', biome: Biome.Meadow, place: 'grove' }) },
  {
    name: '3D, hamlet (day)',
    ctx: c({ scene: 'area', biome: Biome.Plains, place: 'hamlet' }),
  },
  {
    name: '3D, city (day)',
    ctx: c({ scene: 'area', biome: Biome.Plains, place: 'city' }),
  },
  {
    name: '3D, town (night)',
    ctx: c({ scene: 'area', biome: Biome.Plains, place: 'town', night: true }),
  },
  {
    name: 'Map, in a town',
    ctx: c({ scene: 'map', biome: Biome.Plains, place: 'town' }),
  },
  {
    name: 'Camp (caravan halted), day',
    ctx: c({ scene: 'area', biome: Biome.Forest, camp: true }),
  },
  {
    name: 'Camp (caravan halted), night',
    ctx: c({ scene: 'area', biome: Biome.Forest, camp: true, night: true }),
  },
  { name: 'Minigame open (3D)', ctx: c({ scene: 'area', biome: Biome.Forest, minigame: true }) },
  {
    name: 'Minigame open in town',
    ctx: c({ scene: 'area', place: 'town', minigame: true }),
  },
];
