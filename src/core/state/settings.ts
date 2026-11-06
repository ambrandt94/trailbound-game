export type MapSkinId = 'classic' | 'trailbound48';

export interface GameSettings {
  master: number;
  music: number;
  effects: number;
  voices: number;
  muteVoices: boolean;
  mapSkin: MapSkinId;
}

export const DEFAULT_SETTINGS: GameSettings = {
  master: 80,
  music: 70,
  effects: 80,
  voices: 40,
  muteVoices: false,
  mapSkin: 'trailbound48',
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
  return {
    master: clampPercent(record.master, DEFAULT_SETTINGS.master),
    music: clampPercent(record.music, DEFAULT_SETTINGS.music),
    effects: clampPercent(record.effects, DEFAULT_SETTINGS.effects),
    voices: clampPercent(record.voices, DEFAULT_SETTINGS.voices),
    muteVoices:
      typeof record.muteVoices === 'boolean' ? record.muteVoices : DEFAULT_SETTINGS.muteVoices,
    mapSkin: record.mapSkin === 'classic' ? 'classic' : 'trailbound48',
  };
}
