/** AreaExport handed to the town renderer. The map port will build these live. */
export interface AreaExport {
  type: 'trailbound.area';
  version: string;
  area: { name?: string; innerOrigin: { x: number; y: number } };
  grid: { w: number; h: number };
  layers: {
    biome: unknown;
    ground: unknown;
    height: { raw: unknown };
  };
}

export interface AreaEntry {
  side?: string;
  pos?: number | { x: number; z: number };
  yaw?: number;
}

export type FixtureId = 'veldcross' | 'hollowmere' | 'jadewild';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept a controller AreaExport (v0.x) and hand the same object to the renderer.
 * Validation matches the checks in the ported area module.
 */
export function areaFromExport(value: unknown): AreaExport {
  if (!isRecord(value)) throw new Error('empty area export');
  if (value.type !== 'trailbound.area') throw new Error('not an AreaExport');
  const version = String(value.version ?? '');
  const major = /^(\d+)/.exec(version);
  if (!major || Number(major[1]) !== 0) throw new Error(`unsupported area version ${version}`);
  const grid = isRecord(value.grid) ? value.grid : null;
  const w = grid && typeof grid.w === 'number' ? grid.w : 0;
  const h = grid && typeof grid.h === 'number' ? grid.h : 0;
  if (!(w > 0) || !(h > 0)) throw new Error('grid size missing');
  const area = isRecord(value.area) ? value.area : null;
  if (!isRecord(area?.innerOrigin)) throw new Error('innerOrigin missing');
  const layers = isRecord(value.layers) ? value.layers : null;
  const height = layers && isRecord(layers.height) ? layers.height : null;
  if (!layers?.biome || !layers.ground || !height || !('raw' in height)) {
    throw new Error('layers missing');
  }
  return value as unknown as AreaExport;
}

/** `veldcross` is the default town. Hollowmere on disk is the v04 Shadowglen fixture. */
export function townFixtureId(hint: string): FixtureId {
  const query = hint.includes('=') ? hint.replace(/^\?/, '') : '';
  const name = (query ? (new URLSearchParams(query).get('town') ?? '') : hint).toLowerCase();
  if (name.startsWith('hollow')) return 'hollowmere';
  if (name.startsWith('jade')) return 'jadewild';
  return 'veldcross';
}

const FIXTURE_URL = {
  veldcross: new URL('../../../tests/fixtures/area-veldcross-v05.json', import.meta.url),
  hollowmere: new URL('../../../tests/fixtures/area-hollowmere-v04.json', import.meta.url),
  jadewild: new URL('../../../tests/fixtures/area-jadewild.json', import.meta.url),
} as const;

export async function loadTownFixture(id: FixtureId): Promise<AreaExport> {
  const response = await fetch(FIXTURE_URL[id]);
  if (!response.ok) throw new Error(`fixture ${id} failed (${response.status})`);
  return areaFromExport(await response.json());
}
