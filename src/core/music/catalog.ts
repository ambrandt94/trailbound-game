/**
 * Soundtrack catalog the game loads from `public/assets/audio/music/manifest.json`.
 * `tools/music-sync.mjs` writes that file from a Trailbound Asset Matrix export.
 */

export interface MusicTrack {
  id: string;
  name: string;
  /** File name next to the manifest. */
  file: string;
  loop: boolean;
  /** Context tags from the Matrix vocabulary. Inferred; Alex reviews them. */
  context: readonly string[];
  /** 0..1, how busy the track feels. */
  intensity: number;
  durationSec: number;
  kind: string;
  mood?: string;
  notes?: string;
}

export interface MusicCatalog {
  version: number;
  tracks: readonly MusicTrack[];
}

export const MUSIC_MANIFEST_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a manifest. A bad track is skipped, not fatal, so one typo in the
 * export never silences the whole soundtrack. `problems` lists what was dropped.
 */
export function parseMusicManifest(value: unknown): { catalog: MusicCatalog; problems: string[] } {
  const problems: string[] = [];
  const tracks: MusicTrack[] = [];
  if (
    !isRecord(value) ||
    value.version !== MUSIC_MANIFEST_VERSION ||
    !Array.isArray(value.tracks)
  ) {
    return {
      catalog: { version: MUSIC_MANIFEST_VERSION, tracks },
      problems: ['manifest is missing or has the wrong version'],
    };
  }
  const seen = new Set<string>();
  for (const raw of value.tracks) {
    const id = isRecord(raw) && typeof raw.id === 'string' ? raw.id : '?';
    if (
      !isRecord(raw) ||
      typeof raw.id !== 'string' ||
      typeof raw.file !== 'string' ||
      !Array.isArray(raw.context) ||
      !raw.context.every((tag) => typeof tag === 'string') ||
      typeof raw.intensity !== 'number' ||
      !(raw.intensity >= 0 && raw.intensity <= 1) ||
      typeof raw.durationSec !== 'number' ||
      !(raw.durationSec > 0)
    ) {
      problems.push(`track ${id} is malformed`);
      continue;
    }
    if (seen.has(raw.id)) {
      problems.push(`track ${raw.id} is listed twice`);
      continue;
    }
    seen.add(raw.id);
    tracks.push({
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : raw.id,
      file: raw.file,
      loop: raw.loop !== false,
      context: [...(raw.context as string[])],
      intensity: raw.intensity,
      durationSec: raw.durationSec,
      kind: typeof raw.kind === 'string' ? raw.kind : 'ambient',
      ...(typeof raw.mood === 'string' ? { mood: raw.mood } : {}),
      ...(typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
    });
  }
  return { catalog: { version: MUSIC_MANIFEST_VERSION, tracks }, problems };
}
