import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.TB_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.TB_SHOTS ?? '/opt/cursor/artifacts';

await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => {
  console.error('PAGE', error);
});
page.on('console', (message) => {
  if (message.type() === 'error') console.error('CONSOLE', message.text());
});

function mode() {
  return page.locator('#app').getAttribute('data-mode');
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'title');
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  if (!(await continueButton.isDisabled())) {
    throw new Error('Continue should start disabled');
  }
  await page.screenshot({ path: `${out}/g0-title.png` });

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const voices = page.getByRole('slider', { name: 'Voices' });
  const voicesValue = await voices.inputValue();
  if (voicesValue !== '40') throw new Error(`Voices slider was ${voicesValue}, expected 40`);
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'map');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/g0-map.png` });

  await page.keyboard.down('KeyD');
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.nearTown === 'true');
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const fade = Number(document.querySelector('#app')?.dataset.fade ?? '0');
    return fade > 0.4 && fade < 0.9;
  });
  await page.screenshot({ path: `${out}/g0-fade.png` });

  await page.waitForFunction(() => {
    const root = document.querySelector('#app');
    return root?.dataset.mode === 'area' && Number(root.dataset.fade ?? '1') < 0.05;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/g0-area.png` });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => {
    const root = document.querySelector('#app');
    return root?.dataset.mode === 'map' && Number(root.dataset.fade ?? '1') < 0.05;
  });
  const heroY = Number(await page.locator('#app').getAttribute('data-hero-y'));
  const heroX = Number(await page.locator('#app').getAttribute('data-hero-x'));
  if (!(heroY < 8 - 1.5))
    throw new Error(`hero did not land outside the town (${heroX}, ${heroY})`);

  const beforeSave = Number((await page.locator('#app').getAttribute('data-save-count')) ?? '0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(
    (previous) => Number(document.querySelector('#app')?.dataset.saveCount ?? '0') > previous,
    beforeSave,
  );

  await page.reload();
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'title');
  if (await continueButton.isDisabled()) throw new Error('Continue stayed disabled after save');
  await continueButton.click();
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'map');
  const restoredY = Number(await page.locator('#app').getAttribute('data-hero-y'));
  const restoredX = Number(await page.locator('#app').getAttribute('data-hero-x'));
  if (Math.abs(restoredX - heroX) > 0.05 || Math.abs(restoredY - heroY) > 0.05) {
    throw new Error(`continue restored ${restoredX},${restoredY} instead of ${heroX},${heroY}`);
  }
  console.log(`captured title, map, fade, area; continue restored ${restoredX}, ${restoredY}`);
  console.log('title mode', await mode());
} finally {
  await browser.close();
}
