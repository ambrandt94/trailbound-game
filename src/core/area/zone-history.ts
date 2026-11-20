/**
 * The 3D zones the party has been in. Zones are instanced 192 m blocks
 * (`AREA_WINDOW_TILES`); the overworld map outlines the last few so the player
 * can see where they were and walk back to re-enter the right one.
 *
 * Pure data and maths: the world state owns the list, the save keeps it, and
 * the map renderer only draws what `zoneOutlineAlpha` says.
 */
import { clamp, wrapX } from '../world/models';

/** Zones remembered, newest first. */
export const ZONE_HISTORY_MAX = 3;
/**
 * A zoom-in re-enters a remembered zone only when the traveller stands at
 * least this many tiles inside its edge. Closer in, the wagon (or the hero)
 * would be leaving it at once, so a fresh cut down the road serves better.
 */
export const ZONE_REENTRY_MARGIN_TILES = 3;

/** A window in world tiles. `x1` and `y1` are exclusive. */
export interface ZoneRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ZoneRecord extends ZoneRect {
  name: string;
  /** Entry order, 1-based and rising. The newest zone has the highest. */
  seq: number;
  /** Game clock (`clockHours`) when the zone was last entered. */
  hours: number;
}

export function sameZone(a: ZoneRect, b: ZoneRect): boolean {
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

/**
 * Remember an entered zone: newest first, no duplicates (re-entering a zone
 * moves it to the front), at most `ZONE_HISTORY_MAX`. Returns a new list.
 */
export function rememberZone(
  history: readonly ZoneRecord[],
  zone: ZoneRect & { name: string },
  hours: number,
): ZoneRecord[] {
  const seq = history.reduce((top, z) => Math.max(top, z.seq), 0) + 1;
  const entered: ZoneRecord = {
    x0: zone.x0,
    y0: zone.y0,
    x1: zone.x1,
    y1: zone.y1,
    name: zone.name,
    seq,
    hours,
  };
  const rest = history.filter((z) => !sameZone(z, zone));
  return [entered, ...rest].slice(0, ZONE_HISTORY_MAX);
}

/** Tiles from a point to the nearest edge of the zone. Negative outside. */
export function zoneMargin(rect: ZoneRect, x: number, y: number, worldWidth?: number): number {
  const px = worldWidth ? wrapX(x, worldWidth) : x;
  return Math.min(px - rect.x0, rect.x1 - px, y - rect.y0, rect.y1 - y);
}

/**
 * The remembered zone to re-enter at a point: the one the point sits deepest
 * inside (ties go to the newest), as long as it is `margin` tiles in.
 */
export function zoneContaining(
  history: readonly ZoneRecord[],
  x: number,
  y: number,
  margin = ZONE_REENTRY_MARGIN_TILES,
  worldWidth?: number,
): ZoneRecord | null {
  let best: ZoneRecord | null = null;
  let bestMargin = -Infinity;
  for (const zone of history) {
    const m = zoneMargin(zone, x, y, worldWidth);
    if (m < margin) continue;
    if (m > bestMargin || (m === bestMargin && best && zone.seq > best.seq)) {
      best = zone;
      bestMargin = m;
    }
  }
  return best;
}

/** Tiles from a point to the zone's rectangle; 0 inside it. Wraps around the world seam. */
export function zoneDistance(rect: ZoneRect, x: number, y: number, worldWidth?: number): number {
  let dx = Math.max(rect.x0 - x, 0, x - rect.x1);
  if (worldWidth) {
    for (const shift of [-worldWidth, worldWidth]) {
      dx = Math.min(dx, Math.max(rect.x0 - (x + shift), 0, x + shift - rect.x1));
    }
  }
  const dy = Math.max(rect.y0 - y, 0, y - rect.y1);
  return Math.hypot(dx, dy);
}

/** Outline strength by age: the zone just left is clear but subtle, older ones fainter. */
export const ZONE_RANK_ALPHA: readonly number[] = [0.9, 0.62, 0.4];
/** Inside this many tiles of the player an outline is at full strength. */
export const ZONE_FADE_NEAR_TILES = 30;
/** Beyond this it has faded to `ZONE_FADE_FLOOR` of its strength. */
export const ZONE_FADE_FAR_TILES = 260;
export const ZONE_FADE_FLOOR = 0.4;

/**
 * Outline opacity for the zone at `rank` (0 = most recent) when the player is
 * `distTiles` away from it: age sets the base, distance fades it down to a floor.
 */
export function zoneOutlineAlpha(rank: number, distTiles: number): number {
  const base =
    ZONE_RANK_ALPHA[Math.min(Math.max(0, Math.floor(rank)), ZONE_RANK_ALPHA.length - 1)]!;
  const t = clamp(
    (distTiles - ZONE_FADE_NEAR_TILES) / (ZONE_FADE_FAR_TILES - ZONE_FADE_NEAR_TILES),
    0,
    1,
  );
  const eased = t * t * (3 - 2 * t);
  return base * (1 - eased * (1 - ZONE_FADE_FLOOR));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Read a saved history. Older saves have none. Junk entries, rectangles that
 * leave the world, and repeats are dropped; the list comes back newest first.
 */
export function normalizeZones(
  value: unknown,
  bounds?: { width: number; height: number },
): ZoneRecord[] {
  if (!Array.isArray(value)) return [];
  const zones: ZoneRecord[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const z = raw as Partial<ZoneRecord>;
    if (!finite(z.x0) || !finite(z.y0) || !finite(z.x1) || !finite(z.y1)) continue;
    if (!(z.x1 > z.x0) || !(z.y1 > z.y0)) continue;
    if (bounds && (z.x0 < 0 || z.y0 < 0 || z.x1 > bounds.width || z.y1 > bounds.height)) continue;
    zones.push({
      x0: z.x0,
      y0: z.y0,
      x1: z.x1,
      y1: z.y1,
      name: typeof z.name === 'string' ? z.name : 'Wilderness',
      seq: finite(z.seq) ? Math.max(1, Math.floor(z.seq)) : 1,
      hours: finite(z.hours) ? z.hours : 0,
    });
  }
  zones.sort((a, b) => b.seq - a.seq);
  const kept: ZoneRecord[] = [];
  for (const zone of zones) {
    if (!kept.some((k) => sameZone(k, zone))) kept.push(zone);
  }
  return kept.slice(0, ZONE_HISTORY_MAX);
}

export function zonesSave(history: readonly ZoneRecord[]): ZoneRecord[] {
  return history.map((z) => ({ ...z }));
}
