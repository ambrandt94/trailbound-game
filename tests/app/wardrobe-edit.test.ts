import { expect, test } from 'vitest';
import { chooseStatePatch, diffOutfit, type WardrobeOutfit } from '../../src/app/wardrobe-edit';

const outfit = (entries: Record<string, string | null>): WardrobeOutfit => {
  const next: WardrobeOutfit = {};
  for (const [slot, id] of Object.entries(entries)) {
    next[slot] = id ? { id, states: {} } : null;
  }
  return next;
};

test('a state patch tries the current home, then other slots that offer the garment', () => {
  const tried: string[] = [];
  const choice = chooseStatePatch({
    garmentId: 'bandana',
    states: { wear: 'neck' },
    slotOrder: ['head_inner', 'face_lower', 'neck_wrap'],
    offered: {
      head_inner: ['bandana'],
      face_lower: ['bandana'],
      neck_wrap: ['bandana', 'hood'],
    },
    occupied: ['head_inner'],
    accept(slot) {
      tried.push(slot);
      return slot === 'neck_wrap';
    },
  });
  expect(tried).toEqual(['head_inner', 'face_lower', 'neck_wrap']);
  expect(choice).toEqual({ slot: 'neck_wrap', states: { wear: 'neck' } });
});

test('no accepted slot means the state change is refused', () => {
  expect(
    chooseStatePatch({
      garmentId: 'hood',
      states: { wear: 'down' },
      slotOrder: ['head_outer'],
      offered: { head_outer: ['hood'] },
      occupied: ['head_outer'],
      accept: () => false,
    }),
  ).toBeNull();
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
