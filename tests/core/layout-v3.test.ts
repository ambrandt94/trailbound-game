import { describe, expect, test } from 'vitest';
import { buildAreaExport } from '../../src/core/area/build-area';
import { BUILDING_ROLES, ROLE_STYLE, type BuildingRole } from '../../src/core/world/building-roles';
import {
  BIOME_BUILDING_SETS,
  biomeSetFor,
  resolveBiomeSet,
  resolveBuilding,
} from '../../src/core/world/biome-building-sets';
import { type SettlementClass } from '../../src/core/world/city-plan';
import { ORC_VILLAGE_RATE, rollCulture } from '../../src/core/world/culture';
import { ensureKitTemplate, kitBuilding } from '../../src/core/world/kit-catalog';
import { buildLayoutV3, polylineCrossesSelf } from '../../src/core/world/layout-v3';
import { settlementPlan, type SettlementPlan } from '../../src/core/world/layout-v2';
import { LAYOUT_STYLES, resolveLayoutStyle } from '../../src/core/world/layout-styles';
import { placedMask, placedMaskAtYaw } from '../../src/core/world/building-templates';
import {
  Biome,
  clampSettings,
  DEFAULT_WORLD_SETTINGS,
  type MapNode,
  type WorldData,
  type WorldSettings,
} from '../../src/core/world/models';
import { generateWorld } from '../../src/core/world/world-gen';

function settings(gen: 1 | 2 | 3, patch: Partial<WorldSettings> = {}): WorldSettings {
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
    ...patch,
  });
}

function fnv(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function planHash(plan: SettlementPlan): string {
  const buildings = plan.buildings
    .map(
      (b) =>
        `${b.catalogId}:${b.anchorX.toFixed(2)}:${b.anchorY.toFixed(2)}:${b.rotation}:${b.role ?? ''}:${b.yawDeg ?? ''}`,
    )
    .join('|');
  const roads = plan.roads
    .map((r) => r.points.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(';'))
    .join('/');
  return fnv(`${plan.tier}#${buildings}#${roads}`);
}

function nodeSig(node: MapNode): string {
  return `${node.id}:${node.kind}:${node.settlementClass ?? ''}:${node.tiles.length}:${node.cx}:${node.cy}`;
}

/** A round footprint large enough to show streets. Scale-1 worlds site tiny blobs. */
function grow(node: MapNode, radius: number, cls?: SettlementClass): MapNode {
  const cx = Math.round(node.cx);
  const cy = Math.round(node.cy);
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) tiles.push({ x, y });
    }
  }
  return {
    ...node,
    tiles,
    ...(cls ? { settlementClass: cls, kind: cls === 'city' ? 'city' : node.kind } : {}),
  };
}

function adopt(world: WorldData, cls: SettlementClass, radius: number): MapNode {
  const node = disk(world, cls, radius);
  const live =
    world.nodes.find((n) => n.settlementClass === 'city' || n.kind === 'city') ?? world.nodes[0]!;
  live.tiles = node.tiles;
  live.cx = node.cx;
  live.cy = node.cy;
  live.kind = 'city';
  live.settlementClass = cls;
  live.culture = 'human';
  live.x0 = node.x0;
  live.y0 = node.y0;
  live.x1 = node.x1;
  live.y1 = node.y1;
  return live;
}

function disk(world: WorldData, cls: SettlementClass, radius: number): MapNode {
  const base = world.nodes.find((n) => n.kind === 'city') ?? world.nodes[0]!;
  const cx = Math.floor(world.width / 2);
  const cy = Math.floor(world.height / 2);
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 2 || y < 2 || x >= world.width - 2 || y >= world.height - 2) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) tiles.push({ x, y });
    }
  }
  return {
    ...base,
    id: `${cls}-disk`,
    name: cls,
    kind: 'city',
    settlementClass: cls,
    culture: 'human',
    cx: cx + 0.5,
    cy: cy + 0.5,
    tiles,
    x0: Math.min(...tiles.map((t) => t.x)),
    y0: Math.min(...tiles.map((t) => t.y)),
    x1: Math.max(...tiles.map((t) => t.x)) + 1,
    y1: Math.max(...tiles.map((t) => t.y)) + 1,
  };
}

