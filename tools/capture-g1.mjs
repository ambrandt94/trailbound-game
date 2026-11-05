import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.TB_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.TB_SHOTS ?? '/opt/cursor/artifacts';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (error) => {
  errors.push(String(error));
  console.error('PAGE', error);
});
page.on('console', (message) => {
  if (message.type() === 'error') console.error('CONSOLE', message.text());
});

async function shot(name) {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}

async function frame(kind) {
  const ok = await page.evaluate(
    (scene) => globalThis.__TRAILBOUND__?.frameScene(scene) ?? false,
    kind,
  );
  if (!ok) throw new Error(`could not frame ${kind}`);
  await page.waitForTimeout(kind === 'world' ? 400 : 1600);
}

async function skin(value) {
  await page.locator('select[aria-label="Map skin"]').selectOption(value);
  await page.waitForTimeout(1200);
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'title');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#app')?.dataset.mode === 'map',
    undefined,
    {
      timeout: 60000,
    },
  );
  await page.waitForFunction(
    () => Number(document.querySelector('#app')?.dataset.bakeMs ?? '0') > 0,
    undefined,
    {
      timeout: 60000,
    },
  );
  await page.waitForTimeout(1000);
  const trailBake = await page.locator('#app').getAttribute('data-bake-ms');

  await frame('world');
  await shot('g1-world-trailbound');
  await frame('coast');
  await shot('g1-coast-trailbound');
  await frame('ironmarch');
  await page.waitForFunction(
    () => Number(document.querySelector('#app')?.dataset.chunks ?? '0') > 4,
    undefined,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(600);
  await shot('g1-ironmarch-trailbound');
  const trailFps = await page.locator('#app').getAttribute('data-fps');
  const clock = await page.locator('#app').getAttribute('data-clock');

  await skin('classic');
  const classicBake = await page.locator('#app').getAttribute('data-bake-ms');
  await frame('world');
  await shot('g1-world-classic');
  await frame('coast');
  await shot('g1-coast-classic');
  await frame('ironmarch');
  await page.waitForTimeout(800);
  await shot('g1-ironmarch-classic');
  const classicFps = await page.locator('#app').getAttribute('data-fps');

  await skin('trailbound48');
  await frame('world');
  await page.waitForTimeout(1500);
  const settledFps = await page.locator('#app').getAttribute('data-fps');

  const stats = {
    trailBakeMs: Number(trailBake),
    classicBakeMs: Number(classicBake),
    trailFps: Number(trailFps),
    classicFps: Number(classicFps),
    settledFps: Number(settledFps),
    clock,
    errors,
  };
  writeFileSync(`${out}/g1-stats.json`, JSON.stringify(stats, null, 2));
  console.log(JSON.stringify(stats, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
