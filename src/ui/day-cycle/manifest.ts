/** The sprite manifest for the day-cycle HUD. Pure parsing, no DOM. */

export interface SpriteDef {
  /** PNG file, relative to the manifest. */
  file: string;
  /** One frame's size. The PNG is `w * states.length` wide. */
  w: number;
  h: number;
  /** The pixel inside one frame that sits on the point the sprite marks. */
  anchor: [number, number];
  states: string[];
  /** 9-slice insets: left, top, right, bottom. */
  slice?: [number, number, number, number];
  /** Gray pixels take the phase colour. See the folder README. */
  tint?: boolean;
  tile?: boolean;
  /** Which art template sheet the slot is drawn on: the main sheet (default) or `biomes`. */
  sheet?: string;
  fps?: number;
  note?: string;
}

export interface FontDef {
  file: string;
  cellW: number;
  cellH: number;
  spacing: number;
  glyphs: string;
  widths: Record<string, number>;
}

export interface HudManifest {
  version: number;
  sprites: Record<string, SpriteDef>;
  font: FontDef;
}

/** Slots the renderer draws. A manifest without one of these is rejected. */
export const REQUIRED_SPRITES = [
  'node_socket_empty',
  'node_gem_lit',
  'node_leading_pulse',
  'spine_link',
  'fog_shroud',
  'anchor_left_moon',
  'anchor_right_dawn',
  'medallion_sunset',
  'medallion_sunrise',
  'sub_node',
  'sky_sun',
  'sky_moon',
  'sky_frame',
  'terrain_mask',
  'cursor_pill_day',
  'cursor_pill_night',
  'cursor_stem_day',
  'cursor_stem_night',
] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function posInt(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
    throw new Error(`day-cycle manifest: ${what} must be a positive whole number`);
  }
  return v;
}

function tuple(v: unknown, n: number, what: string): number[] {
  if (!Array.isArray(v) || v.length !== n || v.some((x) => typeof x !== 'number' || x < 0)) {
    throw new Error(`day-cycle manifest: ${what} must be ${n} numbers`);
  }
  return v as number[];
}

export function parseManifest(raw: unknown): HudManifest {
  if (!isRecord(raw) || !isRecord(raw.sprites) || !isRecord(raw.font)) {
    throw new Error('day-cycle manifest: needs sprites and font');
  }
  const sprites: Record<string, SpriteDef> = {};
  for (const [id, entry] of Object.entries(raw.sprites)) {
    if (!isRecord(entry)) throw new Error(`day-cycle manifest: ${id} is not an object`);
    if (typeof entry.file !== 'string' || !entry.file) {
      throw new Error(`day-cycle manifest: ${id} needs a file`);
    }
    const states =
      Array.isArray(entry.states) && entry.states.length > 0
        ? entry.states.map(String)
        : ['default'];
    const def: SpriteDef = {
      file: entry.file,
      w: posInt(entry.w, `${id}.w`),
      h: posInt(entry.h, `${id}.h`),
      anchor: tuple(entry.anchor ?? [0, 0], 2, `${id}.anchor`) as [number, number],
      states,
    };
    if (entry.slice !== undefined) {
      def.slice = tuple(entry.slice, 4, `${id}.slice`) as [number, number, number, number];
    }
    if (entry.tint === true) def.tint = true;
    if (entry.tile === true) def.tile = true;
    if (typeof entry.sheet === 'string' && entry.sheet) def.sheet = entry.sheet;
    if (typeof entry.fps === 'number' && entry.fps > 0) def.fps = entry.fps;
    if (typeof entry.note === 'string') def.note = entry.note;
    sprites[id] = def;
  }
  for (const id of REQUIRED_SPRITES) {
    if (!sprites[id]) throw new Error(`day-cycle manifest: missing sprite ${id}`);
  }
  const f = raw.font;
  if (typeof f.file !== 'string' || typeof f.glyphs !== 'string' || !f.glyphs) {
    throw new Error('day-cycle manifest: font needs file and glyphs');
  }
  const widths: Record<string, number> = {};
  if (isRecord(f.widths)) {
    for (const [ch, n] of Object.entries(f.widths)) {
      if (typeof n === 'number' && n >= 0) widths[ch] = n;
    }
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    sprites,
    font: {
      file: f.file,
      cellW: posInt(f.cellW, 'font.cellW'),
      cellH: posInt(f.cellH, 'font.cellH'),
      spacing: typeof f.spacing === 'number' && f.spacing >= 0 ? f.spacing : 1,
      glyphs: f.glyphs,
      widths,
    },
  };
}
