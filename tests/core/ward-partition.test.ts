import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  boundingBox,
  components4,
  fillHoles,
  hasHole,
  isConnected4,
  morphClose,
  morphOpen,
  quadKey,
  thinnestWidth,
} from '../../src/core/world/city-mask';
import {
  SETTLEMENT_CLASSES,
  SIZE_CLASS,
  cityPlan,
  type CityPlan,
  type SettlementClass,
} from '../../src/core/world/city-plan';
import { WARD_BOX, WARD_MAX, WARD_MIN } from '../../src/core/world/ward-partition';
import {
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
  type WorldSettings,
} from '../../src/core/world/models';
import { savedWorldSettings } from '../../src/core/save/migrations';
import type { PackedWorld } from '../../src/core/save/types';
import { generateWorld } from '../../src/core/world/world-gen';

describe('quadrant masks', () => {
  test('fills an enclosed hole and leaves the exterior empty', () => {
    const ring = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        if (x === 0 || y === 0 || x === 4 || y === 4) ring.push({ x, y });
      }
    }
    expect(hasHole(ring)).toBe(true);
    const filled = fillHoles(ring);
    expect(filled).toHaveLength(25);
    expect(hasHole(filled)).toBe(false);
  });

  test('splits diagonal touches into two 4-connected components', () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
    ];
    expect(components4(cells)).toHaveLength(2);
    expect(isConnected4(cells)).toBe(false);
  });

  test('a 4×4 block is unchanged by open and close, and is two quadrants thick', () => {
    const block = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) block.push({ x, y });
    expect(morphOpen(block, 1)).toEqual(block);
    expect(morphClose(block, 1)).toEqual(block);
    expect(thinnestWidth(block)).toBe(2);
    expect(boundingBox(block)).toMatchObject({ w: 4, h: 4 });
  });

  test('a one-quadrant spur is thinner than 2', () => {
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ];
    expect(thinnestWidth(cells)).toBe(1);
  });
});

interface ClassStat {
  wardsMin: number;
  wardsMax: number;
  sizeMin: number;
  sizeMax: number;
  passesMin: number;
  passesMax: number;
  fallbacks: number;
  warnings: number;
  ms: number;
}

