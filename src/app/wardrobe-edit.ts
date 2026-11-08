/** Outfit edits for the paperdoll. Slot order and legality stay with Forge. */

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

export function chooseStatePatch(input: {
  garmentId: string;
  states: Record<string, string>;
  slotOrder: readonly string[];
  offered: Readonly<Record<string, readonly string[]>>;
  occupied: readonly string[];
  accept(slot: string, states: Record<string, string>): boolean;
}): StateChoice | null {
  const seen = new Set<string>();
  const candidates = [...input.occupied, ...input.slotOrder].filter((slot) => {
    if (seen.has(slot)) return false;
    seen.add(slot);
    return input.offered[slot]?.includes(input.garmentId) ?? false;
  });
  for (const slot of candidates) {
    if (input.accept(slot, input.states)) return { slot, states: input.states };
  }
  return null;
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

function same(left: WardrobePiece | null, right: WardrobePiece | null): boolean {
  if (!left || !right) return left === right;
  if (left.id !== right.id) return false;
  const keys = new Set([...Object.keys(left.states), ...Object.keys(right.states)]);
  for (const key of keys) if (left.states[key] !== right.states[key]) return false;
  return true;
}
