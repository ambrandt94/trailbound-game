import { parsePlace } from '../core/content/parse';
import { createWorld } from '../core/state/world-state';
import { canContinue } from '../ui/state';
import type { GameHost } from './host';

/**
 * Title boot: content index, the starting place, and the save-slot list.
 * The dojo does not call this. Leaving the dojo for the title does, once,
 * and only reads slots.
 */
export async function loadRoad(host: GameHost): Promise<void> {
  const index = await host.content.loadIndex();
  if (!index.entries.some((entry) => entry.id === 'places/waystead')) {
    throw new Error('content index is missing places/waystead');
  }
  const place = parsePlace(await host.content.load('places/waystead'));
  host.place = place;
  host.world = createWorld({
    id: place.id,
    name: place.name,
    x: place.map.x,
    y: place.map.y,
  });
  const slots = await host.saves.listSlots();
  canContinue.value = slots.some((slot) => slot.manifest.schema > 0);
}
