/**
 * Map and 3D shots for settlement generation 3.
 * Player view: role overlay off, hover labels on. Orc camps use the culture override.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.TB_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.TB_SHOTS ?? '/opt/cursor/artifacts';
mkdirSync(out, { recursive: true });

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
page.on('pageerror', (error) => console.error('PAGE', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('CONSOLE', message.text());
});

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}

async function waitMode(mode, timeout = 180_000) {
  await page.waitForFunction(
    (want) => document.querySelector('#app')?.dataset.mode === want,
    mode,
    { timeout },
  );
}

async function reachMap(seed) {
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
  await page.waitForFunction(
    () => globalThis.__TRAILBOUND__?.world?.data?.nodes?.length > 0,
    null,
    {
      timeout: 180_000,
    },
  );
  await page.waitForTimeout(600);
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
  await page.waitForTimeout(700);
}

async function hoverLabel() {
  const canvas = page.locator('#map');
  const box = await canvas.boundingBox();
  if (!box) return '';
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let r = 0; r <= 140; r += 12) {
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      await page.mouse.move(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
      await page.waitForTimeout(40);
      const text = await canvas.getAttribute('data-role-hover');
      if (text) return text;
    }
  }
  return '';
}

async function enter3d(node) {
  await frame(node, 2.2);
  await page.evaluate(() => {
    globalThis.__TRAILBOUND__.enterArea();
  });
  await waitMode('area', 180_000);
  await page.waitForFunction(() => globalThis.__tb?.ready === true, null, { timeout: 180_000 });
  await page.evaluate(() => {
    globalThis.__tb?.setView?.(0);
  });
  await page.waitForTimeout(900);
}

async function backToMap() {
  await page.keyboard.press('Escape');
  await waitMode('map', 60_000);
  await page.waitForTimeout(400);
}

try {
  await page.goto(base);
  await reachMap(7741);
  const nodes = await listSettlements();
  console.log('settlements', nodes.length);
  const humanTown =
    pick(
      nodes,
      (n) => n.culture === 'human' && n.cls === 'town' && (n.biome === 6 || n.biome === 1),
    ) ??
    pick(
      nodes,
      (n) =>
        n.culture === 'human' &&
        (n.cls === 'town' || n.cls === 'city') &&
        n.biome !== 2 &&
        n.biome !== 3 &&
        n.biome !== 4 &&
        n.biome !== 5,
    ) ??
    pick(nodes, (n) => n.culture === 'human' && (n.cls === 'town' || n.cls === 'city'));
  let forest = pick(
    nodes,
    (n) =>
      (n.biome === 4 || n.biome === 5) &&
      (n.cls === 'village' || n.cls === 'hamlet' || n.cls === 'town'),
  );
  const grass = pick(
    nodes,
    (n) =>
      (n.biome === 2 || n.biome === 3) &&
      (n.cls === 'village' || n.cls === 'hamlet' || n.cls === 'town'),
  );
  console.log('picks', { humanTown, forest, grass });

  if (humanTown) {
    await frame(humanTown, 3.6);
    await shot('c2-map-human-town');
    const label = await hoverLabel();
    console.log('hover', label);
    await shot('c2-map-hover-label');
    await enter3d(humanTown);
    await shot('c2-3d-human-town');
    await backToMap();
  }
  if (grass) {
    await frame(grass, 3.6);
    await shot('c2-map-yurts');
    await enter3d(grass);
    await shot('c2-3d-yurts');
    await backToMap();
  }
  if (!forest) {
    for (const seed of [64, 8801, 4401, 2207]) {
      await page.goto(base);
      await reachMap(seed);
      const more = await listSettlements();
      forest = pick(
        more,
        (n) =>
          (n.biome === 4 || n.biome === 5) &&
          (n.cls === 'village' || n.cls === 'hamlet' || n.cls === 'town'),
      );
      console.log('forest search', seed, forest?.id ?? 'none');
      if (forest) break;
    }
  }
  if (forest) {
    await frame(forest, 3.6);
    await shot('c2-map-log-cabins');
    await enter3d(forest);
    await shot('c2-3d-log-cabins');
    await backToMap();
  }

  await page.goto(`${base}?culture=orc`);
  await reachMap(7741);
  const orcNodes = await listSettlements();
  const orc =
    pick(orcNodes, (n) => n.culture === 'orc' && (n.cls === 'town' || n.cls === 'village')) ??
    pick(orcNodes, (n) => n.cls === 'town' || n.cls === 'village');
  console.log('orc', orc);
  if (orc) {
    await frame(orc, 3.6);
    await shot('c2-map-orc-camp');
    await enter3d(orc);
    await shot('c2-3d-orc-camp');
  }

  await page.goto(`${base}?settlementGen=2`);
  await reachMap(7741);
  if (humanTown) {
    const gen2 = (await listSettlements()).find((n) => n.id === humanTown.id) ?? humanTown;
    await frame(gen2, 3.6);
    await shot('c2-map-gen2-same-seed');
  }
  await page.goto(`${base}?settlementGen=3`);
  await reachMap(7741);
  if (humanTown) {
    await frame(humanTown, 3.6);
    await shot('c2-map-gen3-same-seed');
  }
  console.log('done');
} catch (error) {
  console.error(error);
  await shot('c2-failure');
  process.exitCode = 1;
} finally {
  await browser.close();
}