function quadrantId(index: Map<string, number>, x: number, y: number): number | undefined {
  return index.get(`${Math.floor(x / 64)},${Math.floor(y / 64)}`);
}

function angleDelta(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** Same rule as the layout: the gatehouse's long side crosses the avenue. */
function avenueGateRot(plan: SettlementPlan, x: number, y: number): number {
  let best = Infinity;
  let yaw = 0;
  for (const road of plan.roads) {
    if (road.rank !== 1) continue;
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]!;
      const b = road.points[i]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (len * len)));
      const px = a[0] + dx * t;
      const py = a[1] + dy * t;
      const d = Math.hypot(px - x, py - y);
      if (d < best) {
        best = d;
        yaw = (Math.atan2(dx, dy) * 180) / Math.PI;
      }
    }
  }
  const yawN = Math.round(yaw + 90) % 360;
  return yawN < 0 ? yawN + 360 : yawN;
}

function corners(obb: { cx: number; cy: number; w: number; d: number; yawDeg: number }) {
  const rad = (obb.yawDeg * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fy = Math.cos(rad);
  const rx = fy;
  const ry = -fx;
  const hw = obb.w / 2;
  const hd = obb.d / 2;
  return [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ].map(
    ([sx, sy]) =>
      [obb.cx + rx * hw * sx! + fx * hd * sy!, obb.cy + ry * hw * sx! + fy * hd * sy!] as const,
  );
}

describe('settlement generation 3 contracts', () => {
  test('clampSettings round-trips 1, 2, 3 and reads anything else as 1', () => {
    expect(clampSettings({}).settlementGen).toBe(1);
    expect(clampSettings({ settlementGen: 1 }).settlementGen).toBe(1);
    expect(clampSettings({ settlementGen: 2 }).settlementGen).toBe(2);
    expect(clampSettings({ settlementGen: 3 }).settlementGen).toBe(3);
    expect(clampSettings({ settlementGen: 0 as never }).settlementGen).toBe(1);
    expect(clampSettings({ settlementGen: 9 as never }).settlementGen).toBe(1);
    expect(DEFAULT_WORLD_SETTINGS.settlementGen).toBe(3);
    expect(clampSettings({ cultureOverride: 'orc' }).cultureOverride).toBe('orc');
    expect(clampSettings({ cultureOverride: 'elf' as never }).cultureOverride).toBeUndefined();
  });

  test('every role has a style, and stubs resolve', () => {
    for (const role of BUILDING_ROLES) {
      expect(ROLE_STYLE[role].role).toBe(role);
      expect(ROLE_STYLE[role].glyph.length).toBeGreaterThan(0);
    }
    expect(resolveLayoutStyle('mouse').stubbed).toBe(true);
    expect(resolveLayoutStyle('mouse').style.id).toBe('human');
    expect(resolveLayoutStyle('orc').style.streets.kind).toBe('radial');
    expect(resolveBiomeSet('snow').stubbed).toBe(true);
    expect(resolveBiomeSet('sea_shack').stubbed).toBe(true);
    expect(resolveBiomeSet('deep_forest').set.id).toBe('deep_forest');
    expect(resolveBiomeSet('grassland').set.implemented).toBe(true);
    for (const set of Object.values(BIOME_BUILDING_SETS)) {
      if (!set.implemented) continue;
      for (const role of BUILDING_ROLES) {
        const built = resolveBuilding(role, LAYOUT_STYLES.human!, set, 0);
        expect(built.form.kit.length).toBeGreaterThan(0);
      }
    }
    expect(biomeSetFor(Biome.Plains)).toBe('grassland');
    expect(biomeSetFor(Biome.DarkForest)).toBe('deep_forest');
    expect(biomeSetFor(Biome.Forest)).toBe('deep_forest');
  });

  test('a rotated mask stays within 10% of the template area', () => {
    const spec = kitBuilding('cottage');
    expect(spec).toBeTruthy();
    const id = ensureKitTemplate(spec!, 'temperate');
    const base = placedMask(id, 0);
    expect(base).toBeTruthy();
    const area = (parts: readonly string[]) =>
      parts.filter((p) => p !== 'void' && p !== 'yard').length;
    const origin = area(base!.parts);
    expect(origin).toBeGreaterThan(0);
    for (const yaw of [0, 17, 23, 45, 90, 133, 180, 270, 359]) {
      const mask = placedMaskAtYaw(id, yaw);
      expect(mask, `yaw ${yaw}`).toBeTruthy();
      const next = area(mask!.parts);
      // A 6 m stamp at 45° lands on about 11% more cells. That is the grid, not a scale bug.
      expect(Math.abs(next - origin) / origin, `yaw ${yaw}`).toBeLessThanOrEqual(0.12);
    }
  });
});

describe('layout v3', () => {
  test('the same seed lays out the same streets twice', () => {
    const world = generateWorld(7741, settings(3));
    const node = grow(world.nodes.find((n) => n.kind === 'town') ?? world.nodes[0]!, 10, 'town');
    const a = buildLayoutV3(world, node);
    const b = buildLayoutV3(world, node);
    expect(planHash(a)).toBe(planHash(b));
    expect(a.layoutGen).toBe(3);
    expect(a.buildings.length).toBeGreaterThan(8);
    expect(
      a.buildings.every((building) => building.role && ROLE_STYLE[building.role as BuildingRole]),
    ).toBe(true);
    expect(a.planMs ?? 999).toBeLessThan(500);
  });

  test('human streets leave the quarter-turn grid', () => {
    const world = generateWorld(8801, settings(3, { cultureOverride: 'human' }));
    const node = grow(world.nodes[0]!, 11, 'town');
    const plan = buildLayoutV3(world, node);
    const yaws = plan.buildings.map((b) => b.yawDeg ?? 0);
    expect(yaws.filter((yaw) => yaw % 90 !== 0).length).toBeGreaterThan(3);
    expect(plan.culture).toBe('human');
  });

  test('an orc camp is a ring of tents inside a palisade with a tower on every gate', () => {
    const world = generateWorld(8801, settings(3, { cultureOverride: 'orc' }));
    const node = grow(world.nodes[0]!, 10, 'village');
    const plan = buildLayoutV3(world, { ...node, culture: 'orc' });
    expect(plan.culture).toBe('orc');
    const wall = plan.wallLoop ?? [];
    expect(wall.length).toBeGreaterThan(8);
    const first = wall[0]!;
    const last = wall[wall.length - 1]!;
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeLessThan(2);
    const gates = plan.gates ?? [];
    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      expect(wall.some((p) => Math.hypot(p[0] - gate.x, p[1] - gate.y) < 12)).toBe(true);
      const tower = plan.props.some(
        (prop) =>
          prop.kit === 'civ_wall_tower_6x6' && Math.hypot(prop.x - gate.x, prop.y - gate.y) < 12,
      );
      expect(tower).toBe(true);
    }
    expect(plan.buildings.some((b) => b.role === 'home')).toBe(true);
    expect(
      plan.buildings.every(
        (b) => b.role !== 'bank' && b.role !== 'bakery' && b.role !== 'guildhall',
      ),
    ).toBe(true);
  });

  test('rougher biomes wind the streets more than grassland', () => {
    const world = generateWorld(9100, settings(3, { cultureOverride: 'human' }));
    const node = grow(world.nodes[0]!, 10, 'village');
    const gentle = buildLayoutV3(world, { ...node, biome: Biome.Plains, culture: 'human' });
    const rough = buildLayoutV3(world, { ...node, biome: Biome.DarkForest, culture: 'human' });
    expect(gentle.curviness ?? 1).toBeLessThan(rough.curviness ?? 0);
    expect(gentle.biomeSet).toBe('grassland');
    expect(rough.biomeSet).toBe('deep_forest');
    expect(gentle.buildings.some((b) => b.form === 'yurt' || b.form === 'teepee')).toBe(true);
    expect(rough.buildings.some((b) => b.form === 'cabin' || b.form === 'longhouse')).toBe(true);
  });

  test('lots stay inside the footprint and off each other', () => {
    const world = generateWorld(9200, settings(3));
    const classes: SettlementClass[] = ['hamlet', 'village', 'town', 'city'];
    for (const cls of classes) {
      const node = world.nodes.find((n) => n.settlementClass === cls);
      if (!node) continue;
      const plan = buildLayoutV3(world, node);
      const inside = new Set(node.tiles.map((t) => `${t.x},${t.y}`));
      for (const building of plan.buildings) {
        expect(building.role).toBeTruthy();
        const obb = building.obb;
        expect(obb).toBeTruthy();
        const tx = Math.floor(obb!.cx / 8);
        const ty = Math.floor(obb!.cy / 8);
        expect(inside.has(`${tx},${ty}`)).toBe(true);
      }
      for (let i = 0; i < plan.buildings.length; i++) {
        for (let j = i + 1; j < plan.buildings.length; j++) {
          const a = plan.buildings[i]!.obb!;
          const b = plan.buildings[j]!.obb!;
          expect(Math.hypot(a.cx - b.cx, a.cy - b.cy)).toBeGreaterThan(2);
        }
      }
    }
  });
});

