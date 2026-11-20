import { expect, test, vi } from 'vitest';

// Full world generation runs past the 5 s default on the Windows CI runner.
vi.setConfig({ testTimeout: 120_000 });
import { AREA_WINDOW_TILES } from '../../src/core/area/area-window';
import { ZONE_HISTORY_MAX } from '../../src/core/area/zone-history';
import { createCaravan, setRoute } from '../../src/core/sim/caravan';
import { DEFAULT_SETTINGS, normalizeSettings } from '../../src/core/state/settings';
import { WorldState } from '../../src/core/state/world-state';
import { metersToNormalized } from '../../src/core/world/terrain';
import { Biome, DEFAULT_WORLD_SETTINGS } from '../../src/core/world/models';

const SPAN = AREA_WINDOW_TILES;

/** A flat plains world with an east-bound road from (10, 80.5), the caravan rolling, hero aboard. */
function eastRoad(routed = true): WorldState {
  const size = 400;
  const n = size * size;
  const world = new WorldState();
  world.seed = 4411;
  world.data = {
    seed: 4411,
    width: size,
    height: size,
    settings: { ...DEFAULT_WORLD_SETTINGS, worldScale: 1 },
    biomes: new Uint8Array(n).fill(Biome.Plains),
    heightM: new Float32Array(n).fill(40),
    heights: new Float32Array(n).fill(metersToNormalized(40)),
    paths: new Uint8Array(n),
    nodes: [],
    pois: [],
    features: [],
  };
  world.caravan = routed
    ? setRoute(
        createCaravan(10, 80.5),
        [
          { x: 10, y: 80.5 },
          { x: 390, y: 80.5 },
        ],
        [{ x: 390, y: 80.5, name: 'Far', placeId: null }],
      )
    : createCaravan(10, 80.5);
  world.rejoinCaravan();
  return world;
}

/** Put the riding caravan `x` tiles along the road. */
function rideTo(world: WorldState, x: number): void {
  world.caravan = { ...world.caravan, x, along: x - 10 };
  world.rejoinCaravan();
}

function rectOf(plan: ReturnType<WorldState['zoomInPlan']>) {
  const z = plan.handoff!.convoy!.zone!;
  return { x0: z.x0, y0: z.y0, x1: z.x1, y1: z.y1 };
}

test('entering a zone files it in the history; the first lean-ahead cut is the newest', () => {
  const world = eastRoad();
  expect(world.zones).toEqual([]);
  const plan = world.zoomInPlan();
  expect(world.zones).toHaveLength(1);
  expect(world.zones[0]).toMatchObject(rectOf(plan));
  expect(world.zones[0]!.x1 - world.zones[0]!.x0).toBe(SPAN);
  expect(world.zones[0]!.seq).toBe(1);
});

test('the preview is exactly the block the zoom-in then opens (riding, a fresh cut)', () => {
  const world = eastRoad();
  const choice = world.zoneChoice()!;
  expect(choice.source).toBe('lean');
  // It leans down the road: the wagon sits near the west edge.
  expect(world.caravan.x - choice.rect.x0).toBeLessThan((choice.rect.x1 - choice.rect.x0) / 3);
  // Looking does not file anything.
  expect(world.zones).toEqual([]);
  expect(rectOf(world.zoomInPlan())).toEqual(choice.rect);
});

test('the preview follows the zoom: the hero on foot, not the caravan', () => {
  const world = eastRoad();
  world.leaveCaravan();
  world.moveHero(60, 5);
  const choice = world.zoneChoice()!;
  expect(world.hero.x).toBeGreaterThanOrEqual(choice.rect.x0);
  expect(world.hero.x).toBeLessThan(choice.rect.x1);
  expect(rectOf(world.zoomInPlan())).toEqual(choice.rect);
});

test('no route: the preview is the snapped grid window and the zoom opens it', () => {
  const world = eastRoad(false);
  const choice = world.zoneChoice()!;
  expect(choice.source).toBe('grid');
  expect(choice.rect.x0 % SPAN).toBe(0);
  const plan = world.zoomInPlan();
  expect(plan.handoff!.areaExport.area.id ?? '').not.toBe('');
  expect(world.zones[0]).toMatchObject(choice.rect);
});

test('on foot back inside a remembered zone, the zoom re-enters that exact block, not a new cut', () => {
  const world = eastRoad();
  const first = rectOf(world.zoomInPlan());
  // The caravan rolls on far past it; the hero scouts back into the first zone.
  rideTo(world, 200);
  world.leaveCaravan();
  world.moveHero(first.x0 + 12 - world.hero.x, 80.5 - world.hero.y);
  const choice = world.zoneChoice()!;
  expect(choice.source).toBe('remembered');
  expect(choice.rect).toEqual(first);
  const again = world.zoomInPlan();
  expect(rectOf(again)).toEqual(first);
  // The caravan is nowhere near it: the zone has no wagon in it, as for any zone it is not in.
  expect(world.zones).toHaveLength(1);
  expect(world.zones[0]!.seq).toBe(2);
});

