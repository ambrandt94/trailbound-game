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

async function buildSerial() {
  return (await root().getAttribute('data-build-serial')) ?? '0';
}

async function settle(previousSerial) {
  await page.waitForFunction((previous) => {
    const node = document.querySelector('#app');
    if (!node) return false;
    if (node.dataset.building !== 'false') return false;
    if (node.dataset.avatarSource !== 'forge') return false;
    if (!node.dataset.avatarHash) return false;
    return node.dataset.buildSerial !== previous;
  }, previousSerial ?? '0');
  await page.waitForTimeout(400);
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
  await settle('0');
  const first = {
    race: await root().getAttribute('data-avatar-race'),
    hash: await root().getAttribute('data-avatar-hash'),
    initMs: await root().getAttribute('data-cf-init-ms'),
    buildMs: await root().getAttribute('data-cf-build-ms'),
  };
  console.log('first look', first);
  await page.screenshot({ path: `${out}/creator-human-before.png` });
  const skin = page.getByRole('listbox', { name: 'Skin' }).getByRole('button');
  const skinCount = await skin.count();
  if (skinCount < 2) throw new Error('expected more than one skin swatch');
  const beforeSkin = await buildSerial();
  await skin.nth(1).click();
  await settle(beforeSkin);
  console.log('human edited', await root().getAttribute('data-cf-build-ms'));
  await page.screenshot({ path: `${out}/creator-human-after.png` });

  const beforePixie = await buildSerial();
  await page.getByLabel('Race', { exact: true }).selectOption('pixie');
  await settle(beforePixie);
  console.log('pixie before', await root().getAttribute('data-cf-build-ms'));
  await page.screenshot({ path: `${out}/creator-pixie-before.png` });
  const hair = page.getByLabel('Hair style', { exact: true });
  const hairValue = await hair.inputValue();
  const hairOptions = await hair.locator('option').all();
  let nextHair = '';
  for (const option of hairOptions) {
    const value = await option.getAttribute('value');
    if (value && value !== hairValue) {
      nextHair = value;
      break;
    }
  }
  if (!nextHair) throw new Error('pixie has no alternate hair style');
  const beforeHair = await buildSerial();
  await hair.selectOption(nextHair);
  await settle(beforeHair);
  console.log('pixie hair', nextHair, await root().getAttribute('data-cf-build-ms'));
  await page.screenshot({ path: `${out}/creator-pixie-after.png` });

  const beforeGoliath = await buildSerial();
  await page.getByLabel('Race', { exact: true }).selectOption('goliath');
  await settle(beforeGoliath);
  console.log('goliath before', await root().getAttribute('data-cf-build-ms'));
  await page.screenshot({ path: `${out}/creator-goliath-before.png` });
  const beforeEyes = await buildSerial();
  const eyes = page.getByRole('listbox', { name: 'Eyes' }).getByRole('button');
  const eyeCount = await eyes.count();
  let pickedEye = false;
  for (let index = 0; index < eyeCount; index += 1) {
    const pressed = await eyes.nth(index).getAttribute('aria-pressed');
    if (pressed === 'true') continue;
    await eyes.nth(index).click();
    pickedEye = true;
    break;
  }
  if (!pickedEye) throw new Error('goliath has no other eye colour');
  await settle(beforeEyes);
  await page.getByLabel('Name', { exact: true }).fill('Sera');
  console.log('goliath edited', await root().getAttribute('data-cf-build-ms'));
  await page.screenshot({ path: `${out}/creator-goliath-after.png` });

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

  const previousSerial = await root().getAttribute('data-build-serial');
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
  }, previousSerial ?? '0');
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
