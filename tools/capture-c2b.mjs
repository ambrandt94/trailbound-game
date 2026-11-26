/**
 * Map and 3D shots for C2b: wards, palisade, curtain, and the keep wall.
 * Role colours are on. The town icon itself stays free of role names.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.TB_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.TB_SHOTS ?? '/opt/cursor/artifacts';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--headless=new', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (error) => console.error('PAGE', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('CONSOLE', message.text());
});

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}

async function waitMode(mode, timeout = 180_000) {
  await page.waitForFunction((want) => document.querySelector('#app')?.dataset.mode === want, mode, {
    timeout,
  });
}

async function reachMap(seed, query = '?roles=1') {
  await page.goto(`${base}${query}`);
  await waitMode('title');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await waitMode('worldgen');
  const field = page.getByRole('spinbutton', { name: 'Seed' });
  await field.waitFor();
  await field.fill(String(seed));
  await field.blur();
  await page.getByRole('button', { name: 'Choose character', exact: true }).click();
  await waitMode('creator', 180_000);
  await page.getByRole('button', { name: 'Take the road', exact: true }).click();
  await waitMode('map', 180_000);
  await page.waitForFunction(() => globalThis.__TRAILBOUND__?.world?.data?.nodes?.length > 0, null, {
    timeout: 180_000,
  });
  await page.waitForTimeout(500);
}

async function listSettlements() {
  return page.evaluate(() => {
    const nodes = globalThis.__TRAILBOUND__.world.data.nodes;
    return nodes
      .filter((node) => node.settlementClass)
      .map((node) => ({
        id: node.id,
        name: node.name,
        cls: node.settlementClass,
        biome: node.biome,
        culture: node.culture ?? 'human',
        x: node.cx,
        y: node.cy,
        tiles: node.tiles?.length ?? 0,
      }));
  });
}

function pick(nodes, pred) {
  return nodes.find(pred) ?? null;
}

async function frame(node, scale) {
  await page.evaluate(
    ({ x, y, scale: zoom }) => {
      globalThis.__TRAILBOUND__.frameAt(x, y, zoom);
    },
    { x: node.x, y: node.y, scale },
  );
  await page.waitForTimeout(600);
}

async function enter3d(node) {
  await frame(node, 2.2);
  const placed = await page.evaluate((id) => {
    const world = globalThis.__TRAILBOUND__.world;
    const place = world.data.nodes.find((n) => n.id === id);
    const tile = place.tiles[Math.floor(place.tiles.length / 2)];
    const x = tile.x + 0.5;
    const y = tile.y + 0.5;
    world.hero.x = x;
    world.hero.y = y;
    world.caravan.x = x;
    world.caravan.y = y;
    world.caravan.route = [];
    return { x, y };
  }, node.id);
  console.log('placed', placed);
  const started = Date.now();
  await page.evaluate(() => {
    globalThis.__TRAILBOUND__.enterArea();
  });
  await page.waitForTimeout(1200);
  const banner = await page.locator('#bake-banner').isVisible().catch(() => false);
  if (banner) await shot('c2b-loading');
  await waitMode('area', 180_000);
  await page.waitForFunction(() => globalThis.__tb?.ready === true, null, { timeout: 180_000 });
  const bakeMs = Date.now() - started;
  await page.evaluate(() => globalThis.__tb?.setView?.(0));
  await page.waitForTimeout(700);
  const stats = await page.evaluate(() => ({
    render: globalThis.__tb?.stats?.() ?? null,
    exportMs: globalThis.__tbExportMs ?? null,
  }));
  return { bakeMs, stats, banner };
}

async function nearView() {
  await page.evaluate(() => globalThis.__tb?.setView?.(3));
  await page.waitForTimeout(400);
}

async function standAt(kind) {
  return page.evaluate((want) => {
    const area = globalThis.__TRAILBOUND__.pendingArea?.areaExport;
    if (!area || !globalThis.__tb?.place) return false;
    const origin = area.area.innerOrigin || { x: 0, y: 0 };
    const buildings = area.buildings || [];
    let x = 0;
    let y = 0;
    if (want === 'keep') {
      const seg = (area.segments || []).find((s) => String(s.id).startsWith('keep') && s.points?.length > 2);
      if (!seg) return false;
      const p = seg.points[Math.floor(seg.points.length / 2)];
      x = p[0];
      y = p[1];
    } else if (want === 'gate') {
      const gate = (area.props || []).find((p) => p.kit === 'civ_wall_gatehouse_9x6');
      if (!gate) return false;
      x = gate.x;
      y = gate.y;
    } else {
      const b = buildings[Math.floor(buildings.length / 2)];
      if (!b) return false;
      x = b.x;
      y = b.y;
    }
    let cx = 0;
    let cy = 0;
    for (const b of buildings) {
      cx += b.x;
      cy += b.y;
    }
    cx = buildings.length ? cx / buildings.length : x;
    cy = buildings.length ? cy / buildings.length : y;
    const dx = cx - x;
    const dy = cy - y;
    const len = Math.hypot(dx, dy) || 1;
    const standX = x + (dx / len) * 10;
    const standY = y + (dy / len) * 10;
    globalThis.__tb.place(standX - origin.x, standY - origin.y, 0);
    return true;
  }, kind);
}

async function backToMap() {
  await page.keyboard.press('Escape');
  await waitMode('map', 90_000);
  await page.waitForTimeout(400);
}

async function shootPlace(seed, query, pred, names) {
  await reachMap(seed, query);
  const nodes = await listSettlements();
  const node = pick(nodes, pred);
  console.log(names.map, node);
  if (!node) return null;
  await frame(node, 3.6);
  await shot(names.map);
  const perf = await enter3d(node);
  console.log(names.map, 'perf', JSON.stringify(perf));
  const handoff = await page.evaluate(() => {
    const area = globalThis.__TRAILBOUND__.pendingArea?.areaExport;
    return {
      name: area?.area?.name ?? null,
      buildings: area?.buildings?.length ?? null,
      segments: area?.segments?.length ?? null,
      wards: area?.area?.city?.wardCount ?? null,
      grid: area ? `${area.grid.w}x${area.grid.h}` : null,
    };
  });
  console.log(names.map, 'handoff', handoff);
  const counts = await page.evaluate(() => {
    const payload = window.TBArea && TBArea.payload ? TBArea.payload() : null;
    const segments = payload?.segments ?? [];
    return {
      buildings: payload?.buildings?.length ?? 0,
      segments: segments.length,
      keep: segments.filter((s) => String(s.id).startsWith('keep')).length,
      walls: segments.filter((s) => s.kind === 'wall' || s.kind === 'palisade').length,
    };
  });
  console.log(names.map, 'counts', counts);
  await standAt('centre');
  await page.evaluate(() => globalThis.__tb?.setView?.(0));
  await page.waitForTimeout(500);
  await shot(names.overhead);
  await standAt('gate');
  await nearView();
  await shot(names.gate);
  if (names.keep) {
    const stood = await standAt('keep');
    console.log('keep stand', stood);
    await nearView();
    await shot(names.keep);
    const frame = await page.evaluate(() => globalThis.__tb?.stats?.() ?? null);
    console.log(names.map, 'frame', frame);
  }
  return node;
}

try {
  const capital = await shootPlace(3, '?roles=1', (n) => n.cls === 'capital', {
    map: 'c2b-map-capital',
    overhead: 'c2b-3d-capital-overhead',
    gate: 'c2b-3d-capital-gate',
    keep: 'c2b-3d-keep-wall',
  });
  await reachMap(3, '?roles=1&settlementGen=2');
  const gen2 = (await listSettlements()).find((n) => n.id === capital?.id);
  if (gen2) {
    await frame(gen2, 3.6);
    await shot('c2b-map-gen2');
  }
  await reachMap(3, '?roles=1');
  if (capital) {
    await frame(capital, 3.6);
    await shot('c2b-map-gen3');
  }
  await shootPlace(10, '?roles=1', (n) => n.cls === 'metropolis', {
    map: 'c2b-map-metro',
    overhead: 'c2b-3d-metro-overhead',
    gate: 'c2b-3d-metro-gate',
    keep: 'c2b-3d-metro-keep',
  });
  await shootPlace(7741, '?roles=1', (n) => n.cls === 'town' && n.culture === 'human', {
    map: 'c2b-map-town',
    overhead: 'c2b-3d-town-overhead',
    gate: 'c2b-3d-town-gate',
  });
  await shootPlace(7741, '?roles=1&culture=orc', (n) => n.culture === 'orc', {
    map: 'c2b-map-orc',
    overhead: 'c2b-3d-orc-overhead',
    gate: 'c2b-3d-orc-gate',
  });
  console.log('done');
} catch (error) {
  console.error(error);
  await shot('c2b-failure');
  process.exitCode = 1;
} finally {
  await browser.close();
}
