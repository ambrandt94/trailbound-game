import { BoxGeometry, Mesh, MeshLambertMaterial } from 'three';
import { RUNES_COINS } from './rewards';
import type { MinigameDef } from '../types';

const COLORS = [0xc45c32, 0x3f7d55, 0x4a9eb2, 0xe0b15a];

interface Rune {
  mesh: Mesh;
  homeX: number;
  x: number;
  z: number;
  socketX: number;
  socketZ: number;
  held: boolean;
  set: boolean;
}

interface RuneState {
  runes: Rune[];
  drag: number;
  over: boolean;
}

function fresh(): RuneState {
  return { runes: [], drag: -1, over: false };
}

let state = fresh();

/** Drag each rune onto the matching socket. */
export const runesGame: MinigameDef = {
  id: 'runes',
  name: 'Runes',
  type: 'pop3d',
  size: 'full',
  drag: true,
  start(g) {
    state = fresh();
    const scene = g.scene;
    if (!scene) return;
    const board = new Mesh(
      new BoxGeometry(8, 0.15, 5),
      new MeshLambertMaterial({ color: 0xf4e2c4 }),
    );
    board.position.y = -0.1;
    scene.add(board);
    COLORS.forEach((color, index) => {
      const mesh = new Mesh(new BoxGeometry(0.7, 0.35, 0.7), new MeshLambertMaterial({ color }));
      const homeX = -2.4 + index * 1.6;
      mesh.position.set(homeX, 0.2, 1.4);
      scene.add(mesh);
      const socket = new Mesh(
        new BoxGeometry(0.85, 0.08, 0.85),
        new MeshLambertMaterial({ color }),
      );
      const socketX = -2.4 + ((index * 3) % 4) * 1.6;
      socket.position.set(socketX, 0.02, -1.3);
      scene.add(socket);
      state.runes.push({
        mesh,
        homeX,
        x: homeX,
        z: 1.4,
        socketX,
        socketZ: -1.3,
        held: false,
        set: false,
      });
    });
    if (g.camera) {
      g.camera.position.set(0, 6.5, 4.2);
      g.camera.lookAt(0, 0, 0);
    }
  },
  update(g, dt) {
    if (state.over) return;
    void dt;
    if (g.quit) return finish(g, false, 'You let it go.');
    const worldX = (g.pointer.x - 0.5) * 8;
    const worldZ = (0.5 - g.pointer.y) * 5;
    if (g.pointer.down && state.drag < 0) {
      let best = -1;
      let bestD = 0.7;
      state.runes.forEach((rune, index) => {
        if (rune.set) return;
        const dist = Math.hypot(rune.x - worldX, rune.z - worldZ);
        if (dist < bestD) {
          bestD = dist;
          best = index;
        }
      });
      state.drag = best;
    }
    if (!g.pointer.down) {
      const rune = state.runes[state.drag];
      if (rune && !rune.set) {
        const dist = Math.hypot(rune.x - rune.socketX, rune.z - rune.socketZ);
        if (dist < 0.55) {
          rune.set = true;
          rune.x = rune.socketX;
          rune.z = rune.socketZ;
        }
      }
      state.drag = -1;
    }
    const held = state.runes[state.drag];
    if (held && g.pointer.down && !held.set) {
      held.x = worldX;
      held.z = worldZ;
    }
    for (const rune of state.runes) rune.mesh.position.set(rune.x, 0.2, rune.z);
    if (state.runes.length === COLORS.length && state.runes.every((rune) => rune.set)) {
      return finish(g, true, `The sockets glow. +${RUNES_COINS} coins.`);
    }
  },
  status() {
    return {
      hot: state.drag >= 0,
      hits: state.runes.filter((rune) => rune.set).length,
      beat: 0,
      detail: 'Drag each rune to its matching socket.',
    };
  },
};

function finish(g: Parameters<MinigameDef['update']>[0], ok: boolean, message: string): void {
  state.over = true;
  g.done(ok ? { ok, message, coins: RUNES_COINS } : { ok, message });
}
