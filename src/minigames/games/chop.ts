import { CylinderGeometry, Mesh, MeshLambertMaterial, type Object3D, type Scene } from 'three';
import { rnd2 } from '../helpers/runtime';
import type { MinigameContext, MinigameDef } from '../types';

export const CHOP_COINS = 3;

interface Bit {
  mesh: Mesh;
  v: [number, number, number];
}

interface ChopState {
  n: number;
  miss: number;
  u: number;
  dir: number;
  sp: number;
  zw: number;
  zc: number;
  bits: Bit[];
  log: Mesh | null;
  props: Object3D[];
  cv: HTMLCanvasElement | null;
  over: boolean;
}

function blank(): ChopState {
  return {
    n: 0,
    miss: 0,
    u: 0,
    dir: 1,
    sp: 0.9,
    zw: 0.26,
    zc: 0.5,
    bits: [],
    log: null,
    props: [],
    cv: null,
    over: false,
  };
}

let state = blank();

/** Three clean hits split the log. Three misses and the log wins. Coins: 3. */
export const chopGame: MinigameDef = {
  id: 'chop',
  name: 'Woodchop',
  type: 'world',
  start(g) {
    state = blank();
    state.zc = rnd2(0.25, 0.75);
    const pose = g.pose ?? { x: 0, y: 0, z: 0, yaw: 0 };
    const x = pose.x + Math.sin(pose.yaw) * 1.6;
    const z = pose.z + Math.cos(pose.yaw) * 1.6;
    if (g.worldScene && typeof document !== 'undefined') buildBlock(g.worldScene, x, z);
    if (g.hud) {
      g.hud.innerHTML =
        'Press <b>Space / F</b> when the needle is in the green · 3 clean hits split the log';
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = 120;
        canvas.height = 14;
        canvas.className = 'px';
        g.hud.append(canvas);
        state.cv = canvas;
      }
    }
    g.over = false;
  },
  update(g, dt) {
    if (!g.over && !state.over) {
      state.u += state.dir * state.sp * dt;
      if (state.u > 1) {
        state.u = 1;
        state.dir = -1;
      }
      if (state.u < 0) {
        state.u = 0;
        state.dir = 1;
      }
      if (g.act) strike(g);
    }
    for (const bit of state.bits) {
      bit.v[1] -= 14 * dt;
      bit.mesh.position.x += bit.v[0] * dt;
      bit.mesh.position.y = Math.max(0.03, bit.mesh.position.y + bit.v[1] * dt);
      bit.mesh.position.z += bit.v[2] * dt;
      bit.mesh.rotation.x += dt * 8;
      if (bit.mesh.position.y <= 0.03) bit.v[0] = bit.v[2] = 0;
    }
    paint();
  },
  end() {
    for (const bit of state.bits) bit.mesh.parent?.remove(bit.mesh);
    for (const prop of state.props) prop.parent?.remove(prop);
    state.cv?.remove();
  },
  status() {
    return {
      hot: Math.abs(state.u - state.zc) <= state.zw / 2 && !state.over,
      hits: state.n,
      beat: state.miss,
      detail: `${state.n}/3`,
    };
  },
};

function strike(g: MinigameContext): void {
  if (Math.abs(state.u - state.zc) <= state.zw / 2) {
    state.n += 1;
    if (state.log) {
      state.log.scale.y = 1 - state.n / 3.4;
      state.log.position.y = 0.5 + 0.35 * state.log.scale.y;
    }
    const origin = state.log?.position ?? { x: 0, y: 0.9, z: 0 };
    for (let i = 0; i < 5; i++) {
      if (!state.log?.parent) break;
      const chip = new Mesh(new CylinderGeometry(0.06, 0.06, 0.08, 4), state.log.material);
      chip.position.set(origin.x, 0.9, origin.z);
      state.log.parent.add(chip);
      state.bits.push({ mesh: chip, v: [rnd2(-2, 2), rnd2(2.5, 4), rnd2(-2, 2)] });
    }
    state.sp *= 1.3;
    state.zw *= 0.8;
    state.zc = rnd2(0.2, 0.8);
    if (state.n >= 3) {
      state.over = true;
      g.done({ ok: true, message: 'Split the log!', coins: CHOP_COINS });
    }
  } else {
    state.miss += 1;
    if (g.hud) g.hud.innerHTML = `Miss! (${state.miss}/3)`;
    if (state.miss >= 3) {
      state.over = true;
      g.done({ ok: false, message: 'The log wins this time.', coins: 0 });
    }
  }
}

function paint(): void {
  const canvas = state.cv;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#2a1c1c';
  ctx.fillRect(0, 0, 120, 14);
  ctx.fillStyle = '#6a5a48';
  ctx.fillRect(2, 4, 116, 6);
  ctx.fillStyle = '#7fd65f';
  ctx.fillRect(2 + 116 * (state.zc - state.zw / 2), 3, 116 * state.zw, 8);
  ctx.fillStyle = '#fffdf2';
  ctx.fillRect(1 + 116 * state.u, 0, 3, 14);
}

function buildBlock(scene: Scene, x: number, z: number): void {
  const stump = new Mesh(
    new CylinderGeometry(0.45, 0.5, 0.5, 8),
    new MeshLambertMaterial({ color: '#8a5a2b' }),
  );
  stump.position.set(x, 0.25, z);
  const log = new Mesh(
    new CylinderGeometry(0.28, 0.28, 0.7, 8),
    new MeshLambertMaterial({ color: '#b08850' }),
  );
  log.rotation.z = Math.PI / 2;
  log.position.set(x, 0.85, z);
  scene.add(stump, log);
  state.log = log;
  state.props.push(stump, log);
}