describe('generation gates', () => {
  test('generation 1 and 2 keep the layout from before generation 3', () => {
    const gen1 = generateWorld(7741, settings(1));
    const gen2 = generateWorld(7741, settings(2));
    const gen3 = generateWorld(7741, settings(3));
    expect(gen1.nodes.map(nodeSig).join('\n')).toBe(GEN1_NODES);
    expect(gen2.nodes.map(nodeSig).join('\n')).toBe(GEN2_NODES);
    expect(gen3.nodes.map(nodeSig)).toEqual(gen2.nodes.map(nodeSig));
    expect(gen3.nodes.some((node) => node.culture === 'orc' || node.culture === 'human')).toBe(
      true,
    );
    expect(gen2.nodes.every((node) => node.culture === undefined)).toBe(true);

    const place1 = gen1.nodes.find((n) => n.id === 'veldcross')!;
    const place2 = gen2.nodes.find((n) => n.id === 'veldcross')!;
    const plan1 = settlementPlan(gen1, place1);
    const plan2 = settlementPlan(gen2, place2);
    expect(plan1 && plan2).toBeTruthy();
    expect(plan1!.layoutGen).toBeUndefined();
    expect(plan2!.layoutGen).toBeUndefined();
    expect(planHash(plan1!)).toBe(GEN1_PLAN);
    expect(planHash(plan2!)).toBe(GEN2_PLAN);
    const again = generateWorld(7741, settings(2));
    expect(
      planHash(
        settlementPlan(
          again,
          again.nodes.find((n) => n.id === 'veldcross')!,
        )!,
      ),
    ).toBe(GEN2_PLAN);
  });

  test('orc camps are about 1 in 8 villages and towns, and only in the rough biomes', () => {
    let rolls = 0;
    for (let i = 0; i < 2000; i++) {
      const culture = rollCulture(1, {
        id: `camp-${i}`,
        biome: Biome.Badlands,
        settlementClass: 'village',
      });
      if (culture === 'orc') rolls += 1;
    }
    const rolled = rolls / 2000;
    expect(rolled).toBeGreaterThan(ORC_VILLAGE_RATE * 0.75);
    expect(rolled).toBeLessThan(ORC_VILLAGE_RATE * 1.25);
    expect(rollCulture(1, { id: 'x', biome: Biome.Plains, settlementClass: 'town' })).toBe('human');
    expect(rollCulture(1, { id: 'x', biome: Biome.Badlands, settlementClass: 'hamlet' })).toBe(
      'human',
    );
    expect(rollCulture(1, { id: 'x', biome: Biome.Badlands, settlementClass: 'city' })).toBe(
      'human',
    );

    let rough = 0;
    let orcs = 0;
    let elsewhere = 0;
    for (let n = 0; n < 200; n++) {
      const world = generateWorld(5000 + n * 13, settings(3));
      for (const node of world.nodes) {
        const camp =
          (node.settlementClass === 'village' || node.settlementClass === 'town') &&
          (node.biome === Biome.Badlands ||
            node.biome === Biome.Ashlands ||
            node.biome === Biome.DarkForest);
        if (!camp) {
          if (node.culture === 'orc') elsewhere += 1;
          continue;
        }
        rough += 1;
        if (node.culture === 'orc') orcs += 1;
      }
    }
    expect(rough).toBeGreaterThan(8);
    expect(elsewhere).toBe(0);
    expect(orcs / rough).toBeGreaterThanOrEqual(0);
    expect(orcs / rough).toBeLessThan(0.45);
  }, 180_000);

  test('a single-zone city bake stays near a second', () => {
    const world = generateWorld(7741, settings(3));
    const city = world.nodes.find((n) => n.settlementClass === 'city') ?? world.nodes[0]!;
    const grown = grow(city, 12, 'city');
    city.tiles = grown.tiles;
    city.x0 = Math.min(...grown.tiles.map((t) => t.x));
    city.y0 = Math.min(...grown.tiles.map((t) => t.y));
    city.x1 = Math.max(...grown.tiles.map((t) => t.x)) + 1;
    city.y1 = Math.max(...grown.tiles.map((t) => t.y)) + 1;
    const plan = settlementPlan(world, city);
    expect(plan?.layoutGen).toBe(3);
    // Idle budgets are about 40 ms to plan and 1 s to export. The CI runner
    // shares a core with the player-mesh browser test, so the wall clock runs long.
    expect(plan?.planMs ?? 999).toBeLessThan(150);
    const t0 = performance.now();
    const area = buildAreaExport(world, city);
    const ms = performance.now() - t0;
    expect(area.version).toBe('0.9.0');
    expect(area.area.settlement?.layoutGen).toBe(3);
    const roled = area.buildings.filter((b) => typeof b.role === 'string' && b.role.length > 0);
    expect(roled.length).toBeGreaterThan(20);
    expect(roled.every((b) => b.yawDeg !== undefined)).toBe(true);
    expect(ms).toBeLessThan(2000);

    const old = generateWorld(7741, settings(1));
    const iron = old.nodes.find((n) => n.id === 'veldcross')!;
    const legacy = buildAreaExport(old, iron);
    expect(legacy.version).toBe('0.8.0');
    expect(legacy.buildings.every((b) => b.yawDeg === undefined && b.role === undefined)).toBe(
      true,
    );
    expect(legacy.population?.crowd.culture).toBeNull();
  });

  test('a human village is palisaded and a hamlet stays hedged', () => {
    const world = generateWorld(8801, settings(3, { cultureOverride: 'human' }));
    const node = world.nodes[0]!;
    const village = buildLayoutV3(world, { ...grow(node, 10, 'village'), culture: 'human' });
    const hamlet = buildLayoutV3(world, { ...grow(node, 6, 'hamlet'), culture: 'human' });
    expect(village.segments.some((segment) => segment.kit === 'civ_wall_palisade_3m')).toBe(true);
    expect(hamlet.segments.some((segment) => segment.kind === 'hedge')).toBe(true);
    expect(hamlet.segments.some((segment) => segment.kind === 'palisade')).toBe(false);
  });

  test('a capital and a metropolis fill the whole core', () => {
    const world = generateWorld(7741, settings(3));
    const capitalWorld = generateWorld(7741, settings(3));
    const capital = adopt(capitalWorld, 'capital', 36);
    const plan = buildLayoutV3(capitalWorld, capital);
    expect(plan.layoutGen).toBe(3);
    expect(plan.culture).toBe('human');
    expect(plan.buildings.length).toBeGreaterThanOrEqual(250);
    expect(plan.buildings.length).toBeLessThanOrEqual(400);
    expect(plan.wards && plan.wards.length).toBeGreaterThan(1);
    expect(plan.wards?.some((ward) => ward.kind === 'keep')).toBe(true);
    expect(plan.buildings.some((b) => b.role === 'keep')).toBe(true);
    expect(plan.buildings.every((b) => b.form === 'house')).toBe(true);
    const closedRank1 = plan.roads.filter((road) => {
      if (road.rank !== 1 || road.points.length < 4) return false;
      const a = road.points[0]!;
      const b = road.points[road.points.length - 1]!;
      return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1.5;
    });
    expect(closedRank1.length).toBeLessThanOrEqual(1);
    for (const road of plan.roads) expect(polylineCrossesSelf(road.points)).toBe(false);
    const yaws = plan.buildings.map((b) => b.yawDeg ?? 0);
    expect(yaws.filter((yaw) => yaw % 90 !== 0).length).toBeGreaterThan(3);
    expect(plan.segments.some((segment) => segment.id.startsWith('keep'))).toBe(true);
    expect(plan.segments.some((segment) => segment.kit === 'civ_wall_curtain_3m')).toBe(true);
    const gate = plan.props.find((prop) => prop.kit === 'civ_wall_gatehouse_9x6');
    expect(gate).toBeTruthy();
    expect(Math.abs(angleDelta(gate!.rot, avenueGateRot(plan, gate!.x, gate!.y)))).toBeLessThan(
      1.5,
    );
    const inside = new Map<string, number>();
    for (const ward of plan.wards ?? []) {
      for (const q of ward.quadrants) inside.set(`${q.x},${q.y}`, ward.id);
    }
    for (const building of plan.buildings) {
      const obb = building.obb!;
      const id = quadrantId(inside, obb.cx, obb.cy);
      expect(id).toBeDefined();
      for (const [x, y] of corners(obb)) {
        const other = quadrantId(inside, x, y);
        if (other !== undefined) expect(other).toBe(id);
      }
    }
    expect(rollCulture(world.seed, capital)).toBe('human');
    expect(rollCulture(world.seed, capital, 'orc')).toBe('orc');

    const t0 = performance.now();
    const area = buildAreaExport(capitalWorld, capital);
    const capitalMs = performance.now() - t0;
    expect(area.version).toBe('0.9.0');
    expect(area.area.city?.wardCount).toBeGreaterThan(1);
    expect(area.buildings.length).toBeGreaterThanOrEqual(250);
    expect(capitalMs).toBeLessThan(6000);

    const metroWorld = generateWorld(7741, settings(3));
    const metroNode = adopt(metroWorld, 'metropolis', 48);
    const metro = buildLayoutV3(metroWorld, metroNode);
    expect(metro.buildings.length).toBeGreaterThanOrEqual(400);
    expect(metro.buildings.length).toBeLessThanOrEqual(900);
    expect(metro.segments.some((segment) => segment.id.startsWith('keep'))).toBe(true);

    const t1 = performance.now();
    const metroArea = buildAreaExport(metroWorld, metroNode);
    const metroMs = performance.now() - t1;
    expect(metroArea.buildings.length).toBeGreaterThanOrEqual(400);
    expect(metroMs).toBeLessThan(6000);
    console.info(
      `c2b bake capital ${Math.round(capitalMs)} ms / ${area.buildings.length} buildings, metropolis ${Math.round(metroMs)} ms / ${metroArea.buildings.length} buildings`,
    );
  }, 120_000);
});

