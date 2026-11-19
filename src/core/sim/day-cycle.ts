/**
 * Pure math for the 100-TU serpentine day-cycle HUD. No drawing here.
 *
 * The HUD counts TU *remaining* in the day and drains right to left.
 * 100 remaining is dawn (05:00 on the HUD's clock face), 0 remaining wraps to
 * the same dawn. The game's own clock counts time since dawn (`tuOfDay`), so
 * `tuRemaining = 100 - tuOfDay(clockHours)`.
 */
import { TU_PER_DAY, tuOfDay } from './time';

/** One TU on the clock face: 24 h / 100. */
export const MINUTES_PER_TU = 14.4;
/** Hour of day the HUD's clock face shows at dawn (100 TU left). */
export const DAY_START_HOUR = 5;

export type Rgb = readonly [number, number, number];

// ---------------------------------------------------------------- seasons

export type SeasonId = 'summer' | 'spring' | 'autumn' | 'winter';

export interface SeasonPreset {
  id: SeasonId;
  label: string;
  /** Fraction of the day elapsed (since dawn) at sunrise. */
  sunriseElapsed: number;
  /** Fraction of the day elapsed (since dawn) at sunset. */
  sunsetElapsed: number;
}

export const SEASONS: Readonly<Record<SeasonId, SeasonPreset>> = {
  summer: { id: 'summer', label: 'Summer', sunriseElapsed: 0.03, sunsetElapsed: 0.66 },
  spring: { id: 'spring', label: 'Spring Equinox', sunriseElapsed: 0.06, sunsetElapsed: 0.58 },
  autumn: { id: 'autumn', label: 'Autumn Equinox', sunriseElapsed: 0.07, sunsetElapsed: 0.57 },
  winter: { id: 'winter', label: 'Winter', sunriseElapsed: 0.1, sunsetElapsed: 0.5 },
};

export const DEFAULT_SEASON: SeasonId = 'summer';

export interface DayThresholds {
  /** TU remaining when the sun comes up. */
  sunriseTU: number;
  /** TU remaining when the sun goes down. */
  sunsetTU: number;
  /** Midpoint of the daylight span, where the sun peaks. */
  noonTU: number;
  /** Midpoint of the night, where the moon peaks. */
  midnightTU: number;
  /** TU between sunset and the next sunrise, across the wrap. */
  nightLengthTU: number;
}

export function thresholdsFor(season: SeasonId | SeasonPreset = DEFAULT_SEASON): DayThresholds {
  const preset = typeof season === 'string' ? SEASONS[season] : season;
  const sunriseTU = Math.round(TU_PER_DAY * (1 - preset.sunriseElapsed));
  const sunsetTU = Math.round(TU_PER_DAY * (1 - preset.sunsetElapsed));
  const nightLengthTU = sunsetTU + (TU_PER_DAY - sunriseTU);
  return {
    sunriseTU,
    sunsetTU,
    noonTU: Math.floor((sunriseTU + sunsetTU) / 2),
    midnightTU: Math.floor(sunsetTU - nightLengthTU / 2),
    nightLengthTU,
  };
}

// ------------------------------------------------------------- game clock

/** TU remaining in the current day for a game clock, in `(0, 100]`. */
export function tuRemainingAt(clockHours: number): number {
  return TU_PER_DAY - tuOfDay(clockHours);
}

/** Beads lit for a continuous TU: the unit being spent still counts, so 99.2 lights 100. */
export function litUnits(tuRemaining: number): number {
  if (!Number.isFinite(tuRemaining)) return TU_PER_DAY;
  return Math.min(TU_PER_DAY, Math.max(0, Math.ceil(tuRemaining - 1e-9)));
}

export interface ClockLabel {
  hour24: number;
  minute: number;
  /** "10:17 AM" */
  long: string;
  /** "10:17A", for the tooltip pill. */
  short: string;
}

/**
 * Clock face for a whole TU remaining:
 * `(startHour*60 + round(elapsedTU * 14.4)) % 1440`.
 */
