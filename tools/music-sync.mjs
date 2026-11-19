/**
 * Copy a Trailbound music bundle (derived from the Asset Matrix music dataset)
 * into public/assets/audio/music/ and write the game manifest next to the OGGs.
 * The game never fetches the Matrix at runtime: it is behind a Cloudflare Access
 * login. Re-run this after a new Matrix export, then commit the result.
 *
 * Usage:
 *   node tools/music-sync.mjs <BUNDLE_DIR>
 *   MUSIC_BUNDLE=/path/to/trailbound-music-bundle node tools/music-sync.mjs
 *
 * BUNDLE_DIR holds music.json and audio/<id>.ogg.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const MUSIC_ROOT = join(root, 'public', 'assets', 'audio', 'music');
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const MANIFEST_VERSION = 1;
const ID = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Validate music.json and return game manifest tracks, sorted by id.
 * Throws one Error listing every problem.
 * @param {unknown} catalog
 * @param {{ bundleDir?: string, maxBytes?: number }} [options]
 */
export function buildManifest(catalog, options = {}) {
  const errors = [];
  if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
    throw new Error('music.json must be an object keyed by track id');
  }
  const meta = /** @type {Record<string, unknown>} */ (catalog)._meta;
  const vocab = Array.isArray(meta?.contextVocabulary)
    ? meta.contextVocabulary.filter((tag) => typeof tag === 'string')
    : null;
  if (!vocab || vocab.length === 0) errors.push('_meta.contextVocabulary is missing');
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const tracks = [];
  for (const [key, raw] of Object.entries(catalog)) {
    if (key === '_meta') continue;
    const where = `track "${key}"`;
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${where} is not an object`);
      continue;
    }
    const rec = /** @type {Record<string, unknown>} */ (raw);
    if (typeof rec.id !== 'string' || !ID.test(rec.id)) errors.push(`${where}: bad id`);
    else if (rec.id !== key) errors.push(`${where}: id "${rec.id}" does not match its key`);
    if (typeof rec.name !== 'string' || rec.name === '') errors.push(`${where}: name missing`);
    if (rec.format !== 'ogg') errors.push(`${where}: format must be "ogg"`);
    if (rec.file !== `audio/${key}.ogg`) errors.push(`${where}: file must be audio/${key}.ogg`);
    if (typeof rec.loop !== 'boolean') errors.push(`${where}: loop must be a boolean`);
    if (!Array.isArray(rec.context) || rec.context.length === 0) {
      errors.push(`${where}: context needs at least one tag`);
    } else {
      for (const tag of rec.context) {
        if (typeof tag !== 'string') errors.push(`${where}: context tag is not a string`);
        else if (vocab && !vocab.includes(tag))
          errors.push(`${where}: unknown context tag "${tag}"`);
      }
      if (new Set(rec.context).size !== rec.context.length) {
        errors.push(`${where}: duplicate context tag`);
      }
    }
    if (typeof rec.intensity !== 'number' || !(rec.intensity >= 0 && rec.intensity <= 1)) {
      errors.push(`${where}: intensity must be 0..1`);
    }
    if (typeof rec.durationSec !== 'number' || !(rec.durationSec > 0)) {
      errors.push(`${where}: durationSec must be > 0`);
    }
    if (options.bundleDir) {
      const audio = join(options.bundleDir, 'audio', `${key}.ogg`);
      if (!existsSync(audio)) errors.push(`${where}: ${audio} is missing`);
      else {
        const size = statSync(audio).size;
        if (size > maxBytes)
          errors.push(`${where}: ${size} bytes is over the ${maxBytes} byte cap`);
        if (!isOgg(audio)) errors.push(`${where}: ${audio} is not an Ogg file`);
      }
    }
    tracks.push({
      id: String(rec.id ?? key),
      name: String(rec.name ?? key),
      file: `${key}.ogg`,
      loop: rec.loop === true,
      context: Array.isArray(rec.context) ? rec.context.map(String) : [],
      intensity: typeof rec.intensity === 'number' ? Math.round(rec.intensity * 100) / 100 : 0,
      durationSec: typeof rec.durationSec === 'number' ? rec.durationSec : 0,
      kind: typeof rec.kind === 'string' ? rec.kind : 'ambient',
      ...(typeof rec.mood === 'string' && rec.mood ? { mood: rec.mood } : {}),
      ...(typeof rec.notes === 'string' && rec.notes ? { notes: rec.notes } : {}),
    });
  }
  if (tracks.length === 0) errors.push('music.json has no tracks');
  if (errors.length > 0) throw new Error(`Invalid music bundle:\n- ${errors.join('\n- ')}`);
  tracks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    version: MANIFEST_VERSION,
    source:
      typeof meta?.source === 'string' ? meta.source : 'Trailbound Asset Matrix music dataset',
    bundleGeneratedAt: typeof meta?.generatedAt === 'string' ? meta.generatedAt : null,
    vocabulary: vocab ?? [],
    tracks,
  };
}

/** @param {string} file */
function isOgg(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    readSync(fd, head, 0, 4, 0);
    return head.toString('latin1') === 'OggS';
  } finally {
    closeSync(fd);
  }
}

/**
 * @param {string} bundleDir
 * @param {{ destRoot?: string, maxBytes?: number }} [options]
 * @returns {{ tracks: number, bytes: number, dest: string }}
 */
export function syncMusic(bundleDir, options = {}) {
  const source = resolve(bundleDir);
  const dest = options.destRoot ?? MUSIC_ROOT;
  const catalog = JSON.parse(readFileSync(join(source, 'music.json'), 'utf8'));
  const manifest = buildManifest(catalog, { bundleDir: source, maxBytes: options.maxBytes });
  mkdirSync(dest, { recursive: true });
  const keep = new Set(manifest.tracks.map((track) => track.file));
  // Drop OGGs the new export no longer has, so the folder mirrors the manifest.
  for (const entry of readdirSync(dest)) {
    if (entry.endsWith('.ogg') && !keep.has(entry)) rmSync(join(dest, entry));
  }
  let bytes = 0;
  for (const track of manifest.tracks) {
    copyFileSync(join(source, 'audio', track.file), join(dest, track.file));
    bytes += statSync(join(dest, track.file)).size;
  }
  writeFileSync(join(dest, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { tracks: manifest.tracks.length, bytes, dest };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? process.env.MUSIC_BUNDLE;
  if (!dir) {
    console.error('Usage: node tools/music-sync.mjs <BUNDLE_DIR>');
    process.exit(2);
  }
  try {
    const result = syncMusic(dir);
    console.log(
      `Synced ${result.tracks} tracks, ${(result.bytes / 1048576).toFixed(1)} MiB, to ${result.dest}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
