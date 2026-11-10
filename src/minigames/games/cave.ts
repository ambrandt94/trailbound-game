import { BoxGeometry, Mesh, MeshLambertMaterial } from 'three';
import { CAVE_COINS } from './rewards';
import { makePawn } from '../helpers/pawn';
import type { MinigameDef } from '../types';

const GATES = [2.5, 6, 9.5, 13, 16.5];
const END = 20;

interface CaveState {
  z: number;
  x: number;
  scrapes: number;
  over: boolean;
  pawn: ReturnType<typeof makePawn> | null;
}

function fresh(): CaveState {
  return { z: 0, x: 0, scrapes: 0, over: false, pawn: null };
}

let state = fresh();

/** The path moves itself. Drag to stay in the gaps. */
export const caveGame: MinigameDef = {
  id: 'cave',
  name: 'Cave',
  type: 'inst',
  drag: true,
  start(g) {
    state = fresh();
    const scene = g.scene;
    if (!scene) return;
    const floor = new Mesh(
      new BoxGeometry(6, 0.2, 24),
      new MeshLambertMaterial({ color: 0xc4a574 }),
    );
    floor.position.set(0, -0.1, 10);
    scene.add(floor);
    const wallMat = new MeshLambertMaterial({ color: 0x8d6a4a });
    GATES.forEach((z, index) => {
      const gap = index % 2 === 0 ? -0.6 : 0.7;
      for (const side of [-1.8, 1.8]) {
        const mesh = new Mesh(new BoxGeometry(1.6, 1.6, 0.4), wallMat);
        mesh.position.set(side + gap * 0.2, 0.8, z);
        scene.add(mesh);
      }
    });
    const glow = new Mesh(
      new BoxGeometry(0.5, 0.5, 0.5),
      new MeshLambertMaterial({ color: 0xf2d48a }),
    );
    glow.position.set(0, 0.6, END);
    scene.add(glow);
    const pawn = makePawn();
    scene.add(pawn);
    state.pawn = pawn;
    if (g.camera) {
      g.camera.position.set(0, 6, -4);
      g.camera.lookAt(0, 0.4, 6);
    }
  },
  update(g, dt) {
    if (state.over) return;
    const step = Math.min(0.05, Math.max(0, dt));
    if (g.quit) return finish(g, false, 'You let it go.');
    state.z += step * 2.4;
    if (g.pointer.down) state.x = (g.pointer.x - 0.5) * 3.2;
    else state.x = Math.max(-1.6, Math.min(1.6, state.x + g.in.x * step * 2.2));
    const gate = GATES.find((z) => Math.abs(z - state.z) < 0.18);
    if (gate != null) {
      const index = GATES.indexOf(gate);
      const gap = index % 2 === 0 ? -0.6 : 0.7;
      if (Math.abs(state.x - gap) > 0.85) state.scrapes += step * 8;
    }
    state.pawn?.position.set(state.x, 0, state.z);
    g.camera?.position.set(state.x * 0.3, 5.5, state.z - 5);
    g.camera?.lookAt(state.x, 0.6, state.z + 3);
    if (state.scrapes >= 6) return finish(g, false, 'The walls close in.');
    if (state.z >= END) return finish(g, true, `Daylight. +${CAVE_COINS} coins.`);
  },
  status() {
    return {
      hot: false,
      hits: Math.floor(state.z),
      beat: 0,
      detail: 'Drag to thread the gaps.',
    };
  },
};

function finish(g: Parameters<MinigameDef['update']>[0], ok: boolean, message: string): void {
  state.over = true;
  g.done(ok ? { ok, message, coins: CAVE_COINS } : { ok, message });
}