export function clockLabelFor(tuRemaining: number, startHour = DAY_START_HOUR): ClockLabel {
  const elapsed = TU_PER_DAY - tuRemaining;
  const totalMins =
    (((startHour * 60 + Math.round(elapsed * MINUTES_PER_TU)) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(totalMins / 60);
  const minute = totalMins % 60;
  const pm = hour24 >= 12;
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const mm = String(minute).padStart(2, '0');
  return {
    hour24,
    minute,
    long: `${String(h12).padStart(2, '0')}:${mm} ${pm ? 'PM' : 'AM'}`,
    short: `${h12}:${mm}${pm ? 'P' : 'A'}`,
  };
}

// ---------------------------------------------------------------- colours

export const PAL = {
  frameOuter: '#1c1610',
  frameDark: '#6e4e24',
  frameMid: '#b58938',
  frameLight: '#f3cf7a',
  wellBg: '#0c0e16',
  socketEmpty: '#191e2e',
  text: '#e8c97a',
  dawnCoral: '#fb923c',
  morningGold: '#fde047',
  highNoon: '#fef08a',
  afternoon: '#f59e0b',
  sunsetOrange: '#ea580c',
  duskViolet: '#8b5cf6',
  midnightBlue: '#2563eb',
  preDawnIndigo: '#312e81',
} as const;

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(c: Rgb): string {
  const b = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${b(c[0])}${b(c[1])}${b(c[2])}`;
}

export function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

function mix(a: string, b: string, t: number): Rgb {
  return lerpRgb(hexToRgb(a), hexToRgb(b), t);
}

/** Phase colour of one bead (unit 1..100): pre-dawn indigo, coral, gold, amber, sunset, violet, blue. */
export function unitColor(unit: number, th: DayThresholds): Rgb {
  const { sunriseTU, sunsetTU, noonTU } = th;
  if (unit > sunriseTU) {
    return mix(PAL.preDawnIndigo, PAL.dawnCoral, (100 - unit) / Math.max(1, 100 - sunriseTU));
  }
  if (unit >= sunsetTU) {
    if (unit >= noonTU) {
      const t = (sunriseTU - unit) / Math.max(1, sunriseTU - noonTU);
      return t < 0.35
        ? mix(PAL.dawnCoral, PAL.morningGold, t / 0.35)
        : mix(PAL.morningGold, PAL.highNoon, (t - 0.35) / 0.65);
    }
    const t = (noonTU - unit) / Math.max(1, noonTU - sunsetTU);
    return t < 0.65
      ? mix(PAL.highNoon, PAL.afternoon, t / 0.65)
      : mix(PAL.afternoon, PAL.sunsetOrange, (t - 0.65) / 0.35);
  }
  const night = (sunsetTU - unit) / Math.max(1, sunsetTU);
  if (night < 0.18) return mix(PAL.sunsetOrange, PAL.duskViolet, night / 0.18);
  if (night < 0.55) return mix(PAL.duskViolet, PAL.midnightBlue, (night - 0.18) / 0.37);
  return mix(PAL.midnightBlue, PAL.preDawnIndigo, (night - 0.55) / 0.45);
}

export type DayPhase = 'preSunrise' | 'morning' | 'afternoon' | 'sunset' | 'night';

export function isDaylight(tuRemaining: number, th: DayThresholds): boolean {
  return tuRemaining <= th.sunriseTU && tuRemaining >= th.sunsetTU;
}

export function phaseAt(tuRemaining: number, th: DayThresholds): DayPhase {
  if (tuRemaining > th.sunriseTU) return 'preSunrise';
  if (tuRemaining >= th.noonTU) return 'morning';
  if (tuRemaining > th.sunsetTU + 3) return 'afternoon';
  if (tuRemaining >= th.sunsetTU - 3) return 'sunset';
  return 'night';
}

// -------------------------------------------------------------------- sky

export interface SkyState {
  top: Rgb;
  mid: Rgb;
  horizon: Rgb;
  ground: Rgb;
  glowColor: Rgb;
  /** 0..1 band of light along the horizon at dawn and dusk. */
  glowAlpha: number;
  starAlpha: number;
  daylight: boolean;
  /** Sun while daylight, moon while night: 0..1 across the strip (1 = right) and 0..1 height. */
  bodyX: number;
  bodyElev: number;
}

/** Sky and the sun/moon glide for a continuous `tuFloat`. The strip is read straight into three stops. */
export function skyAt(tuFloat: number, th: DayThresholds): SkyState {
  const { sunriseTU, sunsetTU, nightLengthTU } = th;
  const tu = Math.max(0, Math.min(TU_PER_DAY, tuFloat));
  const daylight = isDaylight(tu, th);
  let top: Rgb;
  let mid: Rgb;
  let horizon: Rgb;
  let ground: Rgb;
  let glowAlpha = 0;
  let glowColor: Rgb = hexToRgb('#fb923c');
  let starAlpha = 0;
  let bodyX: number;
  let bodyElev: number;
  if (daylight) {
    const dayNorm = (sunriseTU - tu) / Math.max(1, sunriseTU - sunsetTU);
    const elev = Math.sin(dayNorm * Math.PI);
    if (dayNorm < 0.18) {
      const t = dayNorm / 0.18;
      top = mix('#1e1b4b', '#1d4ed8', t);
      mid = mix('#6b21a8', '#2563eb', t);
      horizon = mix('#fb923c', '#93c5fd', Math.pow(t, 1.15));
      glowAlpha = (1 - t) * 0.85;
      starAlpha = Math.max(0, (1 - t * 1.6) * 0.5);
    } else if (dayNorm > 0.82) {
      const t = (dayNorm - 0.82) / 0.18;
      top = mix('#1d4ed8', '#1e1b4b', t);
      mid = mix('#2563eb', '#6b21a8', t);
      horizon = mix('#93c5fd', '#f97316', Math.pow(t, 0.85));
      glowAlpha = t * 0.9;
      glowColor = hexToRgb('#f97316');
      starAlpha = Math.max(0, (t - 0.4) * 0.8);
    } else {
      const nf = Math.max(0, (elev - 0.35) / 0.65);
      top = mix('#1d4ed8', '#0284c7', nf);
      mid = mix('#2563eb', '#38bdf8', nf);
      horizon = mix('#93c5fd', '#bae6fd', nf);
    }
    ground = mix('#1e3a2f', '#16a34a', Math.pow(elev, 0.6));
    bodyX = 0.9 - dayNorm * 0.8;
    bodyElev = elev;
  } else {
    const elapsedNight = tu < sunsetTU ? sunsetTU - tu : sunsetTU + (TU_PER_DAY - tu);
    const nightNorm = elapsedNight / Math.max(1, nightLengthTU);
    // Deep navy, never black: the night sky stays readable against the frame.
    const nTop = '#0c1233';
    const nMid = '#142048';
    const nHor = '#1f3a72';
    if (nightNorm < 0.15) {
      const t = nightNorm / 0.15;
      top = mix('#1e1b4b', nTop, t);
      mid = mix('#4c1d95', nMid, t);
      horizon = mix('#ea580c', nHor, Math.pow(t, 0.75));
      glowAlpha = (1 - t) * 0.75;
      glowColor = hexToRgb('#ea580c');
      starAlpha = 0.45 + t * 0.55;
    } else if (nightNorm > 0.85) {
      const t = (nightNorm - 0.85) / 0.15;
      top = mix(nTop, '#1e1b4b', t);
      mid = mix(nMid, '#4c1d95', t);
      horizon = mix(nHor, '#fb923c', Math.pow(t, 1.25));
      glowAlpha = t * 0.75;
      starAlpha = 1 - t * 0.55;
    } else {
      top = hexToRgb(nTop);
      mid = hexToRgb(nMid);
      horizon = hexToRgb(nHor);
      starAlpha = 1;
    }
    ground = hexToRgb('#0f1626');
    bodyX = 0.88 - Math.min(1, nightNorm) * 0.76;
    bodyElev = Math.sin(Math.min(1, nightNorm) * Math.PI);
  }
  return { top, mid, horizon, ground, glowColor, glowAlpha, starAlpha, daylight, bodyX, bodyElev };
}

// ------------------------------------------------------------ serpentine

export interface NodeLayout {
  count: number;
  padX: number;
  stepX: number;
  centerY: number;
  amplitude: number;
  cycles: number;
}

export interface HudNode {
  /** Unit number, 1 (left) .. count (right). */
  unit: number;
  x: number;
  y: number;
}

/** `x[i] = padX + i*stepX`, `y[i] = centerY + sin(t*2π*cycles) * amplitude`, `t = i/(count-1)`. */
export function serpentineNode(i: number, layout: NodeLayout, scale = 1): HudNode {
  const t = layout.count > 1 ? i / (layout.count - 1) : 0;
  return {
    unit: i + 1,
    x: (layout.padX + i * layout.stepX) * scale,
    y: (layout.centerY + Math.sin(t * Math.PI * 2 * layout.cycles) * layout.amplitude) * scale,
  };
}

let bakedKey = '';
let baked: readonly HudNode[] = [];

/** All node positions, baked once. They are recomputed only when the layout or scale changes. */
export function bakeNodes(layout: NodeLayout, scale = 1): readonly HudNode[] {
  const key = `${layout.count}|${layout.padX}|${layout.stepX}|${layout.centerY}|${layout.amplitude}|${layout.cycles}|${scale}`;
  if (key !== bakedKey) {
    baked = Array.from({ length: layout.count }, (_, i) => serpentineNode(i, layout, scale));
    bakedKey = key;
  }
  return baked;
}
