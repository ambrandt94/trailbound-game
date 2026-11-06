import { expect } from 'vitest';
import { defaultPlayerAvatar } from '../../src/core/people/avatar';
import type { LedgerEntry, PackedWorld } from '../../src/core/save/types';
import type { InspectableSaveBackend } from '../../src/platform/storage/memory';

export function sampleCore(clockHours = 9.5): PackedWorld {
  return {
    clockHours,
    worldSeed: 7741,
    player: {
      name: 'Traveller',
      mapX: 3,
      mapY: 4,
      yaw: 0.2,
      avatar: {
        ...defaultPlayerAvatar('Traveller'),
        seed: 77,
        recipeHash: '0123456789abcdef',
        race: 'human',
        gender: 'm',
      },
    },
    gameVersion: '0.0.0',
    cfPin: { version: '1.2.0', generatorVersion: '1' },
  };
}

export async function expectSaveRoundTrip(
  save: InspectableSaveBackend,
  slot = 'slot-1',
): Promise<void> {
  expect(await save.listSlots()).toEqual([]);
  expect(await save.readManifest(slot)).toBeNull();
  expect(await save.readCore(slot)).toBeNull();
  expect(await save.readDetail(slot, 'p1')).toBeNull();

  await expect(save.write('bad/slot', { core: sampleCore() })).rejects.toThrow(/invalid save slot/);
  await expect(save.write(slot, { ledgerAppend: [{ id: 'nope' }] })).rejects.toThrow(
    /needs a core/,
  );

  await save.write(slot, {
    core: sampleCore(),
    details: { p1: { personId: 'p1' } },
    ledgerAppend: [{ id: 'e1', amount: 5, note: 'pay' }],
  });

  const manifest = await save.readManifest(slot);
  expect(manifest?.schema).toBe(4);
  expect(manifest?.worldSeed).toBe(7741);
  expect(manifest?.clockHours).toBe(9.5);
  expect(manifest?.player).toMatchObject({ name: 'Traveller', mapX: 3, mapY: 4, yaw: 0.2 });
  expect(manifest?.player.avatar).toMatchObject({
    seed: 77,
    race: 'human',
    recipeHash: '0123456789abcdef',
  });
  expect(manifest?.cfPin).toEqual({ version: '1.2.0', generatorVersion: '1' });
  expect(manifest?.gameVersion).toBe('0.0.0');
  expect(manifest?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

  await save.write(slot, {
    core: {
      ...sampleCore(11),
      player: {
        name: 'Traveller',
        mapX: 8,
        mapY: 6.1,
        yaw: 1,
        avatar: {
          ...defaultPlayerAvatar('Traveller'),
          seed: 88,
          recipeHash: 'fedcba9876543210',
          race: 'kobold',
          gender: 'f',
        },
      },
    },
    details: { p2: { personId: 'p2' } },
    ledgerAppend: [{ id: 'e2', amount: 1 }],
  });

  const core = await save.readCore(slot);
  expect(core?.clockHours).toBe(11);
  expect(core?.player.mapY).toBe(6.1);
  expect(core?.player.avatar).toMatchObject({ seed: 88, race: 'kobold', gender: 'f' });
  expect(await save.readDetail(slot, 'p1')).toEqual({ personId: 'p1' });
  expect(await save.readDetail(slot, 'p2')).toEqual({ personId: 'p2' });
  expect(await save.readDetail(slot, 'missing')).toBeNull();

  const ledger: readonly LedgerEntry[] = await save.readLedger(slot);
  expect(ledger).toEqual([
    { id: 'e1', amount: 5, note: 'pay' },
    { id: 'e2', amount: 1 },
  ]);

  const slots = await save.listSlots();
  expect(slots.map((item) => item.slot)).toEqual([slot]);
  expect(slots[0]?.manifest.schema).toBe(4);
  expect(slots[0]?.manifest.clockHours).toBe(11);

  const again = await save.readCore(slot);
  if (!again) throw new Error('expected core');
  again.clockHours = 0;
  expect((await save.readCore(slot))?.clockHours).toBe(11);

  await save.deleteSlot(slot);
  expect(await save.readManifest(slot)).toBeNull();
  expect(await save.readCore(slot)).toBeNull();
  expect(await save.listSlots()).toEqual([]);
  await save.deleteSlot(slot);

  await save.write(slot, { core: sampleCore(8) });
  expect((await save.readCore(slot))?.clockHours).toBe(8);
  await save.deleteSlot(slot);
}