describe('ward partition', () => {
  test('200 seeds × every class, including metropolis', { timeout: 60_000 }, () => {
    const stats = {} as Record<SettlementClass, ClassStat>;
    const failures: string[] = [];
    const started = Date.now();
    for (const settlementClass of SETTLEMENT_CLASSES) {
      const stat: ClassStat = {
        wardsMin: Infinity,
        wardsMax: 0,
        sizeMin: Infinity,
        sizeMax: 0,
        passesMin: Infinity,
        passesMax: 0,
        fallbacks: 0,
        warnings: 0,
        ms: 0,
      };
      const classStarted = Date.now();
      for (let seed = 1; seed <= 200; seed++) {
        const plan = cityPlan(seed, settlementClass);
        const problem = checkPlan(plan);
        if (problem) failures.push(`${settlementClass} seed ${seed}: ${problem}\n${ascii(plan)}`);
        stat.wardsMin = Math.min(stat.wardsMin, plan.wards.length);
        stat.wardsMax = Math.max(stat.wardsMax, plan.wards.length);
        for (const ward of plan.wards) {
          stat.sizeMin = Math.min(stat.sizeMin, ward.quadrants.length);
          stat.sizeMax = Math.max(stat.sizeMax, ward.quadrants.length);
        }
        stat.passesMin = Math.min(stat.passesMin, plan.passes);
        stat.passesMax = Math.max(stat.passesMax, plan.passes);
        if (plan.fallback) stat.fallbacks++;
        stat.warnings += plan.warnings.length;
        if (failures.length >= 8) break;
      }
      stat.ms = Date.now() - classStarted;
      stats[settlementClass] = stat;
      if (failures.length >= 8) break;
    }
    const payload = { elapsedMs: Date.now() - started, stats };
    mkdirSync('/tmp', { recursive: true });
    writeFileSync('/tmp/ward-stats.json', JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload));
    expect(failures, failures.slice(0, 4).join('\n\n')).toEqual([]);
    for (const settlementClass of SETTLEMENT_CLASSES) {
      const stat = stats[settlementClass]!;
      expect(stat.wardsMin, settlementClass).toBeGreaterThan(0);
      if (SIZE_CLASS[settlementClass].singleWard) expect(stat.wardsMax).toBe(1);
      expect(stat.sizeMin).toBeGreaterThanOrEqual(WARD_MIN);
      expect(stat.sizeMax).toBeLessThanOrEqual(WARD_MAX);
    }
  });

  test('missing settlementGen is 1 and old saves load unchanged', () => {
    expect(DEFAULT_WORLD_SETTINGS.settlementGen).toBe(2);
    expect(clampSettings({}).settlementGen).toBe(1);
    expect(clampSettings({ settlementGen: 2 }).settlementGen).toBe(2);
    expect(clampSettings({ settlementGen: undefined }).settlementGen).toBe(1);

    const settings = clampSettings({
      ...DEFAULT_WORLD_SETTINGS,
      worldSource: 'island',
      worldScale: 1,
      mapStyle: 'continent',
      poiCount: 4,
      wanderers: 0,
      caravans: 0,
      armies: 0,
      settlementGen: 1,
    });
    const world = generateWorld(4401, settings);
    expect(world.settings.settlementGen).toBe(1);

    const legacy = { ...settings } as WorldSettings;
    delete (legacy as { settlementGen?: number }).settlementGen;
    const clamped = clampSettings(legacy);
    expect(clamped.settlementGen).toBe(1);
    const again = generateWorld(4401, clamped);
    expect(Buffer.from(again.biomes).equals(Buffer.from(world.biomes))).toBe(true);
    expect(again.nodes.map(nodeSignature)).toEqual(world.nodes.map(nodeSignature));
    expect(again.heightM.length).toBe(world.heightM.length);

    // Generation 2 keeps the terrain and replaces the authored dart layout.
    const flagged = generateWorld(4401, { ...settings, settlementGen: 2 });
    expect(flagged.settings.settlementGen).toBe(2);
    expect(Buffer.from(flagged.biomes).equals(Buffer.from(world.biomes))).toBe(true);
    expect(flagged.nodes.map(nodeSignature)).not.toEqual(world.nodes.map(nodeSignature));

    const packed = {
      worldSeed: 4401,
      worldSettings: { ...settings },
    } as PackedWorld;
    delete (packed.worldSettings as { settlementGen?: number }).settlementGen;
    const restored = savedWorldSettings(packed);
    expect(restored.settlementGen).toBe(1);
    expect(restored.worldScale).toBe(1);
    expect(restored.mapStyle).toBe('continent');
    expect(restored.poiCount).toBe(4);
    const loaded = generateWorld(4401, restored);
    expect(Buffer.from(loaded.biomes).equals(Buffer.from(world.biomes))).toBe(true);
    expect(loaded.nodes.map(nodeSignature)).toEqual(world.nodes.map(nodeSignature));
  });
});

function nodeSignature(node: {
  id: string;
  tiles: { x: number; y: number }[];
  cx: number;
  cy: number;
}): string {
  return `${node.id}:${node.tiles.length}:${node.cx}:${node.cy}`;
}

