import {
  DEFAULT_MAP_SPEED,
  DEFAULT_ON_FOOT_SPEED,
  DEFAULT_ZONE_WAGON_SPEED,
  DEFAULT_TIME_ONLY_WHEN_MOVING,
  normalizeMapSpeed,
  normalizeOnFootSpeed,
  normalizeZoneWagonSpeed,
  type MapSpeed,
} from '../sim/map-pace';
import { DEFAULT_AREA_LOOK, normalizeAreaLook, type AreaLook } from './area-look';

export type MapSkinId = 'classic' | 'trailbound48';

/** Which collapsible HUD panels stay open between sessions. Everything starts closed. */
export interface HudPrefs {
  /** Caravan details card (route, pace, buttons). */
  caravan: boolean;
  /** Controls cheat-sheet. */
  help: boolean;
  /** Draw the serpentine day strip at 1 art pixel per CSS pixel instead of the auto size. */
  daySmall: boolean;
}

export const DEFAULT_HUD_PREFS: HudPrefs = { caravan: false, help: false, daySmall: false };

export function normalizeHudPrefs(value: unknown): HudPrefs {
  const record = isRecord(value) ? value : {};
  return {
    caravan: typeof record.caravan === 'boolean' ? record.caravan : DEFAULT_HUD_PREFS.caravan,
    help: typeof record.help === 'boolean' ? record.help : DEFAULT_HUD_PREFS.help,
    daySmall: typeof record.daySmall === 'boolean' ? record.daySmall : DEFAULT_HUD_PREFS.daySmall,
  };
}

export interface GameSettings {
  master: number;
  music: number;
  effects: number;
  voices: number;
  muteVoices: boolean;
  mapSkin: MapSkinId;
  /**
   * When set, the sun slider holds the time of day.
   * Otherwise the shared clock drives sun, sky, and fog.
   */
  lockTimeOfDay: boolean;
  /** Map only: the clock and caravan wait until the hero moves. Default on. */
  timeOnlyWhenMoving: boolean;
  /** Map only: 1x/2x/4x/8x on the hero, caravan, other movers, and the clock. 3D wagon has `zoneWagonSpeed`. */
  mapSpeed: MapSpeed;
  /** Map only: hero's on-foot pace as a multiple of the wagon's map pace, 1.0–2.0. */
  onFootSpeed: number;
  /** 3D only: the wagon's pace in a zone, metres per second, 1.0–6.0. Independent of `mapSpeed`. */
  zoneWagonSpeed: number;
  /** Map only: outline the last zones entered (wild blocks and towns). Default on. */
  zoneOutlines: boolean;
  /** Map only: dashed preview of the zone a zoom-in would open. Default on. */
  zonePreview: boolean;
  /** 3D area look, camera, and controller feel. Lives with the other preferences. */
  look: AreaLook;
  /** Collapsible HUD panels. */
  hud: HudPrefs;
}

export const DEFAULT_SETTINGS: GameSettings = {
  master: 80,
  music: 70,
  effects: 80,
  voices: 40,
  muteVoices: false,
  mapSkin: 'classic',
  lockTimeOfDay: false,
  timeOnlyWhenMoving: DEFAULT_TIME_ONLY_WHEN_MOVING,
  mapSpeed: DEFAULT_MAP_SPEED,
  onFootSpeed: DEFAULT_ON_FOOT_SPEED,
  zoneWagonSpeed: DEFAULT_ZONE_WAGON_SPEED,
  zoneOutlines: true,
  zonePreview: true,
  look: DEFAULT_AREA_LOOK,
  hud: DEFAULT_HUD_PREFS,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampPercent(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function normalizeSettings(value: unknown): GameSettings {
  const record = isRecord(value) ? value : {};
  const outlines =
    typeof record.zoneOutlines === 'boolean' ? record.zoneOutlines : DEFAULT_SETTINGS.zoneOutlines;
  return {
    master: clampPercent(record.master, DEFAULT_SETTINGS.master),
    music: clampPercent(record.music, DEFAULT_SETTINGS.music),
    effects: clampPercent(record.effects, DEFAULT_SETTINGS.effects),
    voices: clampPercent(record.voices, DEFAULT_SETTINGS.voices),
    muteVoices:
      typeof record.muteVoices === 'boolean' ? record.muteVoices : DEFAULT_SETTINGS.muteVoices,
    mapSkin: record.mapSkin === 'trailbound48' ? 'trailbound48' : 'classic',
    lockTimeOfDay: record.lockTimeOfDay === true,
    timeOnlyWhenMoving:
      typeof record.timeOnlyWhenMoving === 'boolean'
        ? record.timeOnlyWhenMoving
        : DEFAULT_SETTINGS.timeOnlyWhenMoving,
    mapSpeed: normalizeMapSpeed(record.mapSpeed),
    onFootSpeed: normalizeOnFootSpeed(record.onFootSpeed),
    // Saves from before this setting get the 2.5 m/s default.
    zoneWagonSpeed: normalizeZoneWagonSpeed(record.zoneWagonSpeed),
    zoneOutlines: outlines,
    // Saves from before the split had one `zoneOutlines` switch for both.
    zonePreview:
      typeof record.zonePreview === 'boolean'
        ? record.zonePreview
        : typeof record.zoneOutlines === 'boolean'
          ? record.zoneOutlines
          : DEFAULT_SETTINGS.zonePreview,
    look: normalizeAreaLook(record.look),
    hud: normalizeHudPrefs(record.hud),
  };
}
