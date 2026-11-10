import {
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SphereGeometry,
  BoxGeometry,
} from 'three';
import {
  follow,
  jump,
  lambert,
  lit,
  makeSim,
  mountRig,
  rnd2,
  walk,
  type SimAvatar,
} from '../helpers/runtime';
import type { MinigameDef } from '../types';

export const ARENA_COINS = 5;

interface Slime {
  x: number;
  z: number;
  y: number;
  hop: number;
  ht: number;
  dx: number;
  dz: number;
  dead: number;
  mesh: Group;
}

interface ArenaState {
  avatar: SimAvatar | null;
  slimes: Slime[];
  kills: number;
  hp: number;
  spawn: number;
  camYaw: number;
}

let state: ArenaState = { avatar: null, slimes: [], kills: 0, hp: 3, spawn: 0, camYaw: 45 };

/** Stomp 5 slimes. Jump on them; touching one costs a heart. */
export const arenaGame: MinigameDef = {
  id: 'arena',
  name: 'Slime Arena',
  type: 'inst',
  drag: true,
  start(g) {
    state = { avatar: null, slimes: [], kills: 0, hp: 3, spawn: 0, camYaw: g.camYaw };
    const scene = g.scene;
    if (!scene) return;
    lit(scene, '#f0c9a8', 30, 70);
    const grass = lambert('#6a9a45', 0.3, 96);
    grass.map!.repeat.set(12, 12);
    const disc = new Mesh(new CircleGeometry(13, 24), grass);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.2;
    scene.add(disc);
    const out = lambert('#4a7a3a', 0.3, 97);
    out.map!.repeat.set(40, 40);
    const field = new Mesh(new PlaneGeometry(200, 200), out);
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.3;
    scene.add(field);
    const stone = lambert('#8a8578', 0.3, 4);
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2;
      const pillar = new Mesh(new BoxGeometry(0.5, 1.2 + ((i * 13) % 8) / 10, 0.5), stone);
      pillar.position.set(Math.sin(angle) * 12.6, 0.5, Math.cos(angle) * 12.6);
      pillar.rotation.y = angle;
      scene.add(pillar);
    }
    const trunk = lambert('#6a4128', 0.25, 8);
    const leaf = lambert('#3f7a3a', 0.3, 9);
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2 + 0.2;
      const dist = 16 + (i % 5) * 1.4;
      const x = Math.sin(angle) * dist;
      const z = Math.cos(angle) * dist;
      const stem = new Mesh(new CylinderGeometry(0.2, 0.28, 1.6, 6), trunk);
      stem.position.set(x, 0.5, z);
      const crown = new Mesh(new ConeGeometry(1.3, 3, 6), leaf);
      crown.position.set(x, 2.6, z);
      scene.add(stem, crown);
    }
    const avatar = makeSim(0, 6);
    mountRig(scene, avatar);
    state.avatar = avatar;
    g.A = avatar;
    for (const [x, z] of slimeSpots(state.camYaw)) spawn(scene, x, z);
    state.spawn = 99;
    hud(g);
    if (g.camera) follow(g.camera, avatar, 16, 52, state.camYaw);
  },
  update(g, dt) {
    const avatar = state.avatar;
    if (!avatar || !g.camera) return;
    if (g.act) jump(avatar);
    walk(avatar, dt, g.over ? 0 : g.in.x, g.over ? 0 : g.in.y, 12, [], state.camYaw);
    if (!g.over && state.slimes.length + state.kills < 5) {
      state.spawn -= dt;
      if (state.spawn <= 0 && state.slimes.length < 3) {
        state.spawn = 1.4;
        const spot = slimeSpots(state.camYaw)[state.slimes.length] ?? [0, 2];
        if (g.scene) spawn(g.scene, spot[0], spot[1]);
      }
    }
    for (const slime of state.slimes) {
      if (slime.dead) {
        slime.dead += dt;
        const squash = Math.max(0.05, 1 - slime.dead * 5);
        slime.mesh.scale.set(1 + slime.dead * 3, squash, 1 + slime.dead * 3);
        continue;
      }
      if (!g.over) {
        slime.hop -= dt;
        if (slime.hop <= 0 && !slime.ht) {
          slime.ht = 0.5;
          const dist = Math.hypot(avatar.x - slime.x, avatar.z - slime.z) || 1;
          slime.dx = ((avatar.x - slime.x) / dist) * 1.9;
          slime.dz = ((avatar.z - slime.z) / dist) * 1.9;
        }
        if (slime.ht > 0) {
          slime.ht -= dt;
          slime.x += (slime.dx * dt) / 0.5;
          slime.z += (slime.dz * dt) / 0.5;
          slime.y = Math.sin((1 - slime.ht / 0.5) * Math.PI) * 0.7;
          if (slime.ht <= 0) {
            slime.ht = 0;
            slime.y = 0;
            slime.hop = rnd2(0.6, 1.3);
          }
        }
        const dist = Math.hypot(avatar.x - slime.x, avatar.z - slime.z);
        if (dist < 0.85 && avatar.vy < 0 && avatar.y > slime.y + 0.3) {
          slime.dead = 0.001;
          avatar.vy = 8;
          state.kills += 1;
          hud(g);
          if (state.kills >= 5) g.done({ ok: true, message: 'Arena cleared!', coins: ARENA_COINS });
        } else if (dist < 0.7 && avatar.y < slime.y + 0.6 && avatar.inv <= 0) {
          state.hp -= 1;
          avatar.inv = 1.2;
          avatar.kb = 0.3;
          avatar.vx = ((avatar.x - slime.x) / (dist || 1)) * 9;
          avatar.vz = ((avatar.z - slime.z) / (dist || 1)) * 9;
          avatar.vy = 4;
          hud(g);
          if (state.hp <= 0)
            g.done({ ok: false, message: 'Knocked out!\nBack to the trail you go.', coins: 0 });
        }
      }
      slime.mesh.position.set(slime.x, slime.y, slime.z);
      slime.mesh.rotation.y = Math.atan2(avatar.x - slime.x, avatar.z - slime.z);
      if (!slime.dead) {
        const hop = slime.ht ? 0.15 : Math.sin(g.t * 6) * 0.05;
        const squat = slime.ht ? -0.1 : Math.sin(g.t * 6 + 1.5) * 0.05;
        slime.mesh.scale.set(1 + squat, 1 + hop, 1 + squat);
      }
    }
    state.slimes = state.slimes.filter((slime) => {
      if (slime.dead > 0.35) {
        slime.mesh.parent?.remove(slime.mesh);
        return false;
      }
      return true;
    });
    follow(g.camera, avatar, 16, 52, state.camYaw);
  },
  status() {
    return { hot: false, hits: state.kills, beat: state.hp, detail: 'Jump on the slimes' };
  },
};

