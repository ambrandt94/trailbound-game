import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  isOakKit,
  oakBiomeIsOpen,
  oakCrownRadius,
  oakInGrove,
  oakMinDistance,
  pickOakInstance,
  selectOaks,
  type KeptOak,
  type OakInstance,
  type OakSpot,
} from '../../src/core/world/oak-dress';

function rest(variant: OakInstance['variant'], spread = 0, scale = 1): OakInstance {
  return {
    variant,
    yaw: 0,
    scale,
    ironbark: false,
    morph: { crown_spread: spread, crown_height: 0, trunk_lean: 0, trunk_thickness: 0 },
  };
}

function fixtureOaks(file: string, biome: string): OakSpot[] {
  const area = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures', file), 'utf8')) as {
    area: { innerOrigin: { x: number; y: number } };
    props: { kit?: string; x: number; y: number }[];
  };
  const origin = area.area.innerOrigin;
  const spots: OakSpot[] = [];
  for (const prop of area.props) {
    if (!prop.kit || !isOakKit(prop.kit)) continue;
    spots.push({
      x: prop.x - origin.x,
      z: prop.y - origin.y,
      kit: prop.kit,
      biome,
    });
  }
  return spots;
}

function assertSeparated(kept: readonly KeptOak[]): void {
  for (let i = 0; i < kept.length; i++) {
    const a = kept[i];
    if (!a) continue;
    for (let j = i + 1; j < kept.length; j++) {
      const b = kept[j];
      if (!b) continue;
      const open = oakBiomeIsOpen(a.biome) || oakBiomeIsOpen(b.biome);
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      expect(distance).toBeGreaterThanOrEqual(oakMinDistance(a.radius, b.radius, open) - 1e-6);
    }
  }
}

test('crown radius follows variant, scale, and crown_spread', () => {
  const base = oakCrownRadius(rest('base'));
  expect(oakCrownRadius(rest('spreading'))).toBeGreaterThan(base);
  expect(base).toBeGreaterThan(oakCrownRadius(rest('upright')));
  expect(oakCrownRadius(rest('windswept'))).toBeGreaterThan(base);
  expect(oakCrownRadius(rest('base', 0.6))).toBeGreaterThan(base);
  expect(oakCrownRadius(rest('base', -0.6))).toBeLessThan(base);
  expect(oakCrownRadius(rest('base', 0, 1.15))).toBeCloseTo(base * 1.15, 5);
  expect(oakMinDistance(3, 3, false)).toBeCloseTo(3 + 3 - 0.225 * 3, 5);
  expect(oakMinDistance(3, 3, true)).toBeGreaterThan(oakMinDistance(3, 3, false));
});

test('oak spacing is deterministic and ignores input order', () => {
  const spots = fixtureOaks('area-hollowmere.json', 'Plains');
  const seed = 1102;
  const first = selectOaks(spots, seed);
  const reversed = selectOaks([...spots].reverse(), seed);
  expect(keys(first)).toEqual(keys(reversed));
  expect(keys(selectOaks(first, seed))).toEqual(keys(first));
  assertSeparated(first);
});

test('forest allows a light crown overlap and plains leave glades', () => {
  const plains = fixtureOaks('area-hollowmere.json', 'Plains');
  const forest = fixtureOaks('area-jadewild.json', 'Forest');
  const plainsKept = selectOaks(plains, 1102);
  const forestKept = selectOaks(forest, 1109);
  const nearSpawn = plainsKept.filter((oak) => Math.hypot(oak.x - 67.5, oak.z - 67.5) < 22);
  assertSeparated(plainsKept);
  assertSeparated(forestKept);
  expect(plainsKept.length).toBeLessThan(plains.length * 0.45);
  expect(plainsKept.length).toBeGreaterThan(20);
  expect(nearSpawn.length).toBeLessThan(20);
  expect(forestKept.length).toBeLessThan(forest.length);
  expect(forestKept.length).toBeGreaterThan(forest.length * 0.5);
  for (const oak of plainsKept) expect(oakInGrove(1102, oak.x, oak.z)).toBe(true);
  const pines = forest.filter((spot) => spot.kit === 'tree_pine_m');
  expect(pines).toHaveLength(0);
});

test('a second scatter treats earlier oaks as anchors', () => {
  const spots = fixtureOaks('area-hollowmere.json', 'Plains');
  const first = selectOaks(spots.slice(0, 40), 1102);
  const second = selectOaks(spots.slice(40), 1102, first);
  assertSeparated([...first, ...second]);
});

test('the seeded picker still agrees with itself', () => {
  const oak = pickOakInstance(1109, 63.5, 59.5);
  expect(pickOakInstance(1109, 63.5, 59.5)).toEqual(oak);
  expect(oak.scale).toBeGreaterThanOrEqual(0.85);
  expect(oak.scale).toBeLessThanOrEqual(1.15);
});

function keys(kept: readonly KeptOak[]): string[] {
  return kept.map((oak) => `${oak.x.toFixed(2)},${oak.z.toFixed(2)}`).sort();
}
