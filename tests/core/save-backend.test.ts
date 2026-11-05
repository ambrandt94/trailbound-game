import { expect, test } from 'vitest';
import { createMemorySaveBackend } from '../../src/platform/storage/memory';
import { expectSaveRoundTrip, sampleCore } from './save-contract';

test('memory save backend round-trips manifest, core, detail, and ledger', async () => {
  const save = createMemorySaveBackend(() => new Date('2026-11-05T12:00:00.000Z'));
  await expectSaveRoundTrip(save);
  await save.write('slot-1', { core: sampleCore() });
  expect((await save.readManifest('slot-1'))?.savedAt).toBe('2026-11-05T12:00:00.000Z');
});
