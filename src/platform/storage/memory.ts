import type {
  LedgerEntry,
  PackedWorld,
  PersonDetail,
  SaveBackend,
  SaveManifest,
  SavePatch,
  SlotInfo,
} from '../../core/save/types';
import { assertSlot, clone, manifestFor } from './slot';

interface MemorySlot {
  manifest: SaveManifest;
  core: PackedWorld;
  details: Map<string, PersonDetail>;
  ledger: LedgerEntry[];
}

export interface InspectableSaveBackend extends SaveBackend {
  readLedger(slot: string): Promise<readonly LedgerEntry[]>;
}

export function createMemorySaveBackend(
  now: () => Date = () => new Date(),
): InspectableSaveBackend {
  const slots = new Map<string, MemorySlot>();

  return {
    async listSlots(): Promise<SlotInfo[]> {
      return [...slots.entries()].map(([slot, record]) => ({
        slot,
        manifest: clone(record.manifest),
      }));
    },

    async readManifest(slot: string): Promise<SaveManifest | null> {
      assertSlot(slot);
      const record = slots.get(slot);
      return record ? clone(record.manifest) : null;
    },

    async readCore(slot: string): Promise<PackedWorld | null> {
      assertSlot(slot);
      const record = slots.get(slot);
      return record ? clone(record.core) : null;
    },

    async readDetail(slot: string, personId: string): Promise<PersonDetail | null> {
      assertSlot(slot);
      const detail = slots.get(slot)?.details.get(personId);
      return detail ? clone(detail) : null;
    },

    async readLedger(slot: string): Promise<readonly LedgerEntry[]> {
      assertSlot(slot);
      return clone(slots.get(slot)?.ledger ?? []);
    },

    async write(slot: string, patch: SavePatch): Promise<void> {
      assertSlot(slot);
      const existing = slots.get(slot);
      if (!existing && !patch.core) throw new Error(`slot "${slot}" needs a core to be created`);
      const core = patch.core ? clone(patch.core) : existing?.core;
      if (!core) throw new Error(`slot "${slot}" is missing core`);
      const details = new Map(existing?.details ?? []);
      if (patch.details) {
        for (const [id, detail] of Object.entries(patch.details)) {
          if (!detail) continue;
          details.set(id, clone(detail));
        }
      }
      const ledger = [...(existing?.ledger ?? [])];
      if (patch.ledgerAppend) {
        for (const entry of patch.ledgerAppend) ledger.push(clone(entry));
      }
      slots.set(slot, {
        core,
        details,
        ledger,
        manifest: manifestFor(core, now().toISOString()),
      });
    },

    async deleteSlot(slot: string): Promise<void> {
      assertSlot(slot);
      slots.delete(slot);
    },
  };
}
