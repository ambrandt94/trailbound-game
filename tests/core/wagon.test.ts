import { expect, test } from 'vitest';
import {
  PARTY_WAGON_ASSET,
  WAGON_BOX,
  WAGON_FOOTPRINT,
  WAGON_SPAWN_GAP_M,
  WAGON_USE_RADIUS_M,
  chooseWagonSpot,
  groundBlocksWagon,
  partyWagonUrl,
  wagonBodyAabb,
  wagonCandidates,
  wagonFootSamples,
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
  expect(spots.length).toBeGreaterThan(8);
  expect(Math.max(...spots.map((spot) => Math.hypot(spot.x - 10, spot.z - 20)))).toBeGreaterThan(
    10,
  );
  for (const spot of spots) {
    expect(Math.hypot(spot.x - 10, spot.z - 20)).toBeGreaterThanOrEqual(WAGON_SPAWN_GAP_M - 1e-6);
  }
  expect(spots[0]!.x).toBeGreaterThan(10);
  const picked = chooseWagonSpot(spots, (spot) => spot.x < 10);
  expect(picked?.x).toBeLessThan(10);
  expect(chooseWagonSpot(spots, () => false)).toBeNull();
});

test('the covered wagon collision is the body, and parking covers the tongue', () => {
  expect(WAGON_BOX.minX).toBeCloseTo(-0.94, 2);
  expect(WAGON_BOX.maxX).toBeCloseTo(0.94, 2);
  expect(WAGON_BOX.minZ).toBeCloseTo(-1.79, 2);
  expect(WAGON_BOX.maxZ).toBeCloseTo(1.8, 2);
  expect(WAGON_BOX.h).toBeCloseTo(2.7, 2);
  expect(WAGON_BOX.w).toBeCloseTo(1.88, 2);
  expect(WAGON_BOX.d).toBeCloseTo(3.59, 2);

  const length = WAGON_FOOTPRINT.maxZ - WAGON_FOOTPRINT.minZ;
  expect(WAGON_FOOTPRINT.minX).toBeCloseTo(-0.936, 3);
  expect(WAGON_FOOTPRINT.maxX).toBeCloseTo(0.936, 3);
  expect(WAGON_FOOTPRINT.minZ).toBeCloseTo(-1.788, 3);
  expect(WAGON_FOOTPRINT.maxZ).toBeCloseTo(3.303, 2);
  expect(length).toBeGreaterThan(5.05);
  expect(length).toBeLessThan(5.1);
  expect(WAGON_SPAWN_GAP_M).toBeGreaterThan(Math.hypot(0.936, 3.303));
  expect(WAGON_USE_RADIUS_M).toBeGreaterThan(WAGON_FOOTPRINT.maxZ);
  expect(WAGON_USE_RADIUS_M).toBeLessThan(WAGON_FOOTPRINT.maxZ + 1.2);

  const home = { x: 0, z: 0, yaw: 0 };
  const tongue = { x: 0, z: 3.15, w: 0.2, d: 0.2 };
  const behind = { x: 0, z: -2.6, w: 0.2, d: 0.2 };
  expect(wagonHitsBlock(home, tongue)).toBe(true);
  expect(wagonHitsBlock(home, behind)).toBe(false);
  expect(wagonHitsBlock({ x: 0, z: 0, yaw: Math.PI / 2 }, { x: 3.15, z: 0, w: 0.2, d: 0.2 })).toBe(
    true,
  );
  expect(wagonHitsBlock({ x: 0, z: 0, yaw: Math.PI / 2 }, { x: 0, z: 3.15, w: 0.2, d: 0.2 })).toBe(
    false,
  );

  expect(wagonNearPoint(home, { x: 0, z: 3.3 })).toBe(true);
  expect(wagonNearPoint({ x: 0, z: 0, yaw: Math.PI / 2 }, { x: 3.3, z: 0 })).toBe(true);
  expect(wagonNearPoint(home, { x: 0, z: 6 })).toBe(false);

  const samples = wagonFootSamples(home);
  expect(samples.some((sample) => sample.z > 3.2)).toBe(true);
  expect(samples.some((sample) => sample.z < -1.7)).toBe(true);
  expect(samples.some((sample) => Math.abs(sample.x) > 0.9)).toBe(true);

  const body = wagonBodyAabb({ x: 10, z: 20, yaw: 0 });
  expect(body.w).toBeCloseTo(1.88, 2);
  expect(body.d).toBeCloseTo(3.59, 2);
  expect(body.h).toBeCloseTo(2.7, 2);
  expect(body.x).toBeCloseTo(10, 5);
  expect(body.z).toBeCloseTo(20.005, 3);
  expect(body.z + body.d / 2).toBeLessThan(21.85);
  expect(20 + 3.3).toBeGreaterThan(body.z + body.d / 2);

  const turned = wagonBodyAabb({ x: 0, z: 0, yaw: Math.PI / 2 });
  expect(turned.w).toBeCloseTo(3.59, 2);
  expect(turned.d).toBeCloseTo(1.88, 2);
  expect(turned.x + turned.w / 2).toBeCloseTo(1.8, 2);
  expect(3.3).toBeGreaterThan(turned.x + turned.w / 2);
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