function hud(g: { hud: HTMLElement | null }): void {
  if (!g.hud) return;
  const hearts = `${Math.max(0, state.hp)}/3`;
  g.hud.innerHTML = `HP ${hearts} &nbsp; slimes ${state.kills}/5<br><small>drag or stick to move | Space / F / tap to jump | land on the slimes</small>`;
}

/** Five slimes in the camera's view, inside the walk disc. */
function slimeSpots(camYaw: number): Array<[number, number]> {
  const th = (camYaw * Math.PI) / 180;
  const fx = -Math.sin(th);
  const fz = -Math.cos(th);
  const rx = -fz;
  const rz = fx;
  const layout: Array<[number, number]> = [
    [2.4, -1.5],
    [3.2, 1.3],
    [4.6, -0.3],
    [5.2, 1.8],
    [6.4, -1.7],
  ];
  return layout.map(([forward, side]) => {
    let x = fx * forward + rx * side;
    let z = 6 + fz * forward + rz * side;
    const reach = Math.hypot(x, z);
    if (reach > 10.2) {
      x *= 10.2 / reach;
      z *= 10.2 / reach;
    }
    return [x, z];
  });
}

function spawn(scene: { add(object: Group): void }, x: number, z: number): void {
  const group = new Group();
  group.name = 'slime';
  const body = new Mesh(
    new SphereGeometry(0.55, 8, 6),
    new MeshLambertMaterial({ color: '#7fd65f' }),
  );
  body.position.y = 0.42;
  body.scale.y = 0.75;
  const eye = new MeshBasicMaterial({ color: '#2a1c1c' });
  const left = new Mesh(new BoxGeometry(0.1, 0.14, 0.05), eye);
  const right = left.clone();
  left.position.set(-0.18, 0.52, 0.42);
  right.position.set(0.18, 0.52, 0.42);
  group.add(body, left, right);
  group.position.set(x, 0, z);
  scene.add(group);
  state.slimes.push({
    x,
    z,
    y: 0,
    hop: rnd2(0.4, 0.9),
    ht: 0,
    dx: 0,
    dz: 0,
    dead: 0,
    mesh: group,
  });
}