test('without remembering, the same on-foot spot gets a hero-centred cut (what zoom-in did before)', () => {
  const world = eastRoad();
  const first = rectOf(world.zoomInPlan());
  world.zones = [];
  rideTo(world, 200);
  world.leaveCaravan();
  world.moveHero(first.x0 + 5 - world.hero.x, 80.5 - world.hero.y);
  const fresh = rectOf(world.zoomInPlan());
  expect(fresh).not.toEqual(first);
});

test('riding, a caravan well inside a remembered zone re-enters it; near the edge it cuts ahead', () => {
  const world = eastRoad();
  const first = rectOf(world.zoomInPlan());
  rideTo(world, first.x0 + 14);
  expect(world.zoneChoice()).toMatchObject({ source: 'remembered', rect: first });
  expect(rectOf(world.zoomInPlan())).toEqual(first);
  // Right at the east edge the wagon would be gone at once: a fresh zone down the road.
  rideTo(world, first.x1 - 1);
  const edge = world.zoneChoice()!;
  expect(edge.source).toBe('lean');
  expect(edge.rect).not.toEqual(first);
  const next = rectOf(world.zoomInPlan());
  expect(next).toEqual(edge.rect);
  expect(world.zones.map((z) => z.x0)).toEqual([next.x0, first.x0]);
});

test('no route: a remembered convoy-cut zone is rebuilt exactly, not snapped to the grid', () => {
  const world = eastRoad();
  const first = rectOf(world.zoomInPlan());
  expect(first.x0 % SPAN).not.toBe(0);
  world.caravan = createCaravan(world.caravan.x, world.caravan.y);
  world.rejoinCaravan();
  const choice = world.zoneChoice()!;
  expect(choice).toMatchObject({ source: 'remembered', rect: first });
  const plan = world.zoomInPlan();
  expect(plan.handoff!.convoy).toBeUndefined();
  const area = plan.handoff!.areaExport.area;
  expect(area.innerOrigin).toBeTruthy();
  expect(world.zones).toHaveLength(1);
  expect(world.zones[0]).toMatchObject(first);
});

test('only three zones are kept as the party moves on', () => {
  const world = eastRoad();
  const rects = [];
  for (let i = 0; i < 5; i++) {
    rideTo(world, 40 + i * 70);
    rects.push(rectOf(world.zoomInPlan()));
  }
  expect(ZONE_HISTORY_MAX).toBe(3);
  expect(world.zones).toHaveLength(3);
  expect(world.zones.map((z) => z.x0)).toEqual([rects[4]!.x0, rects[3]!.x0, rects[2]!.x0]);
});

test('no zone to preview or file on deep water', () => {
  const world = eastRoad(false);
  const data = world.data!;
  const sea = {
    ...data,
    biomes: new Uint8Array(data.biomes).fill(Biome.Water),
    heightM: new Float32Array(data.heightM).fill(-40),
  };
  world.data = sea;
  expect(world.zoneChoice()).toBeNull();
});

test('the history is saved with the world and loads back; an old save loads with none', () => {
  const world = eastRoad();
  rideTo(world, 40);
  world.zoomInPlan();
  rideTo(world, 160);
  world.zoomInPlan();
  const packed = world.toPacked({
    gameVersion: 't',
    cfPin: { version: '1', generatorVersion: '1' },
  });
  expect(packed.zones).toHaveLength(2);
  const saved = JSON.parse(JSON.stringify(packed));
  const loaded = eastRoad();
  loaded.load(saved);
  expect(loaded.zones).toEqual(world.zones);
  const old = { ...saved };
  delete old.zones;
  const fresh = eastRoad();
  fresh.zones = world.zones;
  fresh.load(old);
  expect(fresh.zones).toEqual([]);
});

test('a new world starts with no zones', () => {
  const world = new WorldState();
  world.beginGeneratedWorld();
  expect(world.zones).toEqual([]);
});

test('the zone outline settings default on and survive junk', () => {
  expect(DEFAULT_SETTINGS.zoneOutlines).toBe(true);
  expect(DEFAULT_SETTINGS.zonePreview).toBe(true);
  expect(normalizeSettings({}).zoneOutlines).toBe(true);
  expect(normalizeSettings({ zoneOutlines: false }).zoneOutlines).toBe(false);
  expect(normalizeSettings({ zoneOutlines: 'no' }).zoneOutlines).toBe(true);
  expect(normalizeSettings(null).zoneOutlines).toBe(true);
  expect(normalizeSettings(null).zonePreview).toBe(true);
});

test('a zone hop files the next zone only when it is adopted, not when it is cut ahead of time', () => {
  const world = eastRoad();
  rideTo(world, 60);
  const cut = world.buildConvoyHandoff(60, 80.5, false, world.convoyAhead());
  expect(cut?.convoy?.zone).toBeTruthy();
  expect(world.zones).toEqual([]);
  world.adoptConvoyHandoff(cut!.convoy!);
  expect(world.zones).toHaveLength(1);
  expect(world.zones[0]).toMatchObject({
    x0: cut!.convoy!.zone!.x0,
    y0: cut!.convoy!.zone!.y0,
  });
});
