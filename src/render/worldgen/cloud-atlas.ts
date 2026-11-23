/**
 * Alex's pixel-art cloud set ("Cloud & Mist Map Assets"), sliced by a box-side
 * script into one 1× atlas + rects JSON under `assets/worldgen/clouds/`.
 * Always drawn with nearest filtering at a whole-number scale. When the atlas
 * fails to load the Regions view falls back to procedural clouds.
 */
export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CloudAtlasMeta {
  version: number;
  size: [number, number];
  sprites: Record<string, AtlasRect>;
  tiles: { coverA: string; coverB: string; haze: string; veil: string };
  edges: { corners: string[]; north: string[]; south: string[] };
  puffs: string[];
  shadows: string[];
  anims: Record<string, { frames: string[]; fps: number }>;
}

export interface CloudAtlas {
  meta: CloudAtlasMeta;
  image: HTMLImageElement;
  rect(name: string): AtlasRect;
}

export const CLOUD_ATLAS_DIR = 'assets/worldgen/clouds/';

/** Parse and check the rects JSON (throws on anything missing). */
export function parseCloudAtlas(raw: unknown): CloudAtlasMeta {
  const m = raw as CloudAtlasMeta;
  if (!m || m.version !== 1 || !m.sprites || !m.tiles || !m.edges || !m.anims) {
    throw new Error('cloud atlas: bad JSON');
  }
  const need = [
    ...Object.values(m.tiles),
    ...m.edges.corners,
    ...m.edges.north,
    ...m.edges.south,
    ...m.puffs,
    ...m.shadows,
    ...Object.values(m.anims).flatMap((a) => a.frames),
  ];
  for (const name of need) {
    const r = m.sprites[name];
    if (!r || r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0) throw new Error(`cloud atlas: ${name}`);
    if (r.x + r.w > m.size[0] || r.y + r.h > m.size[1])
      throw new Error(`cloud atlas: ${name} out of bounds`);
  }
  return m;
}

let pending: Promise<CloudAtlas | null> | null = null;

/** Load once; resolves null when the files are missing or broken. */
export function loadCloudAtlas(): Promise<CloudAtlas | null> {
  if (pending) return pending;
  const base = (import.meta.env.BASE_URL || './') + CLOUD_ATLAS_DIR;
  pending = (async () => {
    try {
      const res = await fetch(`${base}cloud-atlas.json`);
      if (!res.ok) return null;
      const meta = parseCloudAtlas(await res.json());
      const image = new Image();
      image.src = `${base}cloud-atlas.png`;
      await image.decode();
      return {
        meta,
        image,
        rect: (name: string) => meta.sprites[name] ?? { x: 0, y: 0, w: 1, h: 1 },
      };
    } catch {
      return null;
    }
  })();
  return pending;
}
