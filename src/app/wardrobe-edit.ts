/** Outfit edits for the paperdoll. Slot order and occupation come from Forge. */

export interface WardrobePiece {
  id: string;
  states: Record<string, string>;
}

export type WardrobeOutfit = Record<string, WardrobePiece | null>;

export interface OutfitChange {
  slot: string;
  from: WardrobePiece | null;
  to: WardrobePiece | null;
}

export interface StateChoice {
  slot: string;
  states: Record<string, string>;
}

export interface OccupationRow {
  when: Record<string, string>;
  slots: readonly string[];
}

export interface SlotRegions {
  upper: readonly string[];
  lower: readonly string[];
}

export type WardrobeFocus = 'full' | 'upper' | 'lower';

export interface WardrobeCatalog {
  slots: string[];
  slotRegions: SlotRegions | null;
  occupation: Record<string, OccupationRow[]>;
  catalogVersion: number | null;
}

/** The one occupation row whose `when` matches this state map. Empty `when` matches every state. */
export function matchOccupation(
  rows: readonly OccupationRow[],
  states: Record<string, string>,
): OccupationRow | null {
  const matches = rows.filter((row) =>
    Object.entries(row.when).every(([key, value]) => states[key] === value),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * State moves use the occupation row's first slot as the patch key.
 * `accept` is Forge `checkEdit`. Slots outside that row are not tried.
 */
export function chooseStatePatch(input: {
  states: Record<string, string>;
  slotOrder: readonly string[];
  occupation: readonly OccupationRow[] | null;
  accept(slot: string, states: Record<string, string>): boolean;
}): StateChoice | null {
  if (!input.occupation) return null;
  const row = matchOccupation(input.occupation, input.states);
  const destination = row?.slots[0];
  if (!destination || !input.slotOrder.includes(destination)) return null;
  if (!input.accept(destination, input.states)) return null;
  return { slot: destination, states: input.states };
}

/** All is the canonical slot list. Upper and lower are that list filtered by Forge regions. */
export function slotsInRegion(
  slotOrder: readonly string[],
  focus: WardrobeFocus,
  slotRegions: SlotRegions | null,
): string[] {
  if (focus === 'full') return [...slotOrder];
  if (!slotRegions) return [];
  const allowed = new Set(focus === 'upper' ? slotRegions.upper : slotRegions.lower);
  return slotOrder.filter((slot) => allowed.has(slot));
}

export function readWardrobeCatalog(value: unknown): WardrobeCatalog {
  const catalog = catalogRecord(value);
  const slots = strings(catalog?.slots);
  return {
    slots,
    slotRegions: readRegions(catalog?.slotRegions, slots),
    occupation: readOccupation(catalog?.garments),
    catalogVersion: typeof catalog?.v === 'number' ? catalog.v : null,
  };
}

export function diffOutfit(before: WardrobeOutfit, after: WardrobeOutfit): OutfitChange[] {
  const slots: string[] = [];
  for (const slot of Object.keys(before)) slots.push(slot);
  for (const slot of Object.keys(after)) if (!slots.includes(slot)) slots.push(slot);
  const changes: OutfitChange[] = [];
  for (const slot of slots) {
    const from = before[slot] ?? null;
    const to = after[slot] ?? null;
    if (same(from, to)) continue;
    changes.push({ slot, from, to });
  }
  return changes;
}

/** Pieces that left a slot, other than the garment that was just edited. */
export function removedPieces(changes: readonly OutfitChange[], keptId: string): OutfitChange[] {
  return changes.filter((change) => change.from && change.from.id !== keptId && !change.to);
}

function readRegions(value: unknown, slots: readonly string[]): SlotRegions | null {
  if (!isRecord(value)) return null;
  const upper = strings(value.upper);
  const lower = strings(value.lower);
  if (upper.length === 0 || lower.length === 0) return null;
  const known = new Set(slots);
  if (upper.some((slot) => !known.has(slot)) || lower.some((slot) => !known.has(slot))) return null;
  return { upper, lower };
}

function readOccupation(value: unknown): Record<string, OccupationRow[]> {
  if (!isRecord(value)) return {};
  const occupation: Record<string, OccupationRow[]> = {};
  for (const [id, garment] of Object.entries(value)) {
    if (!isRecord(garment) || !Array.isArray(garment.occupation)) continue;
    const rows: OccupationRow[] = [];
    for (const row of garment.occupation) {
      if (!isRecord(row)) continue;
      const when = stringRecord(row.when);
      const slots = strings(row.slots);
      if (!when || slots.length === 0) continue;
      rows.push({ when, slots });
    }
    if (rows.length > 0) occupation[id] = rows;
  }
  return occupation;
}

function catalogRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.catalog)) return value.catalog;
  return value;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const when: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return null;
    when[key] = item;
  }
  return when;
}

function same(left: WardrobePiece | null, right: WardrobePiece | null): boolean {
  if (!left || !right) return left === right;
  if (left.id !== right.id) return false;
  const keys = new Set([...Object.keys(left.states), ...Object.keys(right.states)]);
  for (const key of keys) if (left.states[key] !== right.states[key]) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
