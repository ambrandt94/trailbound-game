import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { expect, test } from 'vitest';
import { createServer } from 'vite';

const ARTIFACTS = '/opt/cursor/artifacts';
const PORT = 5173;
const BASE = `http://127.0.0.1:${PORT}/`;

/** Headless Chrome. Absent on runners that do not ship a browser, so the test skips. */
const chromeBin = chromeExecutable();

/**
 * The adopted Character Forge body is one mesh shared by the creator, the town,
 * and instance minigames. Leaving a 3D area disposes that visit's renderer.
 */
test.skipIf(chromeBin === undefined)(
  'the player mesh survives map round trips and Slime Arena',
  async () => {
    if (chromeBin === undefined) return;
    const server = await ensureServer();
    const browser = await chromium.launch({
      executablePath: chromeBin,
      args: [
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--headless=new',
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await page.goto(BASE);
      await waitMode(page, 'title');
      await page.getByRole('button', { name: 'New', exact: true }).click();
      await waitMode(page, 'creator', 'forge');
      await page.getByRole('button', { name: 'Take the road', exact: true }).click();
      await waitMode(page, 'map');
      await walkUntilEnterEnabled(page);

      for (let trip = 1; trip <= 5; trip += 1) {
        if (trip % 2 === 1) await page.getByRole('button', { name: 'Enter', exact: true }).click();
        else await page.keyboard.press('Enter');
        await waitMode(page, 'area');
        await page.waitForFunction(
          () => (globalThis as { __tb?: { ready?: boolean } }).__tb?.ready === true,
        );
        const report = await inspectPlayer(page);
        assertPlayer(report, `trip ${trip}`);
        if (trip === 5) {
          await frameClose(page);
          await page.screenshot({ path: `${ARTIFACTS}/player-after-fifth-entry.png` });
          await restoreHud(page);
        }
        await page.keyboard.press('Escape');
        await waitMode(page, 'map');
        if (trip < 5) await walkUntilEnterEnabled(page);
      }

      await walkUntilEnterEnabled(page);
      await page.getByRole('button', { name: 'Enter', exact: true }).click();
      await waitMode(page, 'area');
      await page.waitForFunction(
        () => (globalThis as { __tb?: { ready?: boolean } }).__tb?.ready === true,
      );
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Slime Arena', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector('#app')?.getAttribute('data-minigame-phase') === 'play',
      );
      await page.locator('#mg .mg-quit').click();
      try {
        await page.waitForFunction(() => {
          const root = document.querySelector('#app');
          return (
            root instanceof HTMLElement &&
            root.getAttribute('data-minigame') === '' &&
            root.dataset.mode === 'area'
          );
        });
      } catch (error) {
        const state = await page.evaluate(() => {
          const root = document.querySelector('#app');
          return root instanceof HTMLElement ? { ...root.dataset } : {};
        });
        throw new Error(`Slime Arena did not return (${JSON.stringify(state)})`, { cause: error });
      }
      const afterArena = await inspectPlayer(page);
      assertPlayer(afterArena, 'after Slime Arena');
      await frameClose(page);
      await page.screenshot({ path: `${ARTIFACTS}/player-after-slime-arena.png` });
      await restoreHud(page);
      expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    } finally {
      await browser.close();
      await server.stop();
    }
  },
  240_000,
);

interface PlayerReport {
  inScene: boolean;
  visible: boolean;
  draws: boolean;
  skinned: boolean;
  mixerMoved: boolean;
  inFrustum: boolean;
  scale: number;
  bytes: number;
  indexBytes: number;
  mapWidth: number;
  pixelDelta: number;
  verts: number;
}

function assertPlayer(report: PlayerReport, label: string): void {
  expect(report, `${label} ${JSON.stringify(report)}`).toMatchObject({
    inScene: true,
    visible: true,
    draws: true,
    skinned: true,
    mixerMoved: true,
    inFrustum: true,
  });
  expect(report.scale, `${label} scale`).toBeGreaterThan(0.2);
  expect(report.bytes, `${label} geometry`).toBeGreaterThan(1000);
  expect(report.indexBytes, `${label} index`).toBeGreaterThan(1000);
  expect(report.mapWidth, `${label} atlas`).toBeGreaterThan(32);
  expect(report.pixelDelta, `${label} pixels`).toBeGreaterThan(200);
}

async function inspectPlayer(page: Page): Promise<PlayerReport> {
  return page.evaluate(async () => {
    type Bone = {
      name: string;
      position: { x: number; y: number; z: number };
      quaternion: { x: number; y: number; z: number; w: number };
    };
    type Node = {
      visible?: boolean;
      parent?: Node | null;
      scale?: { x: number };
      isSkinnedMesh?: boolean;
      isMesh?: boolean;
      skeleton?: { bones: Bone[] };
      geometry?: {
        boundingSphere?: {
          clone: () => { applyMatrix4: (matrix: unknown) => unknown };
        } | null;
        attributes?: { position?: { count?: number; array?: { byteLength: number } } };
        index?: { array?: { byteLength: number } } | null;
      };
      material?:
        | { map?: { image?: { width?: number } } | null }
        | { map?: { image?: { width?: number } } | null }[];
      matrixWorld?: unknown;
      updateWorldMatrix?: (parents: boolean, children: boolean) => void;
      getObjectByName?: (name: string) => Node | null;
    };
    const host = globalThis as {
      __tb?: {
        session?: { worldView?: () => { scene: Node }; frame?: () => void };
        player?: () => { x: number; y: number; z: number };
        project?: (x: number, y: number, z: number) => { x: number; y: number; z: number };
        setView?: (index: number) => void;
        place?: (x: number, z: number, yaw?: number) => void;
      };
      TBArea?: {
        spawn?: () => { x: number; z: number; yaw?: number };
        walkClamp?: (x: number, z: number) => { x: number; z: number };
        groundName?: (x: number, z: number) => string;
      };
      TBInteriors?: { contains?: (x: number, z: number) => boolean };
      TBRenderer?: {
        setRenderTarget: (target: null) => void;
        render: (scene: unknown, camera: unknown) => void;
        domElement: HTMLCanvasElement;
      };
    };
    const tb = host.__tb;
    const here = tb?.player?.() ?? host.TBArea?.spawn?.() ?? { x: 0, y: 0, z: 0 };
    const clear = (x: number, z: number) => {
      const clamped = host.TBArea?.walkClamp?.(x, z) ?? { x, z };
      if (Math.hypot(clamped.x - x, clamped.z - z) > 0.6) return false;
      if (host.TBInteriors?.contains?.(x, z)) return false;
      return host.TBArea?.groundName?.(x, z) === 'grass';
    };
    let spot = { x: here.x, z: here.z };
    for (let radius = 0; radius <= 48; radius += 4) {
      let picked = false;
      for (let step = 0; step < 16; step += 1) {
        const angle = (step / 16) * Math.PI * 2;
        const x = here.x + Math.cos(angle) * radius;
        const z = here.z + Math.sin(angle) * radius;
        if (!clear(x, z)) continue;
        let open = true;
        for (let around = 0; around < 8; around += 1) {
          const theta = (around / 8) * Math.PI * 2;
          if (!clear(x + Math.cos(theta) * 6, z + Math.sin(theta) * 6)) open = false;
        }
        if (!open) continue;
        spot = { x, z };
        picked = true;
        break;
      }
      if (picked) break;
    }
    tb?.place?.(spot.x, spot.z, 0.4);
    tb?.setView?.(7);
    tb?.session?.frame?.();
    const scene = tb?.session?.worldView?.().scene;
    const avatar = scene?.getObjectByName?.('CF_avatar') ?? null;
    const body = scene?.getObjectByName?.('CF_body') ?? null;
    const bones = body?.skeleton?.bones ?? [];
    let inScene = false;
    for (let parent: Node | null | undefined = avatar; parent; parent = parent.parent) {
      if (parent === scene) inScene = true;
    }
    const position = body?.geometry?.attributes?.position;
    const material = Array.isArray(body?.material) ? body?.material[0] : body?.material;
    const renderer = host.TBRenderer;
    const canvas = renderer?.domElement;
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const player = tb?.player?.();
    let pixelDelta = 0;
    let inFrustum = false;
    if (scene && avatar && body && player && renderer && gl && canvas) {
      const loadThree = new Function(
        'return import("/node_modules/.vite/deps/three.js")',
      ) as () => Promise<typeof import('three')>;
      const THREE = await loadThree();
      const camera = new THREE.PerspectiveCamera(
        42,
        canvas.width / Math.max(1, canvas.height),
        0.1,
        80,
      );
      camera.position.set(player.x + 1.6, player.y + 1.7, player.z + 2.4);
      camera.lookAt(player.x, player.y + 0.9, player.z);
      camera.updateMatrixWorld(true);
      body.updateWorldMatrix?.(true, false);
      const local = body.geometry?.boundingSphere?.clone();
      if (local && body.matrixWorld) {
        const world = local.applyMatrix4(body.matrixWorld);
        const frustum = new THREE.Frustum();
        frustum.setFromProjectionMatrix(
          new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        );
        inFrustum = frustum.intersectsSphere(world as import('three').Sphere);
      }
      for (let i = 0; i < 8; i += 1) tb?.session?.frame?.();
      const readCenter = () => {
        tb?.session?.frame?.();
        const pawn = tb?.player?.();
        const pt = pawn ? tb?.project?.(pawn.x, pawn.y + 1.05, pawn.z) : undefined;
        const rect = canvas.getBoundingClientRect();
        const size = 72;
        const cx = pt ? (pt.x / Math.max(1, rect.width)) * canvas.width : canvas.width / 2;
        const cy = pt ? (1 - pt.y / Math.max(1, rect.height)) * canvas.height : canvas.height / 2;
        const x = Math.min(canvas.width - size, Math.max(0, Math.floor(cx - size / 2)));
        const y = Math.min(canvas.height - size, Math.max(0, Math.floor(cy - size / 2)));
        const pixels = new Uint8Array(size * size * 4);
        gl.readPixels(x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 1) sum += pixels[i] ?? 0;
        return sum;
      };
      avatar.visible = true;
      if (body) body.visible = true;
      const shown = readCenter();
      avatar.visible = false;
      if (body) body.visible = false;
      const hidden = readCenter();
      avatar.visible = true;
      if (body) body.visible = true;
      pixelDelta = Math.abs(shown - hidden);
    }
    const sample = () =>
      bones.flatMap((bone) => [
        bone.position.x,
        bone.position.y,
        bone.quaternion.x,
        bone.quaternion.y,
        bone.quaternion.z,
        bone.quaternion.w,
      ]);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    const before = sample();
    const started = performance.now();
    while (performance.now() - started < 400) {
      tb?.session?.frame?.();
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    const after = sample();
    let mixerMoved = false;
    for (let i = 0; i < before.length; i += 1) {
      if (Math.abs((before[i] ?? 0) - (after[i] ?? 0)) > 1e-3) mixerMoved = true;
    }
    return {
      inScene,
      visible: avatar?.visible === true && body?.visible === true,
      draws: pixelDelta > 200,
      skinned: body?.isSkinnedMesh === true && bones.length > 4,
      mixerMoved,
      inFrustum,
      scale: avatar?.scale?.x ?? 0,
      bytes: position?.array?.byteLength ?? 0,
      indexBytes: body?.geometry?.index?.array?.byteLength ?? 0,
      mapWidth: material?.map?.image?.width ?? 0,
      pixelDelta,
      verts: position?.count ?? 0,
    };
  });
}

async function frameClose(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const host = globalThis as {
      __tb?: {
        player?: () => { x: number; z: number };
        place?: (x: number, z: number, yaw?: number) => void;
        setView?: (index: number) => void;
        session?: { frame?: () => void };
      };
      TBArea?: {
        walkClamp?: (x: number, z: number) => { x: number; z: number };
        groundName?: (x: number, z: number) => string;
      };
      TBInteriors?: { contains?: (x: number, z: number) => boolean };
    };
    const tb = host.__tb;
    const here = tb?.player?.() ?? { x: 0, z: 0 };
    const clear = (x: number, z: number) => {
      const clamped = host.TBArea?.walkClamp?.(x, z) ?? { x, z };
      if (Math.hypot(clamped.x - x, clamped.z - z) > 0.6) return false;
      if (host.TBInteriors?.contains?.(x, z)) return false;
      return host.TBArea?.groundName?.(x, z) === 'grass';
    };
    const roomy = (x: number, z: number) => {
      if (!clear(x, z)) return false;
      for (let step = 0; step < 8; step += 1) {
        const angle = (step / 8) * Math.PI * 2;
        if (!clear(x + Math.cos(angle) * 7, z + Math.sin(angle) * 7)) return false;
      }
      return true;
    };
    let spot = { x: here.x, z: here.z };
    let found = false;
    for (let radius = 0; radius <= 48 && !found; radius += 4) {
      for (let step = 0; step < 16; step += 1) {
        const angle = (step / 16) * Math.PI * 2;
        const x = here.x + Math.cos(angle) * radius;
        const z = here.z + Math.sin(angle) * radius;
        if (!roomy(x, z)) continue;
        spot = { x, z };
        found = true;
        break;
      }
    }
    tb?.place?.(spot.x, spot.z, 0.6);
    tb?.setView?.(7);
    for (let i = 0; i < 10; i += 1) {
      tb?.session?.frame?.();
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const ui = document.querySelector('#ui');
    if (ui instanceof HTMLElement) ui.style.visibility = 'hidden';
  });
  await page.waitForTimeout(150);
}

async function restoreHud(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ui = document.querySelector('#ui');
    if (ui instanceof HTMLElement) ui.style.visibility = '';
  });
}

