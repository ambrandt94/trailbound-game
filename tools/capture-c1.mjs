/**
 * World Gen screenshots for settlement generation 2.
 * Regions map at 0.25 / 0.6 / 1.6 / 3.6, one generation-1 frame, and the city-plan overlay.
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
page.on('pageerror', (error) => console.error('PAGE', error));
page.on('console', (message) => {
  if (message.type() === 'error') console.error('CONSOLE', message.text());
});

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}

async function openWorldGen() {
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'title');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'worldgen');
  const seed = page.getByRole('spinbutton', { name: 'Seed' });
  await seed.waitFor();
  const value = await seed.inputValue();
  if (value !== '7741') {
    await seed.fill('7741');
    await seed.blur();
  }
  // The planet bake and the start chunk are ready when the Regions hook exists
  // and the view has a frame. Chunk detail fills in after the zoom.
  await page.waitForFunction(() => globalThis.__tbRegions?.state, null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
}

async function openChunk(name, focus) {
  await page.getByRole('button', { name: 'Chunk', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.wg-modes')?.getAttribute('data-pending') === 'no',
    null,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(1200);
  await shot(name);
  const canvas = page.locator('canvas.wg-chunk');
  const box = await canvas.boundingBox();
  if (!box) return;
  const sx = box.x + box.width * focus.x;
  const sy = box.y + box.height * focus.y;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -420);
  await page.waitForTimeout(400);
  await shot(`${name}-close`);
}

async function regionsAt(zoom) {
  await page.getByRole('button', { name: 'Regions', exact: true }).click();
  await page.waitForTimeout(400);
  await page.evaluate((mul) => {
    globalThis.__tbRegions?.setZoom(mul);
  }, zoom);
  await page.waitForTimeout(1800);
}

try {
  await page.goto(base);
  await openWorldGen();
  for (const zoom of [0.25, 0.6, 1.6, 3.6]) {
    await regionsAt(zoom);
    const tag = String(zoom).replace('.', '_');
    await shot(`c1-regions-gen2-z${tag}`);
  }
  await page.getByRole('checkbox', { name: 'City plans' }).check();
  await page.waitForTimeout(300);
  await shot('c1-city-plans-overlay');
  await page.getByRole('checkbox', { name: 'City plans' }).uncheck();

  await openChunk('c1-chunk-gen2', { x: 0.82, y: 0.46 });

  await page.goto(`${base}?settlementGen=1`);
  await openWorldGen();
  await regionsAt(1.6);
  await shot('c1-regions-gen1-z1_6');
  await openChunk('c1-chunk-gen1', { x: 0.18, y: 0.16 });

  console.log('done');
} catch (error) {
  console.error(error);
  await shot('c1-failure');
  process.exitCode = 1;
} finally {
  await browser.close();
}
