import {
  CircleGeometry,
  CylinderGeometry,
  ConeGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PointLight,
} from 'three';
import {
  clamp,
  follow,
  jump,
  lambert,
  lit,
  makeSim,
  mountRig,
  rnd2,
  walk,
} from '../helpers/runtime';
import type { MinigameDef } from '../types';

export const CAVE_CLEAR_COINS = 4;
export const CAVE_PARTIAL_COINS = 1;

interface Crystal {
  x: number;
  z: number;
  mesh: Mesh;
  light: PointLight;
  got: boolean;
}

interface Column {
  x: number;
  z: number;
  r: number;
}

let avatar = makeSim();
let crystals: Crystal[] = [];
let columns: Column[] = [];
let torch: PointLight | null = null;
let found = 0;
let left = 45;
let total = 0;
let camYaw = 45;

/** Collect every crystal before the 45 second torch dies. */
export const caveGame: MinigameDef = {
  id: 'cave',
  name: 'Crystal Cave',
  type: 'inst',
  drag: true,
  start(g) {
    found = 0;
    left = 45;
    crystals = [];
    columns = [];
    camYaw = g.camYaw;
    const scene = g.scene;
    if (!scene) return;
    lit(scene, '#120e14', 6, 22, 0.6);
    const floorMat = lambert('#5a5260', 0.35, 100);
    floorMat.map!.repeat.set(14, 14);
    const floor = new Mesh(new CircleGeometry(13.5, 28), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.2;
    scene.add(floor);
    const wallMat = lambert('#3a3440', 0.35, 101);
    wallMat.side = 1;
    wallMat.map!.repeat.set(20, 1.5);
    const wall = new Mesh(new CylinderGeometry(13.8, 14.5, 4, 28, 1, true), wallMat);
    wall.position.y = 1.8;
    scene.add(wall);
    for (let i = 0; i < 14; i++) {
      const angle = (((i * 47) % 100) / 100) * Math.PI * 2;
      const dist = 3 + (((i * 19) % 100) / 100) * 8.5;
      const x = Math.sin(angle) * dist;
      const z = Math.cos(angle) * dist;
      const radius = 0.4 + (((i * 13) % 50) / 100) * 0.5;
      if (Math.hypot(x, z - 5) < 2.5) continue;
      const pillar = new Mesh(
        new ConeGeometry(radius, 2 + radius * 3, 6),
        lambert('#3a3440', 0.35, 101),
      );
      pillar.position.set(x, 1 + radius * 1.5, z);
      scene.add(pillar);
      columns.push({ x, z, r: radius });
    }
    for (let i = 0; i < 40 && crystals.length < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = rnd2(2.5, 11.5);
      const x = Math.sin(angle) * dist;
      const z = Math.cos(angle) * dist;
      if (columns.some((column) => Math.hypot(column.x - x, column.z - z) < column.r + 1)) continue;
      if (crystals.some((crystal) => Math.hypot(crystal.x - x, crystal.z - z) < 3)) continue;
      if (Math.hypot(x, z - 5) < 3) continue;
      const pink = crystals.length % 2 === 1;
      const mesh = new Mesh(
        new OctahedronGeometry(0.3, 0),
        new MeshBasicMaterial({ color: pink ? '#ff9ae6' : '#7fe6ff' }),
      );
      mesh.scale.y = 1.7;
      mesh.position.set(x, 0.7, z);
      const light = new PointLight(pink ? '#ff9ae6' : '#7fe6ff', 0.9 * 12, 3.5);
      light.position.set(x, 0.8, z);
      scene.add(mesh, light);
      crystals.push({ x, z, mesh, light, got: false });
    }
    torch = new PointLight('#ffcc88', 1.8 * 12, 12);
    scene.add(torch);
    avatar = makeSim(0, 5);
    mountRig(scene, avatar);
    g.A = avatar;
    total = crystals.length;
  },
  update(g, dt) {
    if (!g.camera || !g.scene) return;
    if (g.act) jump(avatar);
    walk(avatar, dt, g.over ? 0 : g.in.x, g.over ? 0 : g.in.y, 12.6, columns, camYaw);
    if (!g.over) {
      left -= dt;
      for (const crystal of crystals) {
        if (!crystal.got && Math.hypot(avatar.x - crystal.x, avatar.z - crystal.z) < 0.8) {
          crystal.got = true;
          found += 1;
          crystal.light.intensity = 0;
        }
      }
      if (found >= total && total > 0) {
        g.done({ ok: true, message: `All ${total} crystals!`, coins: CAVE_CLEAR_COINS });
      } else if (left <= 0) {
        g.done({
          ok: found >= 3,
          message: `The torch went out…\nFound ${found} of ${total}`,
          coins: found >= 3 ? CAVE_PARTIAL_COINS : 0,
        });
      }
    }
    for (const crystal of crystals) {
      crystal.mesh.rotation.y += dt * 2;
      if (crystal.got) {
        crystal.mesh.position.y += dt * 4;
        crystal.mesh.scale.multiplyScalar(1 - dt * 3);
      } else crystal.mesh.position.y = 0.7 + Math.sin(g.t * 2 + crystal.x) * 0.12;
    }
    const k = clamp(left / 45, 0, 1);
    if (torch) {
      torch.distance = 5 + 9 * k;
      torch.intensity = (0.8 + k) * 12 * (1 + Math.sin(g.t * 23) * 0.05 + Math.sin(g.t * 7) * 0.05);
      torch.position.set(avatar.x, avatar.y + 2, avatar.z);
    }
    if (g.hud) {
      g.hud.innerHTML = `crystals ${found}/${total} &nbsp; torch ${Math.ceil(Math.max(0, left))}s<br><small>walk into the crystals (drag or stick) · Space / F / tap to jump</small>`;
    }
    follow(g.camera, avatar, 13, 55, camYaw);
    g.syncAvatar?.(avatar);
  },
  status() {
    return {
      hot: false,
      hits: found,
      beat: Math.ceil(Math.max(0, left)),
      detail: 'Collect the crystals',
    };
  },
};
