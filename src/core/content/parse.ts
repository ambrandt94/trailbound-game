export interface ContentEntryRef {
  id: string;
  path: string;
}

export interface ContentIndex {
  id: string;
  version: number;
  entries: readonly ContentEntryRef[];
}

export interface PlaceContent {
  id: string;
  name: string;
  kind: string;
  map: { x: number; y: number };
  blurb: string;
}

/** Core I/O seam. Platform fetches; core only sees parsed JSON. */
export interface ContentSource {
  loadIndex(): Promise<ContentIndex>;
  load(id: string): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRelativePath(path: string): void {
  const parts = path.split('/');
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    parts.includes('..') ||
    parts.includes('.')
  ) {
    throw new Error(`invalid content path ${path}`);
  }
}

export function parseContentIndex(data: unknown): ContentIndex {
  if (!isRecord(data)) throw new Error('content index is not an object');
  if (typeof data.id !== 'string' || data.id.length === 0) throw new Error('content index id');
  if (typeof data.version !== 'number' || !Number.isFinite(data.version)) {
    throw new Error('content index version');
  }
  if (!Array.isArray(data.entries)) throw new Error('content index entries');
  const entries: ContentEntryRef[] = [];
  for (const entry of data.entries) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.path !== 'string') {
      throw new Error('content index entry');
    }
    assertRelativePath(entry.path);
    entries.push({ id: entry.id, path: entry.path });
  }
  return { id: data.id, version: data.version, entries };
}

export function parsePlace(data: unknown): PlaceContent {
  if (!isRecord(data)) throw new Error('place content is not an object');
  if (
    typeof data.id !== 'string' ||
    typeof data.name !== 'string' ||
    typeof data.kind !== 'string'
  ) {
    throw new Error('place content fields');
  }
  if (typeof data.blurb !== 'string') throw new Error('place content blurb');
  if (!isRecord(data.map) || typeof data.map.x !== 'number' || typeof data.map.y !== 'number') {
    throw new Error('place content map');
  }
  return {
    id: data.id,
    name: data.name,
    kind: data.kind,
    map: { x: data.map.x, y: data.map.y },
    blurb: data.blurb,
  };
}
