import { expect, test } from 'vitest';
import {
  PARTY_WAGON_ASSET,
  WAGON_SPAWN_GAP_M,
  chooseWagonSpot,
  groundBlocksWagon,
  partyWagonUrl,
  wagonCandidates,
  wagonHitsBlock,
  wagonNearPoint,
  wagonSpotClear,
} from '../../src/core/world/wagon';

test('the wagon asset is one path so the placeholder GLB can be swapped', () => {
  expect(PARTY_WAGON_ASSET).toBe('assets/props/party_wagon.glb');
  expect(partyWagonUrl('./')).toBe('./assets/props/party_wagon.glb');
  expect(partyWagonUrl('/play')).toBe('/play/assets/props/party_wagon.glb');
});

test('candidates sit beside the spawn and the first clear one wins', () => {
  const spots = wagonCandidates(10, 20, 0);
  expect(spots.length).toBeGreaterThan(3);
  for (const spot of spots) {
    expect(Math.hypot(spot.x - 10, spot.z - 20)).toBeGreaterThanOrEqual(WAGON_SPAWN_GAP_M - 1e-6);
  }
  expect(spots[0]!.x).toBeGreaterThan(10);
  const picked = chooseWagonSpot(spots, (spot) => spot.x < 10);
  expect(picked?.x).toBeLessThan(10);
  expect(chooseWagonSpot(spots, () => false)).toBeNull();
});

test('roads, doors, and building boxes refuse a spot', () => {
  expect(groundBlocksWagon('road')).toBe(true);
  expect(groundBlocksWagon('Dirt')).toBe(true);
  expect(groundBlocksWagon('plaza')).toBe(true);
  expect(groundBlocksWagon('water')).toBe(true);
  expect(groundBlocksWagon('grass')).toBe(false);
  expect(groundBlocksWagon('field')).toBe(false);
  const spot = { x: 0, z: 0, yaw: 0 };
  expect(wagonHitsBlock(spot, { x: 1, z: 0, w: 4, d: 4 })).toBe(true);
  expect(wagonHitsBlock(spot, { x: 12, z: 0, w: 2, d: 2 })).toBe(false);
  expect(wagonNearPoint(spot, { x: 1, z: 1 })).toBe(true);
  expect(wagonNearPoint(spot, { x: 8, z: 0 })).toBe(false);
  expect(wagonSpotClear({ inside: true, blocked: false, road: false, door: false })).toBe(true);
  expect(wagonSpotClear({ inside: true, blocked: false, road: true, door: false })).toBe(false);
  expect(wagonSpotClear({ inside: false, blocked: false, road: false, door: false })).toBe(false);
});
