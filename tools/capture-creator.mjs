import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.TB_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.TB_SHOTS ?? '/opt/cursor/artifacts';
const timeout = 180_000;

await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(timeout);
page.on('pageerror', (error) => {
  console.error('PAGE', error);
});
page.on('console', (message) => {
  const text = message.text();
  if (message.type() === 'error') console.error('CONSOLE', text);
  else if (text.includes('cf') || text.includes('Forge') || text.includes('profile')) {
    console.log('CONSOLE', text);
  }
});

function root() {
  return page.locator('#app');
}

async function settle(previousHash) {
  await page.waitForFunction((previous) => {
    const node = document.querySelector('#app');
    if (!node) return false;
    if (node.dataset.building !== 'false') return false;
    if (node.dataset.avatarSource !== 'forge') return false;
    if (!node.dataset.avatarHash) return false;
    return previous ? node.dataset.avatarHash !== previous : true;
  }, previousHash ?? '');
  await page.waitForTimeout(500);
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'title');
  await page.screenshot({ path: `${out}/creator-title.png` });

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#app')?.dataset.scene === 'CharacterCreator',
  );
  console.log('creator open, waiting for the first forge build');
  await settle();
  const first = {
    race: await root().getAttribute('data-avatar-race'),
    hash: await root().getAttribute('data-avatar-hash'),
    initMs: await root().getAttribute('data-cf-init-ms'),
    buildMs: await root().getAttribute('data-cf-build-ms'),
  };
  console.log('first look', first);
  await page.screenshot({ path: `${out}/creator-human.png` });

  await page.getByLabel('Race', { exact: true }).selectOption('pixie');
  await page.getByLabel('Style', { exact: true }).selectOption('mage');
  await settle(first.hash ?? '');
  console.log(
    'pixie mage',
    await root().getAttribute('data-avatar-race'),
    await root().getAttribute('data-cf-build-ms'),
  );
  await page.screenshot({ path: `${out}/creator-pixie-mage.png` });

  const pixieHash = await root().getAttribute('data-avatar-hash');
  await page.getByLabel('Race', { exact: true }).selectOption('kobold');
  await page.getByLabel('Style', { exact: true }).selectOption('knight');
  await settle(pixieHash ?? '');
  console.log('kobold knight', await root().getAttribute('data-cf-build-ms'));
  await page.screenshot({ path: `${out}/creator-kobold-knight.png` });

  const koboldHash = await root().getAttribute('data-avatar-hash');
  await page.getByLabel('Race', { exact: true }).selectOption('goliath');
  await page.getByLabel('Style', { exact: true }).selectOption('scholar');
  await settle(koboldHash ?? '');
  console.log('goliath scholar', await root().getAttribute('data-cf-build-ms'));
  await page.getByLabel('Name', { exact: true }).fill('Sera');
  await page.screenshot({ path: `${out}/creator-goliath-scholar.png` });

  const chosen = {
    race: await root().getAttribute('data-avatar-race'),
    hash: await root().getAttribute('data-avatar-hash'),
    seed: await root().getAttribute('data-avatar-seed'),
    initMs: await root().getAttribute('data-cf-init-ms'),
    buildMs: await root().getAttribute('data-cf-build-ms'),
  };

  await page.getByRole('button', { name: 'Take the road', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'map');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/creator-to-map.png` });
  if ((await root().getAttribute('data-avatar-name')) !== 'Sera') {
    throw new Error('map did not keep the avatar name');
  }
  if ((await root().getAttribute('data-avatar-hash')) !== chosen.hash) {
    throw new Error('map did not keep the avatar hash');
  }

  await page.reload();
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'title');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'map');
  const restoredRace = await root().getAttribute('data-avatar-race');
  const restoredHash = await root().getAttribute('data-avatar-hash');
  const restoredName = await root().getAttribute('data-avatar-name');
  if (restoredName !== 'Sera' || restoredRace !== chosen.race || restoredHash !== chosen.hash) {
    throw new Error(
      `continue restored ${restoredName} ${restoredRace} ${restoredHash}, wanted Sera ${chosen.race} ${chosen.hash}`,
    );
  }

  const serial = await root().getAttribute('data-build-serial');
  await page.getByRole('button', { name: 'Avatar', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#app')?.dataset.scene === 'CharacterCreator',
  );
  await page.waitForFunction((previous) => {
    const node = document.querySelector('#app');
    return (
      node?.dataset.building === 'false' &&
      node.dataset.avatarSource === 'forge' &&
      node.dataset.buildSerial !== previous
    );
  }, serial ?? '0');
  await page.waitForTimeout(500);
  const again = await root().getAttribute('data-avatar-hash');
  if (again !== chosen.hash)
    throw new Error(`reopened creator hashed ${again}, wanted ${chosen.hash}`);
  await page.screenshot({ path: `${out}/creator-continue.png` });
  console.log('timings', chosen, 'seed', chosen.seed);
  console.log('captured creator looks, the road, and continue');
} finally {
  await browser.close();
}