function checkPlan(plan: CityPlan): string | null {
  const foot = new Set(plan.quadrants.map((cell) => quadKey(cell.x, cell.y)));
  if (hasHole(plan.quadrants)) return 'footprint has a hole';
  if (!isConnected4(plan.quadrants)) return 'footprint is not 4-connected';
  const seen = new Set<number>();
  let fine = 0;
  let fineHash = 0;
  for (const ward of plan.wards) {
    if (!isConnected4(ward.quadrants)) return `ward ${ward.wardId} is not 4-connected`;
    if (hasHole(ward.quadrants)) return `ward ${ward.wardId} has a hole`;
    const box = boundingBox(ward.quadrants);
    if (ward.quadrants.length < WARD_MIN || ward.quadrants.length > WARD_MAX) {
      return `ward ${ward.wardId} size ${ward.quadrants.length}`;
    }
    if (box.w > WARD_BOX || box.h > WARD_BOX) return `ward ${ward.wardId} box ${box.w}x${box.h}`;
    if (thinnestWidth(ward.quadrants) < 2) return `ward ${ward.wardId} is thinner than 2`;
    for (const cell of ward.quadrants) {
      const key = quadKey(cell.x, cell.y);
      if (!foot.has(key)) return `ward ${ward.wardId} has a quadrant outside F`;
      if (seen.has(key)) return `quadrant ${cell.x},${cell.y} is in two wards`;
      seen.add(key);
      const counts = new Map<number, number>();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const other = wardAt(plan, cell.x + dx, cell.y + dy);
        if (other === undefined || other === ward.wardId) continue;
        counts.set(other, (counts.get(other) ?? 0) + 1);
      }
      for (const count of counts.values()) {
        if (count >= 3) return `sliver at ${cell.x},${cell.y}`;
      }
    }
    if (ward.tiles.length !== ward.quadrants.length * 64) {
      return `ward ${ward.wardId} fine tiles are not 8×8 per quadrant`;
    }
    const sample = ward.quadrants[0];
    if (sample) {
      const origin = ward.tiles.find((tile) => tile.x === sample.x * 8 && tile.y === sample.y * 8);
      if (!origin) return `ward ${ward.wardId} is missing its quadrant origin`;
    }
    for (const tile of ward.tiles)
      fineHash += Math.imul(tile.x + 4096, 73856093) ^ Math.imul(tile.y + 4096, 19349663);
    fine += ward.tiles.length;
  }
  if (seen.size !== foot.size) return `union ${seen.size} !== F ${foot.size}`;
  if (fine !== plan.footprint.length) {
    return `fine union ${fine} !== footprint ${plan.footprint.length}`;
  }
  let footHash = 0;
  for (const tile of plan.footprint) {
    footHash += Math.imul(tile.x + 4096, 73856093) ^ Math.imul(tile.y + 4096, 19349663);
  }
  if (footHash !== fineHash) return 'fine tiles do not match F';
  if (!graphConnected(plan)) return 'ward graph is disconnected';
  for (const lot of plan.lots) {
    if (!mono(plan, lot)) return 'a lot is cut';
  }
  for (const bundle of plan.streetBundles) {
    if (!mono(plan, bundle)) return 'a street centreline is a seam';
  }
  if (!SIZE_CLASS[plan.settlementClass].singleWard && plan.streetBundles.length === 0) {
    return 'city has no street bundle';
  }
  for (const segment of plan.wallSegments) {
    if (!mono(plan, segment)) return 'a wall run is split';
  }
  if (plan.keep.length > 1 && !mono(plan, plan.keep)) return 'the keep is split';
  for (const gate of plan.gates) {
    if (wardAt(plan, gate.x, gate.y) === undefined) return 'a gate is outside every ward';
  }
  if (SIZE_CLASS[plan.settlementClass].singleWard && plan.wards.length !== 1) {
    return `${plan.settlementClass} has ${plan.wards.length} wards`;
  }
  return null;
}

const wardLookup = new WeakMap<CityPlan, Map<number, number>>();

function wardAt(plan: CityPlan, x: number, y: number): number | undefined {
  let map = wardLookup.get(plan);
  if (!map) {
    map = new Map();
    for (const ward of plan.wards) {
      for (const cell of ward.quadrants) map.set(quadKey(cell.x, cell.y), ward.wardId);
    }
    wardLookup.set(plan, map);
  }
  return map.get(quadKey(x, y));
}

function mono(plan: CityPlan, cells: readonly { x: number; y: number }[]): boolean {
  let id: number | undefined;
  for (const cell of cells) {
    const got = wardAt(plan, cell.x, cell.y);
    if (got === undefined) return false;
    if (id === undefined) id = got;
    else if (id !== got) return false;
  }
  return true;
}

function graphConnected(plan: CityPlan): boolean {
  if (plan.wards.length <= 1) return true;
  const byId = new Map(plan.wards.map((ward) => [ward.wardId, ward]));
  const seen = new Set<number>([plan.wards[0]!.wardId]);
  const stack = [plan.wards[0]!.wardId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const neighbour of byId.get(id)?.neighbours ?? []) {
      if (seen.has(neighbour.wardId)) continue;
      if (neighbour.seamLength <= 0) continue;
      seen.add(neighbour.wardId);
      stack.push(neighbour.wardId);
    }
  }
  return seen.size === plan.wards.length;
}

function ascii(plan: CityPlan): string {
  const box = boundingBox(plan.quadrants);
  const lines: string[] = [];
  for (let y = box.y0; y <= box.y1; y++) {
    let row = '';
    for (let x = box.x0; x <= box.x1; x++) {
      const id = wardAt(plan, x, y);
      row += id === undefined ? '.' : (id % 36).toString(36);
    }
    lines.push(row);
  }
  return lines.join('\n');
}
