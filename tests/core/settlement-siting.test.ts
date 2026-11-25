import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { savedWorldSettings } from '../../src/core/save/migrations';
import type { PackedWorld } from '../../src/core/save/types';
import { mapDisplayStep } from '../../src/core/world/map-grid';
import {
  Biome,
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
  type MapNode,
  type WorldSettings,
} from '../../src/core/world/models';
import { SIZE_CLASS, type SettlementClass } from '../../src/core/world/city-plan';
import { satelliteRolesFor } from '../../src/core/world/settlement-siting';
import { generateWorld } from '../../src/core/world/world-gen';

const CLASSES: SettlementClass[] = ['hamlet', 'village', 'town', 'city', 'capital', 'metropolis'];

function settings(gen: 1 | 2, seedPatch: Partial<WorldSettings> = {}): WorldSettings {
  return clampSettings({
    ...DEFAULT_WORLD_SETTINGS,
    worldSource: 'island',
    worldScale: 1,
    mapStyle: 'continent',
    poiCount: 0,
    wanderers: 0,
    caravans: 0,
    armies: 0,
    settlementGen: gen,
    ...seedPatch,
  });
}

function signature(node: MapNode): string {
  const outskirts = node.outskirts?.length ?? 0;
  return [
    node.id,
    node.name,
    node.kind,
    node.settlementClass ?? '',
    node.satelliteOf ?? '',
    node.satelliteRole ?? '',
    node.tiles.length,
    outskirts,
    node.cx,
    node.cy,
  ].join(':');
}

function marginOf(node: MapNode): number {
  if (node.settlementClass) return SIZE_CLASS[node.settlementClass].chunkEdgeMargin;
  return SIZE_CLASS.hamlet.chunkEdgeMargin;
}

function displayGap(a: MapNode, b: MapNode, step: number): number {
  return Math.hypot(a.cx - b.cx, b.cy - a.cy) / step - a.radius / step - b.radius / step;
}

