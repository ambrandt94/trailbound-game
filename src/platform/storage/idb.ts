import type {
  LedgerEntry,
  PackedWorld,
  PersonDetail,
  SaveManifest,
  SavePatch,
  SlotInfo,
} from '../../core/save/types';
import type { InspectableSaveBackend } from './memory';
import { assertSlot, manifestFor } from './slot';

const INDEX_DB = 'tb-save-index';
const SLOT_PREFIX = 'tb-save-';

interface IndexRecord {
  slot: string;
  manifest: SaveManifest;
}

function slotDbName(slot: string): string {
  assertSlot(slot);
  return `${SLOT_PREFIX}${slot}`;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function openDatabase(name: string, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`failed to open ${name}`));
  });
}

function openSlot(slot: string): Promise<IDBDatabase> {
  return openDatabase(slotDbName(slot), (db) => {
    if (!db.objectStoreNames.contains('manifest')) db.createObjectStore('manifest');
    if (!db.objectStoreNames.contains('core')) db.createObjectStore('core');
    if (!db.objectStoreNames.contains('details')) db.createObjectStore('details');
    if (!db.objectStoreNames.contains('ledger'))
      db.createObjectStore('ledger', { autoIncrement: true });
  });
}

function openIndex(): Promise<IDBDatabase> {
  return openDatabase(INDEX_DB, (db) => {
    if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots', { keyPath: 'slot' });
  });
}

async function withDatabase<T>(db: IDBDatabase, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    db.close();
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`failed to delete ${name}`));
    request.onblocked = () => resolve();
  });
}

async function indexHas(slot: string): Promise<boolean> {
  const db = await openIndex();
  return withDatabase(db, async () => {
    const tx = db.transaction('slots', 'readonly');
    const done = transactionDone(tx);
    const record = await requestToPromise(
      tx.objectStore('slots').get(slot) as IDBRequest<IndexRecord | undefined>,
    );
    await done;
    return record !== undefined;
  });
}

async function writeIndex(record: IndexRecord): Promise<void> {
  const db = await openIndex();
  await withDatabase(db, async () => {
    const tx = db.transaction('slots', 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore('slots').put(record);
    await done;
  });
}

async function deleteIndex(slot: string): Promise<void> {
  const db = await openIndex();
  await withDatabase(db, async () => {
    const tx = db.transaction('slots', 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore('slots').delete(slot);
    await done;
  });
}

/**
 * One database per slot, named `tb-save-<slot>`, plus a small index database
 * so slots can be listed without `indexedDB.databases()`.
 */
export function createIdbSaveBackend(now: () => Date = () => new Date()): InspectableSaveBackend {
  return {
    async listSlots(): Promise<SlotInfo[]> {
      const db = await openIndex();
      return withDatabase(db, async () => {
        const tx = db.transaction('slots', 'readonly');
        const done = transactionDone(tx);
        const rows = await requestToPromise(
          tx.objectStore('slots').getAll() as IDBRequest<IndexRecord[]>,
        );
        await done;
        return rows.map((row) => ({ slot: row.slot, manifest: row.manifest }));
      });
    },

    async readManifest(slot: string): Promise<SaveManifest | null> {
      assertSlot(slot);
      if (!(await indexHas(slot))) return null;
      const db = await openSlot(slot);
      return withDatabase(db, async () => {
        const tx = db.transaction('manifest', 'readonly');
        const done = transactionDone(tx);
        const manifest = await requestToPromise(
          tx.objectStore('manifest').get('manifest') as IDBRequest<SaveManifest | undefined>,
        );
        await done;
        return manifest ?? null;
      });
    },

    async readCore(slot: string): Promise<PackedWorld | null> {
      assertSlot(slot);
      if (!(await indexHas(slot))) return null;
      const db = await openSlot(slot);
      return withDatabase(db, async () => {
        const tx = db.transaction('core', 'readonly');
        const done = transactionDone(tx);
        const core = await requestToPromise(
          tx.objectStore('core').get('core') as IDBRequest<PackedWorld | undefined>,
        );
        await done;
        return core ?? null;
      });
    },

    async readDetail(slot: string, personId: string): Promise<PersonDetail | null> {
      assertSlot(slot);
      if (!(await indexHas(slot))) return null;
      const db = await openSlot(slot);
      return withDatabase(db, async () => {
        const tx = db.transaction('details', 'readonly');
        const done = transactionDone(tx);
        const detail = await requestToPromise(
          tx.objectStore('details').get(personId) as IDBRequest<PersonDetail | undefined>,
        );
        await done;
        return detail ?? null;
      });
    },

    async readLedger(slot: string): Promise<readonly LedgerEntry[]> {
      assertSlot(slot);
      if (!(await indexHas(slot))) return [];
      const db = await openSlot(slot);
      return withDatabase(db, async () => {
        const tx = db.transaction('ledger', 'readonly');
        const done = transactionDone(tx);
        const rows = await requestToPromise(
          tx.objectStore('ledger').getAll() as IDBRequest<LedgerEntry[]>,
        );
        await done;
        return rows;
      });
    },

    async write(slot: string, patch: SavePatch): Promise<void> {
      assertSlot(slot);
      const existing = await this.readCore(slot);
      if (!existing && !patch.core) throw new Error(`slot "${slot}" needs a core to be created`);
      const core = patch.core ?? existing;
      if (!core) throw new Error(`slot "${slot}" is missing core`);
      const manifest = manifestFor(core, now().toISOString());
      const db = await openSlot(slot);
      await withDatabase(db, async () => {
        const tx = db.transaction(['manifest', 'core', 'details', 'ledger'], 'readwrite');
        const done = transactionDone(tx);
        tx.objectStore('manifest').put(manifest, 'manifest');
        tx.objectStore('core').put(core, 'core');
        if (patch.details) {
          const details = tx.objectStore('details');
          for (const [id, detail] of Object.entries(patch.details)) {
            if (detail) details.put(detail, id);
          }
        }
        if (patch.ledgerAppend) {
          const ledger = tx.objectStore('ledger');
          for (const entry of patch.ledgerAppend) ledger.add(entry);
        }
        await done;
      });
      await writeIndex({ slot, manifest });
    },

    async deleteSlot(slot: string): Promise<void> {
      assertSlot(slot);
      await deleteDatabase(slotDbName(slot));
      await deleteIndex(slot);
    },
  };
}
