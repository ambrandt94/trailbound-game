/** Derived from Alex's biomes_48.json. Weights, priorities, and authored edge sets. */
export interface BiomeRim {
  lit: string;
  shaded: string;
  shadow: string;
}
export interface BiomeGround {
  id: number;
  priority: number;
  atlas: number[];
  weights: number[];
  rim: BiomeRim;
}
export const BIOME_GROUND: readonly BiomeGround[] = [
  {
    id: 0,
    priority: 0,
    atlas: [21],
    weights: [1],
    rim: {
      lit: '#EDDCAF',
      shaded: '#C4A478',
      shadow: '#C4A478',
    },
  },
  {
    id: 1,
    priority: 1,
    atlas: [22, 23, 24],
    weights: [0.4, 0.35, 0.25],
    rim: {
      lit: '#FCEBBE',
      shaded: '#E4B470',
      shadow: '#E4B470',
    },
  },
  {
    id: 2,
    priority: 7,
    atlas: [0, 1, 2, 3, 4, 5, 6],
    weights: [0.18, 0.18, 0.16, 0.14, 0.14, 0.1, 0.1],
    rim: {
      lit: '#86C23E',
      shaded: '#3A7A3E',
      shadow: '#3A7A3E',
    },
  },
  {
    id: 3,
    priority: 8,
    atlas: [25, 26, 5, 6],
    weights: [0.35, 0.35, 0.15, 0.15],
    rim: {
      lit: '#86C23E',
      shaded: '#3A7A3E',
      shadow: '#3A7A3E',
    },
  },
  {
    id: 4,
    priority: 10,
    atlas: [27, 28, 29],
    weights: [0.4, 0.35, 0.25],
    rim: {
      lit: '#72AE4A',
      shaded: '#38744A',
      shadow: '#38744A',
    },
  },
  {
    id: 5,
    priority: 12,
    atlas: [30, 31],
    weights: [0.55, 0.45],
    rim: {
      lit: '#5A9454',
      shaded: '#305E52',
      shadow: '#305E52',
    },
  },
  {
    id: 6,
    priority: 9,
    atlas: [32, 33],
    weights: [0.55, 0.45],
    rim: {
      lit: '#A2BC4C',
      shaded: '#58803E',
      shadow: '#58803E',
    },
  },
  {
    id: 7,
    priority: 5,
    atlas: [34, 35, 36],
    weights: [0.4, 0.35, 0.25],
    rim: {
      lit: '#DA985E',
      shaded: '#A2523E',
      shadow: '#A2523E',
    },
  },
  {
    id: 8,
    priority: 2,
    atlas: [37, 38, 39, 40],
    weights: [0.3, 0.25, 0.25, 0.2],
    rim: {
      lit: '#B08A56',
      shaded: '#76583E',
      shadow: '#76583E',
    },
  },
  {
    id: 9,
    priority: 6,
    atlas: [41, 42, 43],
    weights: [0.4, 0.35, 0.25],
    rim: {
      lit: '#ACA89E',
      shaded: '#5D5A66',
      shadow: '#5D5A66',
    },
  },
  {
    id: 10,
    priority: 13,
    atlas: [44, 45, 46],
    weights: [0.4, 0.35, 0.25],
    rim: {
      lit: '#F8FBF8',
      shaded: '#B4C6E6',
      shadow: '#B4C6E6',
    },
  },
  {
    id: 11,
    priority: 11,
    atlas: [47, 48],
    weights: [0.55, 0.45],
    rim: {
      lit: '#8CB06A',
      shaded: '#4C765A',
      shadow: '#4C765A',
    },
  },
  {
    id: 12,
    priority: 3,
    atlas: [49, 50, 51],
    weights: [0.4, 0.35, 0.25],
    rim: {
      lit: '#F9D896',
      shaded: '#DE9254',
      shadow: '#DE9254',
    },
  },
  {
    id: 13,
    priority: 12,
    atlas: [52, 53],
    weights: [0.55, 0.45],
    rim: {
      lit: '#56BA48',
      shaded: '#22764C',
      shadow: '#22764C',
    },
  },
  {
    id: 14,
    priority: 4,
    atlas: [54, 55, 56],
    weights: [0.4, 0.35, 0.25],
    rim: {
      lit: '#8E8488',
      shaded: '#544A58',
      shadow: '#544A58',
    },
  },
];
export const PAIR_BASE = new Map<string, number>([
  ['2:1', 60],
  ['3:1', 60],
  ['2:8', 72],
  ['3:8', 72],
  ['6:8', 72],
  ['10:9', 84],
]);
/** Bit mask (NW<<3 | NE<<2 | SE<<1 | SW) to the 12-edge index. */
export const EDGE_INDEX = new Map<number, number>([
  [12, 0],
  [3, 1],
  [9, 2],
  [6, 3],
  [8, 4],
  [4, 5],
  [2, 6],
  [1, 7],
  [7, 8],
  [11, 9],
  [13, 10],
  [14, 11],
]);
export const DIRT_EDGE_BASE = 8;
export const SANDSTONE_ROAD = 20;
export const DIRT_PATH = 7;
export const SAND_WET = 21;
