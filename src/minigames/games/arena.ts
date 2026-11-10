import { BoxGeometry, Mesh, MeshLambertMaterial } from 'three';
import { ARENA_COINS } from './rewards';
import { makePawn } from '../helpers/pawn';
import type { MinigameDef } from '../types';

export const ARENA_FOES = 3;
const LIMIT = 40;

interface Foe {
  mesh: Mesh;
  x: number;
  z: number;
  down: boolean;
}

interface ArenaState {
  time: number;
  x: number;
  z: number;
  swing: number;
  foes: Foe[];
  down: number;
  over: boolean;
  pawn: ReturnType<typeof makePawn> | null;
}

function fresh(): ArenaState {
  return { time: 0, x: 0, z: 0, swing: 0, foes: [], down: 0, over: false, pawn: null };
}

let state = fresh();

/** Drag to move, Space or F to swing. Three dummies pay the purse. */
export const arenaGame: MinigameDef = {
  id: 'arena',
  name: 'Arena',
  type: 'inst',
  drag: true,
  start(g) {
    state = fresh();
    const scene = g.scene;
    if (!scene) return;
    const floor = new Mesh(
      new BoxGeometry(10, 0.2, 10),
      new MeshLambertMaterial({ color: 0xd7b07a }),
    );
    floor.position.y = -0.1;
    scene.add(floor);
    const pawn = makePawn();
    scene.add(pawn);
    state.pawn = pawn;
    const spots = [
      [2.2, 1.4],
      [-2, 1.8],
      [0.4, -2],
    ];
    state.foes = spots.map(([x, z]) => {
      const mesh = new Mesh(
        new BoxGeometry(0.7, 1.2, 0.7),
        new MeshLambertMaterial({ color: 0xc45c32 }),
      );
      mesh.position.set(x!, 0.6, z!);
      scene.add(mesh);
      return { mesh, x: x!, z: z!, down: false };
    });
  },
  update(g, dt) {
    if (state.over) return;
    const step = Math.min(0.05, Math.max(0, dt));
    if (g.quit) return finish(g, false, 'You let it go.');
    state.time += step;
    state.x += g.pointer.dx * 6 + g.in.x * step * 3.2;
    state.z += g.pointer.dy * 6 - g.in.y * step * 3.2;
    state.x = Math.max(-4, Math.min(4, state.x));
    state.z = Math.max(-4, Math.min(4, state.z));
    if (g.act) state.swing = 0.28;
    if (state.swing > 0) state.swing -= step;
    state.pawn?.position.set(state.x, 0, state.z);
    for (const foe of state.foes) {
      if (foe.down) continue;
      const dx = state.x - foe.x;
      const dz = state.z - foe.z;
      const dist = Math.hypot(dx, dz) || 1;
      foe.x += (dx / dist) * step * 0.7;
      foe.z += (dz / dist) * step * 0.7;
      foe.mesh.position.set(foe.x, 0.6, foe.z);
      if (state.swing > 0 && dist < 1.15) {
        foe.down = true;
        foe.mesh.position.y = 0.2;
        state.down += 1;
      }
    }
    if (state.down >= ARENA_FOES)
      return finish(g, true, `The ring is yours. +${ARENA_COINS} coins.`);
    if (state.time >= LIMIT) return finish(g, false, 'The dummies outlast you.');
  },
  status() {
    return {
      hot: state.swing > 0,
      hits: state.down,
      beat: 0,
      detail: 'Drag to move. Space swings.',
    };
  },
};

function finish(g: Parameters<MinigameDef['update']>[0], ok: boolean, message: string): void {
  state.over = true;
  g.done(ok ? { ok, message, coins: ARENA_COINS } : { ok, message });
}
