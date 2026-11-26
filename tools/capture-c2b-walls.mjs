/** Close and overhead shots that put the wall in frame. */
import { chromium } from 'playwright';

const base = process.env.TB_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.TB_SHOTS ?? '/opt/cursor/artifacts';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  args: [
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--headless=new',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.error('PAGE', e.message));
page.on('console', (message) => {
  const text = message.text();
  if (text.includes('tb-walls') || message.type() === 'error' || message.type() === 'warning') {
    console.log('CONSOLE', message.type(), text);
  }
});

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}
async function waitMode(mode) {
  await page.waitForFunction(
    (want) => document.querySelector('#app')?.dataset.mode === want,
    mode,
    {
      timeout: 180_000,
    },
  );
}
async function reach(seed, query) {
  await page.goto(`${base}${query}`);
  await waitMode('title');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await waitMode('worldgen');
  const field = page.getByRole('spinbutton', { name: 'Seed' });
  await field.fill(String(seed));
  await field.blur();
  await page.getByRole('button', { name: 'Choose character', exact: true }).click();
  await waitMode('creator', 180_000);
  await page.getByRole('button', { name: 'Take the road', exact: true }).click();
  await waitMode('map', 180_000);
  await page.waitForTimeout(400);
}
async function enter(id) {
  await page.evaluate((placeId) => {
    const world = globalThis.__TRAILBOUND__.world;
    const place = world.data.nodes.find((n) => n.id === placeId);
    const tile = place.tiles[Math.floor(place.tiles.length / 2)];
    world.hero.x = world.caravan.x = tile.x + 0.5;
    world.hero.y = world.caravan.y = tile.y + 0.5;
    world.caravan.route = [];
    globalThis.__TRAILBOUND__.frameAt(place.cx, place.cy, 2.2);
    globalThis.__TRAILBOUND__.enterArea();
  }, id);
  await waitMode('area', 180_000);
  await page.waitForFunction(() => globalThis.__tb?.ready === true, null, { timeout: 180_000 });
  await page.waitForTimeout(400);
  const info = await page.evaluate(() => ({
    walls: window.TBWalls && TBWalls.counts,
    exportMs: globalThis.__tbExportMs,
    stats: globalThis.__tb?.stats?.(),
    name: globalThis.__TRAILBOUND__.pendingArea?.areaExport?.area?.name,
    buildings: globalThis.__TRAILBOUND__.pendingArea?.areaExport?.buildings?.length,
  }));
  console.log('entered', id, JSON.stringify(info));
}
async function frameWall(kind) {
  const info = await page.evaluate((want) => {
    const area = globalThis.__TRAILBOUND__.pendingArea.areaExport;
    const origin = area.area.innerOrigin;
    const buildings = area.buildings || [];
    let cx = 0;
    let cy = 0;
    for (const b of buildings) {
      cx += b.x;
      cy += b.y;
    }
    cx /= buildings.length || 1;
    cy /= buildings.length || 1;
    let maxR = 48;
    for (const seg of area.segments || []) {
      if (seg.kind !== 'wall' && seg.kind !== 'palisade') continue;
      for (const p of seg.points || []) maxR = Math.max(maxR, Math.hypot(p[0] - cx, p[1] - cy));
    }
    if (want === 'overview') {
      globalThis.__tb.place(cx - origin.x, cy - origin.y, 0);
      const dist = Math.max(140, maxR * 1.72);
      globalThis.__tb.widen(dist, 76, 50);
      return { dist, maxR };
    }
    const gates = (area.props || []).filter((p) => p.kit === 'civ_wall_gatehouse_9x6');
    let gate = gates[0];
    if (want === 'keep') {
      const pts = (area.segments || [])
        .filter((s) => String(s.id).startsWith('keep'))
        .flatMap((s) => s.points);
      let best = null;
      let bd = 1e9;
      for (const g of gates) {
        for (const p of pts) {
          const d = Math.hypot(g.x - p[0], g.y - p[1]);
          if (d < bd) {
            bd = d;
            best = g;
          }
        }
      }
      gate = best;
    }
    const ix = cx - gate.x;
    const iy = cy - gate.y;
    const ilen = Math.hypot(ix, iy) || 1;
    const reach = want === 'keep' ? 13 : 12;
    let sx = ix / ilen;
    let sy = iy / ilen;
    let best = 1e9;
    for (const road of (area.roads && area.roads.polylines) || []) {
      if (road.rank !== 1 || !road.points) continue;
      const pts = road.points;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy || 1;
        let t = ((gate.x - a[0]) * dx + (gate.y - a[1]) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const qx = a[0] + dx * t;
        const qy = a[1] + dy * t;
        const d = Math.hypot(qx - gate.x, qy - gate.y);
        if (d < best) {
          best = d;
          const towardB = (b[0] - gate.x) * ix + (b[1] - gate.y) * iy;
          const ux = towardB >= 0 ? dx : -dx;
          const uy = towardB >= 0 ? dy : -dy;
          const ul = Math.hypot(ux, uy) || 1;
          sx = ux / ul;
          sy = uy / ul;
        }
      }
    }
    const standX = gate.x + sx * reach;
    const standY = gate.y + sy * reach;
    globalThis.__tb.place(standX - origin.x, standY - origin.y, 0);
    globalThis.__tb.aim((Math.atan2(sx, sy) * 180) / Math.PI);
    globalThis.__tb.widen(
      want === 'keep' ? 20 : 24,
      want === 'keep' ? 28 : 32,
      want === 'keep' ? 42 : 40,
    );
    return { gate: { x: gate.x, y: gate.y }, maxR };
  }, kind);
  console.log('frame', kind, JSON.stringify(info));
  await page.waitForTimeout(900);
}

try {
  if (process.env.TB_ONLY === 'metro') {
    await reach(10, '?roles=1');
    const metro = await page.evaluate(() => {
      const n = globalThis.__TRAILBOUND__.world.data.nodes.find(
        (node) => node.settlementClass === 'metropolis',
      );
      return n && n.id;
    });
    await enter(metro);
    await frameWall('gate');
    await shot('c2b-3d-metro-gate');
    console.log('done');
  } else {
    if (!process.env.TB_SKIP_TOWN) {
      await reach(7741, '?roles=1');
      const town = await page.evaluate(() => {
        const n = globalThis.__TRAILBOUND__.world.data.nodes.find(
          (node) => node.settlementClass === 'town',
        );
        return n && n.id;
      });
      await enter(town);
      await frameWall('overview');
      await shot('c2b-3d-town-ring');
      await frameWall('gate');
      await shot('c2b-3d-town-gate');
    }

    await reach(3, '?roles=1');
    const capital = await page.evaluate(() => {
      const n = globalThis.__TRAILBOUND__.world.data.nodes.find(
        (node) => node.settlementClass === 'capital',
      );
      return n && n.id;
    });
    await enter(capital);
    if (process.env.TB_ONLY !== 'keep') {
      await frameWall('overview');
      await shot('c2b-3d-capital-overhead');
      await frameWall('gate');
      await shot('c2b-3d-capital-gate');
    }
    await frameWall('keep');
    await shot('c2b-3d-keep-wall');
    const stats = await page.evaluate(() => globalThis.__tb.stats());
    console.log('capital near', JSON.stringify(stats));
    console.log('done');
  }
} catch (error) {
  console.error(error);
  await shot('c2b-failure');
  process.exitCode = 1;
} finally {
  await browser.close();
}
