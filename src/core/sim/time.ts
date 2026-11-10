/**
 * One shared clock, stored in game hours. A day is 24 hours and 100 time
 * units, so activities can spend TU without a second clock.
 * Inside a 3D area the same clock runs at `AREA_TIME_SCALE`.
 */
import { GAME_HOURS_PER_REAL_SECOND } from './clock';

export const TU_PER_DAY = 100;
export const HOURS_PER_DAY = 24;
export const HOURS_PER_TU = HOURS_PER_DAY / TU_PER_DAY;
/** Areas run at about one third of the map's full clock. */
export const AREA_TIME_SCALE = 0.33;
/** After this TU only Sleep is offered at the wagon. */
export const SLEEP_ONLY_TU = 90;

export type DayBand = 'dawn' | 'day' | 'dusk' | 'night';

/** Directional key at warmth 0. Noon cream. */
export const KEY_LIGHT_NEUTRAL = '#fff0c8';
/** Directional key at warmth +1. Sunset orange. */
export const KEY_LIGHT_WARM = '#ffb060';
/**
 * Directional key at warmth -1. Pale blue-white moonlight.
 * A saturated cobalt (the old #6a8ee0) replaces albedo hue, and the cel
 * bands then posterize the complement into magenta and teal.
 */
export const KEY_LIGHT_COOL = '#d0e6ff';
/** Hemisphere sky at warmth 0. */
export const HEMI_SKY_NEUTRAL = '#bfe6ff';
/** Hemisphere sky at warmth +1. */
export const HEMI_SKY_WARM = '#ffc090';
/**
 * Hemisphere sky at warmth -1. Soft blue fill.
 * The old #4a68b0 turned uncelled props into flat cobalt blocks.
 */
export const HEMI_SKY_COOL = '#8eadd4';

export interface DayLight {
  band: DayBand;
  /** 0..24, the sun slider's hour. A low hour lays long shadows. */
  sunHour: number;
  sunIntensity: number;
  sunWarmth: number;
  /** Fill light. Night keeps this low so the scene is not a dim noon. */
  hemi: number;
  /** Shadow hue. Above 1 cools toward blue; below 1 warms the shade. */
  shadeCool: number;
  /** Shadow penumbra. Higher is softer. */
  shadowSoft: number;
  /** Multiplier on grass texels. White leaves the map colour alone. */
  grass: string;
  haze: string;
  skyTop: string;
  skyHor: string;
  fog: number;
  /** 0..1 blue wash on the 2D map. */
  mapNight: number;
  /**
   * Exposure applied by the area grade. The screen composite then raises
   * linear colour by about pow(c, 0.38), so night has to be cut here or the
   * framebuffer stays near dusk.
   */
  bright: number;
}

