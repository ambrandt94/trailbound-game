export interface ManifestTrack {
  id: string;
  name: string;
  file: string;
  loop: boolean;
  context: string[];
  intensity: number;
  durationSec: number;
  kind: string;
  mood?: string;
  notes?: string;
}
export interface MusicManifestFile {
  version: number;
  source: string;
  bundleGeneratedAt: string | null;
  vocabulary: string[];
  tracks: ManifestTrack[];
}
export const MUSIC_ROOT: string;
export const MANIFEST_VERSION: number;
export function buildManifest(
  catalog: unknown,
  options?: { bundleDir?: string; maxBytes?: number },
): MusicManifestFile;
export function syncMusic(
  bundleDir: string,
  options?: { destRoot?: string; maxBytes?: number },
): { tracks: number; bytes: number; dest: string };
