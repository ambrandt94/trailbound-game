import 'fake-indexeddb/auto';
import { test } from 'vitest';
import { createIdbSaveBackend } from '../../src/platform/storage/idb';
import { expectSaveRoundTrip } from './save-contract';

test('indexeddb save backend round-trips a slot', async () => {
  const save = createIdbSaveBackend(() => new Date('2026-11-05T12:00:00.000Z'));
  await expectSaveRoundTrip(save, 'slot-idb');
});
