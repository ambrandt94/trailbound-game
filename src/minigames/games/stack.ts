import { Color, Mesh, MeshLambertMaterial } from 'three';
import { box, lit } from '../helpers/runtime';
import type { MinigameContext, MinigameDef } from '../types';

interface Falling {
  mesh: Mesh;
  v: number;
}

interface Current {
  mesh: Mesh;
  axis: 0 | 1;
  u: number;
  sp: number;
  x: number;
  z: number;
  w: number;
  d: number;
}

interface StackState {
  top: { x: number; z: number; w: number; d: number };
  height: number;
  count: number;
  falling: Falling[];
  current: Current | null;
  orbit: number;
  look: number;
}

let state: StackState = {
  top: { x: 0, z: 0, w: 3, d: 3 },
  height: 0,
  count: 0,
  falling: [],
  current: null,
  orbit: 0,
  look: 0,
};

/** Classic overhang stacker. Coins are one per three blocks that stayed. */
export const stackGame: MinigameDef = {
  id: 'stack',
  name: 'Tower Stack',
  type: 'pop3d',
  size: 'part',
  start(g) {
    state = {
      top: { x: 0, z: 0, w: 3, d: 3 },
      height: 0,
      count: 0,
      falling: [],
      current: null,
      orbit: 0.8,
      look: 0,
    };
    const scene = g.scene;
    if (!scene) return;
    lit(scene, '#cfe6f0');
    const base = new Mesh(box(3, 4, 3), new MeshLambertMaterial({ color: '#8a8578' }));
    base.position.y = -2;
    scene.add(base);
    spawn(g);
    if (g.hud) g.hud.innerHTML = 'Space / F to drop the block · overhangs get cut off';
  },
  update(g, dt) {
    const current = state.current;
    const top = state.top;
    if (!g.over && current && g.scene) {
      current.u += current.sp * dt;
      if (current.u > 1) {
        current.u = 1;
        current.sp = -Math.abs(current.sp);
      }
      if (current.u < -1) {
        current.u = -1;
        current.sp = Math.abs(current.sp);
      }
      if (current.axis) current.x = top.x + current.u * 3.6;
      else current.z = top.z + current.u * 3.6;
      current.mesh.position.set(current.x, state.height + 0.25, current.z);
      if (g.act) drop(g);
    }
    for (const piece of state.falling) {
      piece.v -= 14 * dt;
      piece.mesh.position.y += piece.v * dt;
      piece.mesh.rotation.x += dt * 0.8;
    }
    state.falling = state.falling.filter((piece) => {
      if (piece.mesh.position.y < -12) {
        piece.mesh.parent?.remove(piece.mesh);
        return false;
      }
      return true;
    });
    state.orbit += dt * 0.25;
    state.look += (state.height - state.look) * Math.min(1, dt * 3);
    if (g.camera) {
      g.camera.position.set(Math.sin(state.orbit) * 8, state.look + 5.5, Math.cos(state.orbit) * 8);
      g.camera.lookAt(0, state.look, 0);
    }
  },
  status() {
    return { hot: false, hits: state.count, beat: 0, detail: 'Drop the sliding block' };
  },
};

function spawn(g: MinigameContext): void {
  if (!g.scene) return;
  const top = state.top;
  const axis: 0 | 1 = state.count % 2 === 1 ? 1 : 0;
  const color = new Color().setHSL((state.count * 0.07) % 1, 0.55, 0.6);
  const mesh = new Mesh(box(top.w, 0.5, top.d), new MeshLambertMaterial({ color }));
  g.scene.add(mesh);
  state.current = {
    mesh,
    axis,
    u: -1,
    sp: 1.1 + state.count * 0.06,
    x: top.x,
    z: top.z,
    w: top.w,
    d: top.d,
  };
}

function drop(g: MinigameContext): void {
  const current = state.current;
  const top = state.top;
  if (!current || !g.scene) return;
  const along = current.axis ? 'w' : 'd';
  const across = current.axis ? 'x' : 'z';
  let offset = current[across] - top[across];
  if (Math.abs(offset) < 0.12) {
    offset = 0;
    current[across] = top[across];
  }
  const keep = top[along] - Math.abs(offset);
  if (keep <= 0) {
    state.falling.push({ mesh: current.mesh, v: 0 });
    state.current = null;
    g.done({
      ok: state.count > 0,
      message: `Tower of ${state.count} blocks`,
      coins: Math.floor(state.count / 3),
    });
    return;
  }
  const cut = Math.abs(offset);
  const mid = top[across] + offset / 2;
  if (cut > 0) {
    const scrap = new Mesh(
      box(current.axis ? cut : top.w, 0.5, current.axis ? top.d : cut),
      current.mesh.material,
    );
    const sign = Math.sign(offset);
    scrap.position.set(
      current.axis ? mid + (sign * keep) / 2 : current.x,
      state.height + 0.25,
      current.axis ? current.z : mid + (sign * keep) / 2,
    );
    g.scene.add(scrap);
    state.falling.push({ mesh: scrap, v: 0 });
  }
  current.mesh.geometry.dispose();
  current.mesh.geometry = box(current.axis ? keep : top.w, 0.5, current.axis ? top.d : keep);
  if (current.axis) current.x = mid;
  else current.z = mid;
  current.mesh.position.set(current.x, state.height + 0.25, current.z);
  state.top = {
    x: current.x,
    z: current.z,
    w: current.axis ? keep : top.w,
    d: current.axis ? top.d : keep,
  };
  state.height += 0.5;
  state.count += 1;
  spawn(g);
}
