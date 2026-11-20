import { expect, test, vi } from 'vitest';

// Full world generation runs past the 5 s default on the Windows CI runner.
vi.setConfig({ testTimeout: 120_000 });
import { settlementZoneRect } from '../../src/core/area/area-window';
import { BORDER_WORLD_TILES } from '../../src/core/area/build-area';
import {
  TOWN_OUTSKIRTS_TILES,
  normalizeZones,
  rememberZone,
  zoneContaining,
} from '../../src/core/area/zone-history';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/state/settings';
import { WorldState } from '../../src/core/state/world-state';
import { boundsFromTiles } from '../../src/core/world/models';

function newGame(): WorldState {
  const world = new WorldState();
  world.beginGeneratedWorld();
  return world;
}

/** Stand the hero (on foot) at a town's centre and drop the caravan route. */
function standIn(world: WorldState, name: string): void {
  const node = world.data!.nodes.find((n) => n.name === name)!;
  world.caravan = { ...world.caravan, route: [], along: 0, length: 0, targets: [] };
  world.leaveCaravan();
  world.hero = { x: node.cx, y: node.cy, yaw: 0 };
}

test('the two map zone settings are separate, both default on', () => {
  expect(DEFAULT_SETTINGS.zoneOutlines).toBe(true);
  expect(DEFAULT_SETTINGS.zonePreview).toBe(true);
  expect(normalizeSettings({})).toMatchObject({ zoneOutlines: true, zonePreview: true });
  expect(normalizeSettings({ zoneOutlines: true, zonePreview: false })).toMatchObject({
    zoneOutlines: true,
    zonePreview: false,
  });
  expect(normalizeSettings({ zoneOutlines: false, zonePreview: true })).toMatchObject({
    zoneOutlines: false,
    zonePreview: true,
  });
  expect(normalizeSettings({ zonePreview: 'no' }).zonePreview).toBe(true);
});

test('an old single zoneOutlines value carries over to both toggles', () => {
  expect(normalizeSettings({ zoneOutlines: false })).toMatchObject({
    zoneOutlines: false,
    zonePreview: false,
  });
  expect(normalizeSettings({ zoneOutlines: true })).toMatchObject({
    zoneOutlines: true,
    zonePreview: true,
  });
  // Once split and saved, each keeps its own value.
  const saved = normalizeSettings({ zoneOutlines: false });
  expect(
    normalizeSettings(JSON.parse(JSON.stringify({ ...saved, zonePreview: true }))),
  ).toMatchObject({ zoneOutlines: false, zonePreview: true });
});

test('a town box is its footprint plus the export outskirts ring, clamped to the world', () => {
  expect(TOWN_OUTSKIRTS_TILES).toBe(BORDER_WORLD_TILES);
  const world = newGame();
  const data = world.data!;
  const node = data.nodes.find((n) => n.name === 'Ashfen')!;
  const foot = boundsFromTiles(node.tiles ?? []);
  const box = settlementZoneRect(data, node);
  expect(box).toEqual({
    x0: foot.x0 - BORDER_WORLD_TILES,
    y0: foot.y0 - BORDER_WORLD_TILES,
    x1: foot.x1 + BORDER_WORLD_TILES,
    y1: foot.y1 + BORDER_WORLD_TILES,
  });
  const edge = { ...node, tiles: [{ x: 0, y: 1 }] };
  expect(settlementZoneRect(data, edge)).toMatchObject({ x0: 0, y0: 0 });
});

test('the box matches what the 3D town export plays on and draws', () => {
  const world = newGame();
  standIn(world, 'Ashfen');
  const choice = world.zoneChoice()!;
  expect(choice.source).toBe('town');
  const plan = world.zoomInPlan();
  const area = plan.handoff!.areaExport.area;
  const ring = area.borderWorldTiles;
  // worldBounds is inclusive; the box is exclusive.
  expect(choice.rect.x0).toBe(area.worldBounds.x0 - ring);
  expect(choice.rect.y0).toBe(area.worldBounds.y0 - ring);
  expect(choice.rect.x1).toBe(area.worldBounds.x1 + 1 + ring);
  expect(choice.rect.y1).toBe(area.worldBounds.y1 + 1 + ring);
  // Every tile of the town sits inside it.
  for (const [x, y] of area.worldTiles) {
    expect(x).toBeGreaterThanOrEqual(choice.rect.x0);
    expect(x).toBeLessThan(choice.rect.x1);
    expect(y).toBeGreaterThanOrEqual(choice.rect.y0);
    expect(y).toBeLessThan(choice.rect.y1);
  }
});

