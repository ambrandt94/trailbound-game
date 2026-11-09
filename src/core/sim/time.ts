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

export interface DayLight {
  band: DayBand;
  /** 0..24, the sun slider's hour. */
  sunHour: number;
  sunIntensity: number;
  sunWarmth: number;
  hemi: number;
  haze: string;
  skyTop: string;
  skyHor: string;
  fog: number;
  /** 0..1 blue wash on the 2D map. */
  mapNight: number;
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

const LIGHT_KEYS: readonly LightKey[] = [
  {
    tu: 0,
    band: 'dawn',
    sunHour: 5.4,
    sunIntensity: 0.62,
    sunWarmth: 0.42,
    hemi: 0.74,
    haze: '#d7c4e4',
    skyTop: '#6d5c9e',
    skyHor: '#f0c2a4',
    fog: 0.9,
    mapNight: 0.14,
  },
  {
    tu: 10,
    band: 'day',
    sunHour: 8.4,
    sunIntensity: 1.05,
    sunWarmth: 0.08,
    hemi: 0.6,
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
    haze: '#c3e5f9',
    skyTop: '#61a0f9',
    skyHor: '#b1dcfd',
    fog: 1,
    mapNight: 0,
  },
  {
    tu: 60,
    band: 'dusk',
    sunHour: 17.4,
    sunIntensity: 0.92,
    sunWarmth: 0.48,
    hemi: 0.56,
    haze: '#efc8ae',
    skyTop: '#d27a62',
    skyHor: '#f2cba6',
    fog: 0.92,
    mapNight: 0.06,
  },
  {
    tu: 75,
    band: 'night',
    sunHour: 20.6,
    sunIntensity: 0.46,
    sunWarmth: -0.55,
    hemi: 0.72,
    haze: '#44567e',
    skyTop: '#24345c',
    skyHor: '#5a6c98',
    fog: 0.78,
    mapNight: 0.22,
  },
  {
    tu: 88,
    band: 'night',
    sunHour: 23,
    sunIntensity: 0.38,
    sunWarmth: -0.72,
    hemi: 0.8,
    haze: '#35466e',
    skyTop: '#1a2748',
    skyHor: '#4a5d88',
    fog: 0.72,
    mapNight: 0.3,
  },
  {
    tu: 100,
    band: 'dawn',
    sunHour: 5.4,
    sunIntensity: 0.62,
    sunWarmth: 0.42,
    hemi: 0.74,
    haze: '#d7c4e4',
    skyTop: '#6d5c9e',
    skyHor: '#f0c2a4',
    fog: 0.9,
    mapNight: 0.14,
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
    haze: lerpHex(prev.haze, next.haze, smooth),
    skyTop: lerpHex(prev.skyTop, next.skyTop, smooth),
    skyHor: lerpHex(prev.skyHor, next.skyHor, smooth),
    fog: lerp(prev.fog, next.fog, smooth),
    mapNight: lerp(prev.mapNight, next.mapNight, smooth),
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
