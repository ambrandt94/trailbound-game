/** Which spawned slots open a playable demo. Worldgen ids stay as they are. */
export const PLAYABLE_SLOTS: Record<string, { id: string; label: string }> = {
  wild_fish: { id: 'fish', label: 'Fish' },
  wild_chop: { id: 'chop', label: 'Chop wood' },
};

export interface SlotPoint {
  gameId: string;
  x: number;
  y?: number;
  z?: number;
}

/** Town metres for a sign. Map y becomes three.js z, same as the prop placer. */
export function signPlacement(
  slot: SlotPoint,
  origin: { x: number; y: number },
  meters: number,
): { id: string; label: string; x: number; z: number } | null {
  const game = PLAYABLE_SLOTS[slot.gameId];
  if (!game || !Number.isFinite(slot.x)) return null;
  const north = slot.y != null ? slot.y : (slot.z ?? 0);
  const scale = meters > 0 ? meters : 1;
  return {
    id: game.id,
    label: game.label,
    x: (slot.x - origin.x) * scale,
    z: (north - origin.y) * scale,
  };
}