test('entering a town files it as the newest zone, kind town, and the preview is its box', () => {
  const world = newGame();
  standIn(world, 'Ashfen');
  const choice = world.zoneChoice()!;
  expect(world.zones).toEqual([]);
  world.zoomInPlan();
  expect(world.zones).toHaveLength(1);
  expect(world.zones[0]).toMatchObject({ ...choice.rect, kind: 'town', name: 'Ashfen' });
});

test('a town zoomed into with the caravan routed through it is filed too', () => {
  const world = newGame();
  const dest = world.data!.nodes.find((n) => n.name === 'Saltgate')!;
  const res = world.routeCaravanTo({ x: dest.cx, y: dest.cy, name: dest.name, placeId: dest.id });
  expect(res.ok).toBe(true);
  world.setCaravanHalted(false);
  expect(world.zoneChoice()?.source).toBe('town');
  const plan = world.zoomInPlan();
  expect(plan.handoff?.convoy).toBeTruthy();
  expect(world.zones).toHaveLength(1);
  expect(world.zones[0]).toMatchObject({ kind: 'town', name: 'Ashfen' });
});

test('towns count toward the last three and mix with wild zones', () => {
  const world = newGame();
  standIn(world, 'Ashfen');
  world.zoomInPlan();
  // A wild block out on the plain, then a second one.
  for (const dx of [70, 140]) {
    world.hero = { x: world.hero.x + dx, y: world.hero.y, yaw: 0 };
    expect(world.zoneChoice()?.source).toBe('grid');
    world.zoomInPlan();
  }
  expect(world.zones.map((z) => z.kind)).toEqual(['wild', 'wild', 'town']);
  // A fourth pushes the town out: it counts toward the last three like any zone.
  world.hero = { x: world.hero.x + 90, y: world.hero.y, yaw: 0 };
  world.zoomInPlan();
  expect(world.zones.map((z) => z.kind)).toEqual(['wild', 'wild', 'wild']);
});

test('re-entering inside a remembered town still opens the town, whole', () => {
  const world = newGame();
  standIn(world, 'Ashfen');
  const first = world.zoomInPlan();
  const id = first.handoff!.areaExport.area.id;
  expect(id).toContain('ashfen');
  // Walk away, then back to the same town: it is a town again, not a wild window.
  world.hero = { x: world.hero.x + 200, y: world.hero.y, yaw: 0 };
  standIn(world, 'Ashfen');
  expect(world.zoneChoice()?.source).toBe('town');
  const again = world.zoomInPlan();
  expect(again.handoff!.areaExport.area.id).toBe(id);
  // Filed once: re-entering moves it to the front, no duplicate.
  expect(world.zones.filter((z) => z.kind === 'town')).toHaveLength(1);
});

test('the outskirts ring around a remembered town is not re-cut as that town', () => {
  const world = newGame();
  standIn(world, 'Ashfen');
  world.zoomInPlan();
  const town = world.zones[0]!;
  // Deep inside the box, a town record never answers "re-enter this zone here".
  const mid = { x: (town.x0 + town.x1) / 2, y: (town.y0 + town.y1) / 2 };
  expect(zoneContaining(world.zones, mid.x, mid.y)).toBeNull();
  // A hero standing in the ring (outside the settlement tiles) gets an ordinary wild cut.
  const node = world.data!.nodes.find((n) => n.name === 'Ashfen')!;
  const foot = boundsFromTiles(node.tiles ?? []);
  world.hero = { x: foot.x0 - 2.5, y: (foot.y0 + foot.y1) / 2, yaw: 0 };
  expect(world.settlementAt(world.hero.x, world.hero.y)).toBeNull();
  const choice = world.zoneChoice()!;
  expect(choice.source).toBe('grid');
});

test('town kind survives a save, and old records read as wild', () => {
  const world = newGame();
  standIn(world, 'Ashfen');
  world.zoomInPlan();
  const packed = world.toPacked({
    gameVersion: 't',
    cfPin: { version: '1', generatorVersion: '1' },
  });
  const loaded = new WorldState();
  loaded.beginGeneratedWorld(packed.worldSeed, { keepHero: true });
  loaded.load(JSON.parse(JSON.stringify(packed)));
  expect(loaded.zones).toEqual(world.zones);
  expect(loaded.zones[0]!.kind).toBe('town');
  const old = normalizeZones([{ x0: 1, y0: 1, x1: 25, y1: 25, name: 'x', seq: 1, hours: 0 }]);
  expect(old[0]!.kind).toBe('wild');
  expect(normalizeZones([{ ...old[0], kind: 'bogus' }])[0]!.kind).toBe('wild');
  expect(
    rememberZone([], { x0: 0, y0: 0, x1: 5, y1: 5, name: 'T', kind: 'town' }, 1)[0]!.kind,
  ).toBe('town');
});
