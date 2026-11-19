/**
 * Headless walk through the soundtrack contexts, logging the selected track and
 * the crossfade gains over time. Not part of `check` (it needs a browser).
 *
 *   npm run dev            # or any dev server
 *   TB_URL=http://127.0.0.1:5173/ TB_OUT=/tmp/music node tools/capture-music.mjs
 *
 * The viewport is small on purpose: in software rendering a full-size map frame can take
 * seconds, which stalls the page and the log. Uses the real game for the title and the map, then pins contexts with the
 * `__tbMusic.force` debug hook. Writes music-walk.log and music-walk.json to TB_OUT.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.TB_URL ?? 'http://127.0.0.1:5173/';
const out = process.env.TB_OUT ?? '/tmp/music-walk';
const MIN_TRACK = Number(process.env.TB_MIN_TRACK ?? 8);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const browserContext = await browser.newContext({ viewport: { width: 480, height: 270 } });

// World generation after "Take the road" is slow in software rendering, so make a save first
// and let the logged run press Continue instead.
{
  const setup = await browserContext.newPage();
  await setup.goto(base);
  await setup.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'title');
  await setup.getByRole('button', { name: 'New', exact: true }).click();
  await setup.waitForTimeout(12000);
  await setup.getByRole('button', { name: 'Take the road', exact: true }).click();
  await setup.waitForTimeout(4000);
  await setup.close();
}
const page = await browserContext.newPage();
page.on('pageerror', (error) => console.error('PAGE', error));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE', m.text());
});

const lines = [];
const samples = [];
const say = (text) => {
  lines.push(text);
  console.log(text);
};

const snap = () =>
  page.evaluate(() => {
    const m = globalThis.__tbMusic.get();
    return {
      t: performance.now() / 1000,
      audioTime: m.audioTime,
      track: m.track,
      cls: m.sceneClass,
      pending: m.pending
        ? Math.round((performance.now() / 1000 - m.pending.since) * 100) / 100
        : null,
      levels: m.levels,
      out: m.outputLevel,
      unlocked: m.unlocked,
    };
  });

let t0 = null;
async function stage(name, patch, seconds) {
  say(`\n=== ${name} ${patch ? JSON.stringify(patch) : '(game decides)'} ===`);
  await page.evaluate((p) => globalThis.__tbMusic.force(p), patch);
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    const s = await snap();
    t0 ??= s.t;
    s.stage = name;
    samples.push(s);
    const lv = s.levels
      .map((l) => `${l.id}=${l.gain.toFixed(3)}${l.fading ? '~' : ''}(node ${l.node.toFixed(3)})`)
      .join('  ');
    say(
      `t=${(s.t - t0).toFixed(2).padStart(6)}  class=${String(s.cls).padEnd(8)} track=${String(s.track).padEnd(26)} pending=${String(s.pending ?? '-').padEnd(5)} ${lv}`,
    );
    await page.waitForTimeout(250);
  }
}

try {
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'title');
  await page.waitForFunction(() => globalThis.__tbMusic?.get().problems.length === 0);
  await page.evaluate((min) => globalThis.__tbMusic.setTiming({ minTrackSec: min }), MIN_TRACK);
  say(
    `harness: minTrackSec=${MIN_TRACK}, other timings are the shipped defaults (hold 4 s, class hold 1.5 s, crossfade 2.5 s)`,
  );

  // Before any gesture: a track is chosen but the player is still locked.
  await page.waitForTimeout(600);
  const pre = await snap();
  say(
    `before the first gesture: unlocked=${pre.unlocked} chosenTrack=${pre.track} voices=${pre.levels.length}`,
  );

  await page.mouse.click(640, 360); // the first user gesture unlocks audio
  await page.waitForFunction(() => globalThis.__tbMusic.get().unlocked);
  say('first gesture: audio unlocked');
  await stage('1 title (fade in from silence after unlock)', null, 4);

  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.mode === 'map', null, {
    timeout: 90000,
  });
  await stage('2 map: real game context', null, 6);
  const real = await page.evaluate(() => globalThis.__tbMusic.get().context);
  say(`   real map context: ${JSON.stringify(real)}`);

  await stage('3 map, day, plains (pinned)', { scene: 'map', biome: 2 }, 6);
  await stage('4 zoom into forest, 3D day', { scene: 'area', biome: 4 }, 7);
  await stage(
    '5 biome flicker: desert for 2.0 s (below the 4 s hold)',
    { scene: 'area', biome: 12 },
    2,
  );
  await stage('6 ...back to forest: no switch', { scene: 'area', biome: 4 }, 3);
  await stage('7 desert holds (switch after 4 s hold)', { scene: 'area', biome: 12 }, 9);
  await stage('8 enter a town (class change)', { scene: 'area', biome: 12, place: 'town' }, 7);
  await stage(
    '9 leave town at night (class change, travel-night)',
    { scene: 'area', biome: 2, night: true },
    7,
  );
  await stage(
    '10 minigame opens (class change)',
    { scene: 'area', biome: 2, night: true, minigame: true },
    7,
  );
  await stage('11 camp (caravan halted)', { scene: 'area', biome: 4, camp: true }, 7);
  await stage('12 back to the real game', null, 5);
} finally {
  await writeFile(`${out}/music-walk.log`, `${lines.join('\n')}\n`);
  await writeFile(`${out}/music-walk.json`, JSON.stringify(samples));
  const decisions = await page.evaluate(() => globalThis.__tbMusic.log()).catch(() => []);
  await writeFile(`${out}/music-decisions.json`, JSON.stringify(decisions, null, 2));
  await browser.close();
}