async function walkUntilEnterEnabled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector('#app');
    return (
      root instanceof HTMLElement &&
      root.dataset.mode === 'map' &&
      Number(root.dataset.fade ?? '1') < 0.05
    );
  });
  await page.waitForTimeout(650);
  const ready = async () =>
    page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent?.trim() === 'Enter',
      );
      return button instanceof HTMLButtonElement && !button.disabled;
    });
  if (await ready()) return;
  for (const key of ['KeyD', 'KeyA', 'KeyW', 'KeyS']) {
    await page.keyboard.down(key);
    const found = await page
      .waitForFunction(
        () => {
          const button = [...document.querySelectorAll('button')].find(
            (item) => item.textContent?.trim() === 'Enter',
          );
          return button instanceof HTMLButtonElement && !button.disabled;
        },
        undefined,
        { timeout: 6000 },
      )
      .then(() => true)
      .catch(() => false);
    await page.keyboard.up(key);
    if (found) return;
  }
  throw new Error('Enter stayed disabled; the hero never reached a place');
}

async function waitMode(page: Page, mode: string, extra = ''): Promise<void> {
  await page.waitForFunction(
    ({ mode, extra }) => {
      const root = document.querySelector('#app');
      if (!(root instanceof HTMLElement) || root.dataset.mode !== mode) return false;
      if (Number(root.dataset.fade ?? '1') > 0.05) return false;
      if (extra === 'forge') {
        return (
          root.dataset.avatarSource === 'forge' && (root.dataset.avatarHash?.length ?? 0) === 16
        );
      }
      return true;
    },
    { mode, extra },
    { timeout: 90_000 },
  );
}

function chromeExecutable(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const candidates =
    process.platform === 'win32'
      ? [
          `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
          `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((path) => path.length > 0 && existsSync(path));
}

async function ensureServer(): Promise<{ stop: () => Promise<void> }> {
  await mkdir(ARTIFACTS, { recursive: true });
  if (await serverUp()) return { stop: async () => undefined };
  const server = await createServer({
    mode: 'development',
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  });
  await server.listen();
  if (!(await serverUp())) {
    await server.close();
    throw new Error('vite did not start');
  }
  return {
    stop: async () => {
      await server.close();
    },
  };
}

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}