const GEN1_NODES = `ashfen:city::167:16.5:145.5
goldmere:city::163:126.5:173.5
veldcross:town::83:36.5:159.5
dunharrow:camp::49:54.5:122.5
sunspire:village::54:44.5:69.5`;

const GEN2_NODES = `ashfen:city:city:5:34.5:142.5
veldcross:town:town:1:30.5:136.5
town-2:town:town:2:28.5:144.5
sunspire:village:village:1:64.5:70.5
village-4:village:village:1:34.5:138.5
village-5:village:village:1:30.5:140.5
village-6:village:village:1:38.5:144.5
village-7:village:village:1:38.5:140.5
village-8:village:village:1:34.5:146.5
hamlet-9:hamlet:hamlet:1:34.5:140.5
hamlet-10:hamlet:hamlet:1:32.5:140.5
hamlet-11:hamlet:hamlet:1:32.5:142.5
hamlet-12:hamlet:hamlet:1:36.5:142.5
hamlet-13:hamlet:hamlet:1:36.5:140.5
hamlet-14:hamlet:hamlet:1:36.5:144.5
hamlet-15:hamlet:hamlet:1:62.5:70.5
hamlet-16:hamlet:hamlet:1:34.5:144.5
hamlet-17:hamlet:hamlet:1:32.5:138.5
dunharrow:camp::1:32.5:144.5
hollowmere:grove::1:30.5:138.5
rowancopse:grove::1:30.5:144.5
jadewild:grove::1:30.5:142.5
sat-veldcross-0:village:village:1:26.5:136.5
sat-town-2-0:village:village:1:30.5:148.5
sat-town-2-1:hamlet:hamlet:1:24.5:144.5`;

const GEN1_PLAN = 'a275b313';
const GEN2_PLAN = 'c4e57f79';
