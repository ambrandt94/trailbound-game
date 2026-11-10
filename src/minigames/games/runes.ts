import {
  CanvasTexture,
  DodecahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { clamp, lit, noiseTexture, pixelTexture } from '../helpers/runtime';
import type { MinigameDef } from '../types';

export const RUNE_COINS = 3;

interface Rune {
  v: Vector3;
  mesh: Mesh;
  got: boolean;
}

let runes: Rune[] = [];
let yaw = 0;
let pitch = 0.2;
let found = 0;
let penalty = 0;
let note = '';
const aim = new Vector3();

function runeTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#fff';
  for (const rect of [
    [7, 2, 2, 12],
    [3, 4, 10, 2],
    [4, 9, 8, 2],
    [3, 12, 3, 2],
    [10, 12, 3, 2],
  ]) {
    ctx.fillRect(rect[0]!, rect[1]!, rect[2]!, rect[3]!);
  }
  const texture = new CanvasTexture(canvas);
  return pixelTexture(texture);
}

/** Orbit a stone and tap the rune that glows. A miss adds three seconds. */
export const runesGame: MinigameDef = {
  id: 'runes',
  name: 'Rune Stone',
  type: 'pop3d',
  size: 'full',
  drag: true,
  start(g) {
    runes = [];
    yaw = 0;
    pitch = 0.2;
    found = 0;
    penalty = 0;
    note = '';
    const scene = g.scene;
    if (!scene) return;
    lit(scene, '#2a2440', 0, 0, 0.8);
    const stoneMat = new MeshBasicMaterial({ map: noiseTexture('#8a8578', 0.35, 104) });
    const stone = new Mesh(new DodecahedronGeometry(1.6, 1), stoneMat);
    stone.scale.set(1, 1.15, 0.95);
    scene.add(stone);
    const map = runeTexture();
    for (let i = 0; i < 60 && runes.length < 3; i++) {
      const v = new Vector3(
        Math.random() * 2 - 1,
        Math.random() * 1.6 - 0.8,
        Math.random() * 2 - 1,
      ).normalize();
      if (runes.some((rune) => rune.v.dot(v) > 0.4)) continue;
      const mesh = new Mesh(
        new PlaneGeometry(0.5, 0.5),
        new MeshBasicMaterial({
          map: map ?? undefined,
          transparent: true,
          color: '#6a6458',
          depthWrite: false,
        }),
      );
      mesh.position.copy(v).multiply(new Vector3(1.62, 1.86, 1.54));
      mesh.lookAt(mesh.position.clone().multiplyScalar(2));
      scene.add(mesh);
      runes.push({ v, mesh, got: false });
    }
  },
  update(g, dt) {
    if (!g.over) {
      yaw += g.in.x * 1.8 * dt;
      pitch = clamp(pitch + g.in.y * 1.5 * dt, -1.2, 1.2);
    }
    const dist = 6.4;
    if (g.camera) {
      g.camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * dist,
        Math.sin(pitch) * dist,
        Math.cos(yaw) * Math.cos(pitch) * dist,
      );
      g.camera.lookAt(0, 0, 0);
      aim.copy(g.camera.position).normalize();
    }
    let facing: Rune | null = null;
    for (const rune of runes) {
      const dot = rune.v.dot(aim);
      if (!rune.got && dot > 0.9) facing = rune;
      const material = rune.mesh.material as MeshBasicMaterial;
      material.color.set(rune.got ? '#ffd27a' : dot > 0.9 ? '#9ae6ff' : '#6a6458');
      rune.mesh.scale.setScalar(rune.got ? 1.2 : dot > 0.9 ? 1 + Math.sin(g.t * 10) * 0.1 : 1);
    }
    if (!g.over && g.act) {
      if (facing) {
        facing.got = true;
        found += 1;
        note = 'Found one!';
        if (found >= 3) {
          g.done({
            ok: true,
            message: `All runes found in ${(g.t + penalty).toFixed(1)}s`,
            coins: RUNE_COINS,
          });
        }
      } else {
        penalty += 3;
        note = 'Nothing there (+3s)';
      }
    }
    if (g.hud) {
      const hint = facing ? '<b>a rune glows: press Space / F</b>' : note;
      g.hud.innerHTML = `runes ${found}/3 &nbsp; ${(g.t + penalty).toFixed(1)}s &nbsp; ${hint}<br><small>< > ^ v or drag to orbit the camera | tap when a rune glows</small>`;
    }
  },
  status() {
    return { hot: false, hits: found, beat: 0, detail: 'Orbit until a rune glows, then tap' };
  },
};