/** TU position inside the current day, in `[0, 100)`. */
export function tuOfDay(clockHours: number): number {
  const hours = Number.isFinite(clockHours) ? clockHours : 0;
  const wrapped = ((hours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  return (wrapped / HOURS_PER_DAY) * TU_PER_DAY;
}

export function hoursForTu(tu: number): number {
  if (!Number.isFinite(tu) || tu <= 0) return 0;
  return tu * HOURS_PER_TU;
}

/** Hours until the next TU 0, the start of the dawn band. */
export function hoursUntilNextDawn(clockHours: number): number {
  const hours = Number.isFinite(clockHours) ? clockHours : 0;
  const day = Math.floor(hours / HOURS_PER_DAY);
  const next = (day + 1) * HOURS_PER_DAY;
  const delta = next - hours;
  return delta > 1e-6 ? delta : HOURS_PER_DAY;
}

export function areaHoursPerRealSec(hoursPerRealSec = GAME_HOURS_PER_REAL_SECOND): number {
  return hoursPerRealSec * AREA_TIME_SCALE;
}

export function dayBand(tu: number): DayBand {
  const t = ((tu % TU_PER_DAY) + TU_PER_DAY) % TU_PER_DAY;
  if (t < 10) return 'dawn';
  if (t < 60) return 'day';
  if (t < 75) return 'dusk';
  return 'night';
}

interface LightKey extends DayLight {
  tu: number;
}

const DAY_FILL = {
  shadeCool: 1,
  shadowSoft: 1,
  grass: '#ffffff',
  bright: 1,
} as const;

const LIGHT_KEYS: readonly LightKey[] = [
  {
    tu: 0,
    band: 'dawn',
    sunHour: 5.2,
    sunIntensity: 0.62,
    sunWarmth: 0.45,
    hemi: 0.5,
    shadeCool: 0.85,
    shadowSoft: 1.4,
    grass: '#ffe8d4',
    haze: '#f0c4a4',
    skyTop: '#6d5c9e',
    skyHor: '#f0b898',
    fog: 1.05,
    mapNight: 0.16,
    bright: 1,
  },
  {
    tu: 10,
    band: 'day',
    sunHour: 8.6,
    sunIntensity: 1.05,
    sunWarmth: 0.06,
    hemi: 0.58,
    ...DAY_FILL,
    haze: '#c3e5f9',
    skyTop: '#61a0f9',
    skyHor: '#b1dcfd',
    fog: 1,
    mapNight: 0,
  },
  {
    tu: 36,
    band: 'day',
    sunHour: 12.2,
    sunIntensity: 1.15,
    sunWarmth: 0,
    hemi: 0.58,
    ...DAY_FILL,
    haze: '#c3e5f9',
    skyTop: '#61a0f9',
    skyHor: '#b1dcfd',
    fog: 1,
    mapNight: 0,
  },
  {
    tu: 60,
    band: 'dusk',
    sunHour: 17.6,
    sunIntensity: 0.7,
    sunWarmth: 0.85,
    hemi: 0.4,
    shadeCool: 0.55,
    shadowSoft: 1.5,
    grass: '#ffd8b4',
    haze: '#e09060',
    skyTop: '#c45232',
    skyHor: '#f0a060',
    fog: 1.15,
    mapNight: 0.08,
    bright: 1,
  },
  {
    tu: 72,
    band: 'dusk',
    sunHour: 18.8,
    sunIntensity: 0.58,
    sunWarmth: 1,
    hemi: 0.34,
    shadeCool: 0.48,
    shadowSoft: 1.8,
    grass: '#ffc898',
    haze: '#d07040',
    skyTop: '#a83c28',
    skyHor: '#e88848',
    fog: 1.25,
    mapNight: 0.12,
    bright: 0.92,
  },
  {
    /* Moon, not a cobalt grade. shadeCool stays near 1 so the 20° shadow
       hue does not spin roofs through magenta. Grass stays near white so
       the ground keeps its own green. */
    tu: 82,
    band: 'night',
    sunHour: 4.8,
    sunIntensity: 0.26,
    sunWarmth: -0.74,
    hemi: 0.22,
    shadeCool: 1.12,
    shadowSoft: 2.05,
    grass: '#e8eef6',
    haze: '#3c4a68',
    skyTop: '#161e42',
    skyHor: '#2c3e6c',
    fog: 1.08,
    mapNight: 0.42,
    bright: 0.48,
  },
  {
    tu: 94,
    band: 'night',
    sunHour: 4.4,
    sunIntensity: 0.22,
    sunWarmth: -0.82,
    hemi: 0.2,
    shadeCool: 1.16,
    shadowSoft: 2.2,
    grass: '#e6ecf4',
    haze: '#364462',
    skyTop: '#121838',
    skyHor: '#263860',
    fog: 1.12,
    mapNight: 0.48,
    bright: 0.42,
  },
  {
    tu: 100,
    band: 'dawn',
    sunHour: 5.2,
    sunIntensity: 0.62,
    sunWarmth: 0.45,
    hemi: 0.5,
    shadeCool: 0.85,
    shadowSoft: 1.4,
    grass: '#ffe8d4',
    haze: '#f0c4a4',
    skyTop: '#6d5c9e',
    skyHor: '#f0b898',
    fog: 1.05,
    mapNight: 0.16,
    bright: 1,
  },
];

/** Smooth sun, sky, and fog for this clock. Band edges blend through the keys. */
export function dayLightAt(clockHours: number): DayLight {
  const tu = tuOfDay(clockHours);
  let prev = LIGHT_KEYS[0]!;
  let next = LIGHT_KEYS[1]!;
  for (let i = 1; i < LIGHT_KEYS.length; i++) {
    const key = LIGHT_KEYS[i]!;
    prev = LIGHT_KEYS[i - 1]!;
    next = key;
    if (tu <= key.tu) break;
  }
  const span = Math.max(1e-6, next.tu - prev.tu);
  const t = Math.min(1, Math.max(0, (tu - prev.tu) / span));
  const smooth = t * t * (3 - 2 * t);
  return {
    band: dayBand(tu),
    sunHour: lerpHour(prev.sunHour, next.sunHour, smooth),
    sunIntensity: lerp(prev.sunIntensity, next.sunIntensity, smooth),
    sunWarmth: lerp(prev.sunWarmth, next.sunWarmth, smooth),
    hemi: lerp(prev.hemi, next.hemi, smooth),
    shadeCool: lerp(prev.shadeCool, next.shadeCool, smooth),
    shadowSoft: lerp(prev.shadowSoft, next.shadowSoft, smooth),
    grass: lerpHex(prev.grass, next.grass, smooth),
    haze: lerpHex(prev.haze, next.haze, smooth),
    skyTop: lerpHex(prev.skyTop, next.skyTop, smooth),
    skyHor: lerpHex(prev.skyHor, next.skyHor, smooth),
    fog: lerp(prev.fog, next.fog, smooth),
    mapNight: lerp(prev.mapNight, next.mapNight, smooth),
    bright: lerp(prev.bright, next.bright, smooth),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clock hours wrap at midnight, so night eases toward dawn instead of back through afternoon. */
function lerpHour(a: number, b: number, t: number): number {
  let from = a;
  let to = b;
  if (to < from - 12) to += 24;
  if (from < to - 12) from += 24;
  const value = from + (to - from) * t;
  return ((value % 24) + 24) % 24;
}

function lerpHex(a: string, b: string, t: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  const r = Math.round(lerp(from[0], to[0], t));
  const g = Math.round(lerp(from[1], to[1], t));
  const bl = Math.round(lerp(from[2], to[2], t));
  return `#${byte(r)}${byte(g)}${byte(bl)}`;
}

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function byte(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}