describe('settlement generation 2', () => {
  test('a save without settlementGen rebuilds generation 1 and PackedWorld is unchanged', () => {
    const gen1 = settings(1);
    const world = generateWorld(4401, gen1);
    expect(world.settings.settlementGen).toBe(1);

    const legacy = { ...gen1 } as WorldSettings;
    delete (legacy as { settlementGen?: number }).settlementGen;
    const restored = clampSettings(legacy);
    expect(restored.settlementGen).toBe(1);
    const again = generateWorld(4401, restored);
    expect(again.nodes.map(signature)).toEqual(world.nodes.map(signature));
    expect(Buffer.from(again.biomes).equals(Buffer.from(world.biomes))).toBe(true);

    const packed = { worldSeed: 4401, worldSettings: { ...gen1 } } as PackedWorld;
    expect(Object.prototype.hasOwnProperty.call(packed, 'nodes')).toBe(false);
    delete (packed.worldSettings as { settlementGen?: number }).settlementGen;
    const fromSave = savedWorldSettings(packed);
    expect(fromSave.settlementGen).toBe(1);
    expect(generateWorld(4401, fromSave).nodes.map(signature)).toEqual(world.nodes.map(signature));

    const gen2 = generateWorld(4401, settings(2));
    expect(gen2.settings.settlementGen).toBe(2);
    expect(gen2.nodes.map(signature)).not.toEqual(world.nodes.map(signature));
    expect(Buffer.from(gen2.biomes).equals(Buffer.from(world.biomes))).toBe(true);
    expect(gen2.nodes.some((node) => node.settlementClass === 'hamlet')).toBe(true);
  });

  test('200 seeds keep margins, one metropolis, spacing, biome satellites, and the seed', () => {
    const totals: Record<SettlementClass, number> = {
      hamlet: 0,
      village: 0,
      town: 0,
      city: 0,
      capital: 0,
      metropolis: 0,
    };
    const perWorld: Record<SettlementClass, number[]> = {
      hamlet: [],
      village: [],
      town: [],
      city: [],
      capital: [],
      metropolis: [],
    };
    let metroWorlds = 0;
    let capitalWorlds = 0;
    let satellites = 0;
    let townWithRing = 0;
    let townPlus = 0;
    const problems: string[] = [];

    for (let n = 0; n < 200; n++) {
      const seed = 1000 + n * 17;
      const world = generateWorld(seed, settings(2));
      const again = generateWorld(seed, settings(2));
      expect(again.nodes.map(signature), `seed ${seed}`).toEqual(world.nodes.map(signature));
      const step = mapDisplayStep(world.width);
      const counts: Record<SettlementClass, number> = {
        hamlet: 0,
        village: 0,
        town: 0,
        city: 0,
        capital: 0,
        metropolis: 0,
      };
      const occupied = new Set<string>();
      for (const node of world.nodes) {
        const margin = marginOf(node) * step;
        const tiles = [...node.tiles, ...(node.outskirts ?? [])];
        for (const tile of tiles) {
          if (
            tile.x < margin ||
            tile.y < margin ||
            tile.x >= world.width - margin ||
            tile.y >= world.height - margin
          ) {
            problems.push(`${seed} ${node.id} tile ${tile.x},${tile.y} inside margin ${margin}`);
            break;
          }
        }
        for (const tile of node.tiles) {
          const key = `${tile.x},${tile.y}`;
          if (occupied.has(key)) problems.push(`${seed} overlap ${node.id} at ${key}`);
          occupied.add(key);
        }
        const cls = node.settlementClass;
        if (!cls) continue;
        counts[cls]++;
        if (node.satelliteOf) {
          satellites++;
          if (node.satelliteRole && node.satelliteRole !== 'market town') {
            const allowed = satelliteRolesFor(node.biome);
            if (!allowed.includes(node.satelliteRole)) {
              problems.push(
                `${seed} ${node.id} role ${node.satelliteRole} on ${Biome[node.biome]}`,
              );
            }
          }
          if (
            node.satelliteRole?.includes('fishing') &&
            !near(world, node, 2, (b) => b === Biome.Water)
          ) {
            problems.push(`${seed} ${node.id} fishing off the water`);
          }
          if (
            (node.satelliteRole?.includes('mining') || node.satelliteRole?.includes('quarry')) &&
            node.biome !== Biome.Ashlands &&
            node.biome !== Biome.Hills &&
            node.biome !== Biome.Mountain &&
            node.biome !== Biome.Heath &&
            !near(
              world,
              node,
              3,
              (b) => b === Biome.Hills || b === Biome.Mountain || b === Biome.Heath,
            )
          ) {
            problems.push(`${seed} ${node.id} mine with no hill`);
          }
          const parent = world.nodes.find((item) => item.id === node.satelliteOf);
          if (parent && displayGap(node, parent, step) < 0.85) {
            problems.push(`${seed} ${node.id} overlaps ${parent.id}`);
          }
        }
      }
      let metros = 0;
      for (const cls of CLASSES) {
        totals[cls] += counts[cls];
        perWorld[cls].push(counts[cls]);
      }
      metros = counts.metropolis;
      if (metros > 1) problems.push(`${seed} has ${metros} metropolises`);
      if (metros === 1) metroWorlds++;
      if (counts.capital > 0) capitalWorlds++;
      if (counts.city + counts.capital + counts.metropolis < 1)
        problems.push(`${seed} has no city`);
      if (counts.town < 1) problems.push(`${seed} has no town`);
      if (counts.village < 1) problems.push(`${seed} has no village`);
      if (counts.hamlet < 1) problems.push(`${seed} has no hamlet`);
      const primaries = world.nodes.filter((node) => node.settlementClass && !node.satelliteOf);
      for (let i = 0; i < primaries.length; i++) {
        for (let j = i + 1; j < primaries.length; j++) {
          const a = primaries[i]!;
          const b = primaries[j]!;
          const need = pairNeed(a.settlementClass!, b.settlementClass!);
          const d = Math.hypot(a.cx - b.cx, a.cy - b.cy) / step;
          if (d + 1e-6 < need) problems.push(`${seed} ${a.id}–${b.id} ${d.toFixed(2)} < ${need}`);
        }
      }
      for (const node of world.nodes) {
        const cls = node.settlementClass;
        if (!cls || cls === 'hamlet' || cls === 'village' || node.satelliteOf) continue;
        townPlus++;
        if ((node.outskirts?.length ?? 0) > 0) townWithRing++;
      }
      for (let i = 0; i < world.nodes.length; i++) {
        for (let j = i + 1; j < world.nodes.length; j++) {
          const a = world.nodes[i]!;
          const b = world.nodes[j]!;
          if (!a.satelliteOf && !b.satelliteOf) continue;
          if (a.satelliteOf !== b.satelliteOf && a.satelliteOf !== b.id && b.satelliteOf !== a.id)
            continue;
          if (displayGap(a, b, step) < 0.85)
            problems.push(`${seed} satellites ${a.id} ${b.id} too close`);
        }
      }
    }

    const summary = {
      seeds: 200,
      byClass: Object.fromEntries(
        CLASSES.map((cls) => {
          const rows = perWorld[cls];
          const mean = totals[cls] / 200;
          return [
            cls,
            { total: totals[cls], min: Math.min(...rows), max: Math.max(...rows), mean },
          ];
        }),
      ),
      metroWorlds,
      capitalWorlds,
      satellites,
      townPlus,
      townWithRing,
    };
    mkdirSync('/tmp', { recursive: true });
    writeFileSync('/tmp/settlement-siting-stats.json', JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    expect(problems, problems.slice(0, 12).join('\n')).toEqual([]);
    expect(metroWorlds).toBeGreaterThan(0);
    expect(metroWorlds).toBeLessThan(40);
    expect(capitalWorlds).toBeGreaterThan(0);
    expect(satellites).toBeGreaterThan(200);
    expect(townWithRing / Math.max(1, townPlus)).toBeGreaterThan(0.8);
  }, 180_000);
});

function pairNeed(a: SettlementClass, b: SettlementClass): number {
  const gap: Record<SettlementClass, number> = {
    hamlet: 2,
    village: 3,
    town: 6,
    city: 12,
    capital: 12,
    metropolis: 14,
  };
  const cityish = (cls: SettlementClass) =>
    cls === 'city' || cls === 'capital' || cls === 'metropolis';
  if (cityish(a) && cityish(b)) return Math.max(gap[a], gap[b]);
  return Math.min(gap[a], gap[b]);
}

function near(
  world: { biomes: Uint8Array; width: number; height: number },
  node: MapNode,
  tiles: number,
  pred: (biome: Biome) => boolean,
): boolean {
  const step = mapDisplayStep(world.width);
  const dist = tiles * step;
  const cx = Math.floor(node.cx);
  const cy = Math.floor(node.cy);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(angle) * dist);
    const y = Math.round(cy + Math.sin(angle) * dist);
    if (x < 0 || y < 0 || x >= world.width || y >= world.height) continue;
    if (pred(world.biomes[x + y * world.width] as Biome)) return true;
  }
  return false;
}
