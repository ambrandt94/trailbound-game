import { expect, test } from 'vitest';
import {
  chooseStatePatch,
  diffOutfit,
  matchOccupation,
  readWardrobeCatalog,
  slotsInRegion,
  type OccupationRow,
  type WardrobeOutfit,
} from '../../src/app/wardrobe-edit';

const outfit = (entries: Record<string, string | null>): WardrobeOutfit => {
  const next: WardrobeOutfit = {};
  for (const [slot, id] of Object.entries(entries)) {
    next[slot] = id ? { id, states: {} } : null;
  }
  return next;
};

const bandana: OccupationRow[] = [
  { when: { wear: 'head' }, slots: ['head_inner'] },
  { when: { wear: 'mask' }, slots: ['face_lower'] },
  { when: { wear: 'neck' }, slots: ['neck_wrap'] },
];

test('a state patch uses the matching occupation row and still asks checkEdit', () => {
  const tried: string[] = [];
  const choice = chooseStatePatch({
    states: { wear: 'neck' },
    slotOrder: ['head_inner', 'face_lower', 'neck_wrap'],
    occupation: bandana,
    accept(slot) {
      tried.push(slot);
      return slot === 'neck_wrap';
    },
  });
  expect(tried).toEqual(['neck_wrap']);
  expect(choice).toEqual({ slot: 'neck_wrap', states: { wear: 'neck' } });
});

test('a refused occupation destination is not replaced by another slot', () => {
  expect(
    chooseStatePatch({
      states: { wear: 'down' },
      slotOrder: ['head_outer', 'neck_wrap'],
      occupation: [{ when: { wear: 'down' }, slots: ['neck_wrap'] }],
      accept: () => false,
    }),
  ).toBeNull();
});

test('missing occupation is not guessed', () => {
  expect(
    chooseStatePatch({
      states: { wear: 'neck' },
      slotOrder: ['head_inner', 'neck_wrap'],
      occupation: null,
      accept: () => true,
    }),
  ).toBeNull();
});

test('upper and lower are the canonical list filtered by the published regions', () => {
  const slots = ['head_outer', 'chest', 'hands', 'legs', 'feet'];
  const regions = { upper: ['head_outer', 'chest', 'hands'], lower: ['legs', 'feet'] };
  expect(slotsInRegion(slots, 'full', regions)).toEqual(slots);
  expect(slotsInRegion(slots, 'upper', regions)).toEqual(regions.upper);
  expect(slotsInRegion(slots, 'lower', regions)).toEqual(regions.lower);
  expect(slotsInRegion(slots, 'upper', null)).toEqual([]);
});

test('the catalog reader keeps occupation and regions and ignores a missing field', () => {
  const parsed = readWardrobeCatalog({
    v: 1,
    slots: ['head_outer', 'legs'],
    slotRegions: { upper: ['head_outer'], lower: ['legs'] },
    garments: {
      hood: { occupation: [{ when: { wear: 'up' }, slots: ['head_outer'] }] },
      plain: { slots: ['legs'] },
    },
  });
  expect(parsed.catalogVersion).toBe(1);
  expect(parsed.slotRegions).toEqual({ upper: ['head_outer'], lower: ['legs'] });
  expect(
    matchOccupation(parsed.occupation.hood ?? [], { wear: 'up', depth: 'deep' })?.slots,
  ).toEqual(['head_outer']);
  expect(parsed.occupation.plain).toBeUndefined();
  expect(readWardrobeCatalog({ slots: ['legs'] }).slotRegions).toBeNull();
});

test('outfit diff lists emptied and filled slots and ignores an unchanged piece', () => {
  const changes = diffOutfit(
    outfit({ chest: 'breastplate', torso_mid: 'vest', torso_inner: 'shirt' }),
    outfit({ chest: 'tunic', torso_mid: 'tunic', torso_inner: 'shirt' }),
  );
  expect(
    changes.map((change) => [change.slot, change.from?.id ?? null, change.to?.id ?? null]),
  ).toEqual([
    ['chest', 'breastplate', 'tunic'],
    ['torso_mid', 'vest', 'tunic'],
  ]);
});
