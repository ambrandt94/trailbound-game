import { BoxGeometry, Mesh, MeshLambertMaterial } from 'three';
import { STACK_COINS } from './rewards';
import type { MinigameDef } from '../types';

export const STACK_GOAL = 5;

interface Block {
  mesh: Mesh;
  x: number;
  width: number;
}

interface StackState {
  time: number;
  slider: number;
  dir: number;
  blocks: Block[];
  over: boolean;
}

function fresh(): StackState {
  return { time: 0, slider: -1.4, dir: 1, blocks: [], over: false };
}

let state = fresh();

/** A block slides. Space or a tap drops it. Five clean drops pay out. */
export const stackGame: MinigameDef = {
  id: 'stack',
  name: 'Stack',
  type: 'pop3d',
  size: 'part',
  h: 460,
  start(g) {
    state = fresh();
    const scene = g.scene;
    if (!scene) return;
    place(scene, 0, 1.8, 0.15, 0x8d5a32);
    state.blocks[0]!.x = 0;
    spawn(scene);
  },
  update(g, dt) {
    if (state.over || !g.scene) return;
    const step = Math.min(0.05, Math.max(0, dt));
    if (g.quit) return finish(g, false, 'You let it go.');
    state.time += step;
    state.slider += state.dir * step * 1.5;
    if (state.slider > 1.5 || state.slider < -1.5) state.dir *= -1;
    const live = state.blocks[state.blocks.length - 1];
    if (live) {
      live.mesh.position.x = state.slider;
      live.x = state.slider;
    }
    if (g.act && state.blocks.length > 1) {
      const prev = state.blocks[state.blocks.length - 2]!;
      const overlap = prev.width - Math.abs(state.slider - prev.x);
      if (overlap < 0.45) return finish(g, false, 'It tumbled off.');
      if (!live) return;
      live.width = overlap;
      live.mesh.scale.x = overlap / 1.8;
      live.x = state.slider;
      const placed = state.blocks.length - 1;
      if (placed >= STACK_GOAL) return finish(g, true, `A steady tower. +${STACK_COINS} coins.`);
      state.slider = -1.4;
      state.dir = 1;
      spawn(g.scene);
    }
  },
  status() {
    return {
      hot: false,
      hits: Math.max(0, state.blocks.length - 1),
      beat: 0,
      detail: 'Tap to drop the block.',
    };
  },
};

function place(
  scene: NonNullable<Parameters<MinigameDef['start']>[0]['scene']>,
  x: number,
  width: number,
  y: number,
  color: number,
): void {
  const mesh = new Mesh(new BoxGeometry(1.8, 0.28, 1.8), new MeshLambertMaterial({ color }));
  mesh.position.set(x, y, 0);
  scene.add(mesh);
  state.blocks.push({ mesh, x, width });
}

function spawn(scene: NonNullable<Parameters<MinigameDef['start']>[0]['scene']>): void {
  const y = 0.15 + state.blocks.length * 0.32;
  place(scene, state.slider, 1.8, y, 0xc4a574);
}

function finish(g: Parameters<MinigameDef['update']>[0], ok: boolean, message: string): void {
  state.over = true;
  g.done(ok ? { ok, message, coins: STACK_COINS } : { ok, message });
}
