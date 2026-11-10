import {
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import { pixelTexture, rnd2 } from '../helpers/runtime';
import type { MinigameContext, MinigameDef } from '../types';

/** Controller fish table: name, fight speed, coin purse. */
const FISH = [
  ['minnow', 0.9, 2],
  ['perch', 1.25, 3],
  ['trout', 1.6, 4],
  ['pike', 2.1, 6],
] as const;

interface FishState {
  phase: 'cast' | 'wait' | 'bite' | 'reel';
  pt: number;
  bx: number;
  bz: number;
  fish: (typeof FISH)[number] | null;
  f: number;
  fv: number;
  ft: number;
  fg: number;
  b: number;
  bv: number;
  pr: number;
  bob: Object3D | null;
  line: Mesh | null;
  bite: Object3D | null;
  props: Object3D[];
  cv: HTMLCanvasElement | null;
  surface: number;
}

function blank(): FishState {
  return {
    phase: 'cast',
    pt: 0,
    bx: 0,
    bz: 0,
    fish: null,
    f: 0.5,
    fv: 0,
    ft: 0.5,
    fg: 0,
    b: 0.4,
    bv: 0,
    pr: 0.3,
    bob: null,
    line: null,
    bite: null,
    props: [],
    cv: null,
    surface: 0,
  };
}

let state = blank();

/** Cast, wait for the bite, then hold to keep the fish in the bar. */
export const fishGame: MinigameDef = {
  id: 'fish',
  name: 'Fishing',
  type: 'world',
  start(g) {
    state = blank();
    const pose = g.pose ?? { x: 0, y: 0, z: 0, yaw: 0 };
    const sign = g.worldScene ? nearestFishSign(g.worldScene, pose.x, pose.z) : null;
    if (sign) {
      const yaw = sign.rotation.y;
      state.bx = sign.position.x + Math.sin(yaw) * 1.6;
      state.bz = sign.position.z + Math.cos(yaw) * 1.6;
      state.surface = sign.position.y;
    } else {
      state.bx = pose.x + Math.sin(pose.yaw) * 2.2;
      state.bz = pose.z + Math.cos(pose.yaw) * 2.2;
      state.surface = pose.y;
    }
    const scene = g.worldScene;
    if (scene && typeof document !== 'undefined') buildPond(scene, state, sign == null);
    if (g.hud) g.hud.innerHTML = 'Casting...';
    g.over = false;
  },
  update(g, dt) {
    if (g.over && state.phase !== 'reel') return;
    const pose = g.pose ?? { x: state.bx, y: 0, z: state.bz, yaw: 0 };
    const dx = Math.sin(pose.yaw);
    const dz = Math.cos(pose.yaw);
    const hx = pose.x + dx * 0.5;
    const hz = pose.z + dz * 0.5;
    const hy = pose.y + 1.5;
    let by = state.surface + 0.55;
    if (state.phase === 'cast') {
      state.pt += dt / 0.55;
      const u = Math.min(1, state.pt);
      state.bob?.position.set(
        hx + (state.bx - hx) * u,
        hy + (state.surface + 0.55 - hy) * u + Math.sin(u * Math.PI) * 1.2,
        hz + (state.bz - hz) * u,
      );
      if (u >= 1) wait(g);
    } else if (!g.over) {
      if (state.phase === 'wait') {
        state.pt -= dt;
        by += Math.sin(g.t * 3) * 0.02;
        if (g.act) {
          if (g.hud) g.hud.innerHTML = 'Too early!';
          wait(g);
        } else if (state.pt <= 0) {
          state.phase = 'bite';
          state.pt = 0.85;
          if (g.hud) g.hud.innerHTML = '<b>Bite!</b> Press Space / F or tap';
        }
      } else if (state.phase === 'bite') {
        state.pt -= dt;
        by -= 0.12;
        if (g.act) beginReel(g);
        else if (state.pt <= 0) {
          if (g.hud) g.hud.innerHTML = 'It got away...';
          wait(g);
        }
      } else if (state.phase === 'reel' && state.fish) {
        const speed = state.fish[1];
        const bar = 0.3;
        state.fg -= dt;
        if (state.fg <= 0) {
          state.fg = rnd2(0.35, 1.1) / speed;
          state.ft = clamp01(state.f + rnd2(-0.6, 0.6) * Math.min(1, speed * 0.7));
        }
        state.fv += ((state.ft - state.f) * 14 * speed - state.fv * 5) * dt;
        state.f = clamp01(state.f + state.fv * dt);
        state.bv += (g.in.hold ? 2.6 : -2.2) * dt;
        state.b += state.bv * dt;
        if (state.b < 0) {
          state.b = 0;
          state.bv = Math.abs(state.bv) * 0.3;
        }
        if (state.b > 1 - bar) {
          state.b = 1 - bar;
          state.bv = 0;
        }
        const inside = state.f >= state.b && state.f <= state.b + bar;
        state.pr = clamp01(state.pr + (inside ? 0.32 : -0.22) * dt);
        by += Math.sin(g.t * 20) * 0.04;
        paintBar(inside);
        if (state.pr >= 1)
          g.done({ ok: true, message: `Caught a ${state.fish[0]}!`, coins: state.fish[2] });
        else if (state.pr <= 0)
          g.done({ ok: false, message: `The ${state.fish[0]} got away.`, coins: 0 });
      }
      state.bob?.position.set(state.bx, by, state.bz);
    }
    if (state.line && state.bob) aimLine(state.line, hx, hy, hz, state.bob.position);
    if (state.bite && state.bob) {
      state.bite.visible = state.phase === 'bite';
      state.bite.position.set(
        state.bob.position.x,
        state.bob.position.y + 0.7,
        state.bob.position.z,
      );
    }
  },
  end() {
    for (const prop of state.props) prop.parent?.remove(prop);
    state.bob?.parent?.remove(state.bob);
    state.line?.parent?.remove(state.line);
    state.bite?.parent?.remove(state.bite);
    state.cv?.remove();
  },
  status() {
    return {
      hot: state.phase === 'bite',
      hits: state.phase === 'reel' ? 1 : 0,
      beat: 0,
      detail: state.phase,
    };
  },
};

function wait(g: MinigameContext): void {
  state.phase = 'wait';
  state.pt = rnd2(1.5, 4);
  if (g.hud) g.hud.innerHTML = 'Wait for a bite, then press <b>Space / F</b> or tap';
}

function beginReel(g: MinigameContext): void {
  state.fish = FISH[Math.floor(Math.random() * FISH.length)]!;
  state.phase = 'reel';
  state.f = 0.5;
  state.fv = 0;
  state.ft = 0.5;
  state.fg = 0;
  state.b = 0.4;
  state.bv = 0;
  state.pr = 0.3;
  if (g.hud)
    g.hud.innerHTML =
      'Hold <b>Space</b> (or the screen) to raise the bar | keep the fish inside it';
  if (typeof document === 'undefined' || !g.side) return;
  const canvas = document.createElement('canvas');
  canvas.width = 40;
  canvas.height = 120;
  canvas.className = 'px';
  g.side.append(canvas);
  state.cv = canvas;
}

function paintBar(inside: boolean): void {
  const canvas = state.cv;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const height = 120;
  const bar = 0.3;
  ctx.fillStyle = '#2a1c1c';
  ctx.fillRect(0, 0, 40, height);
  ctx.fillStyle = '#4f8fb8';
  ctx.fillRect(3, 3, 22, height - 6);
  ctx.fillStyle = inside ? '#7fd65f' : '#5fa04a';
  ctx.fillRect(4, 3 + (height - 6) * (1 - state.b - bar), 20, (height - 6) * bar);
  const fy = 3 + (height - 6) * (1 - state.f);
  ctx.fillStyle = '#f0a040';
  ctx.fillRect(9, fy - 3, 10, 6);
  ctx.fillRect(19, fy - 2, 3, 4);
  ctx.fillStyle = '#2a1c1c';
  ctx.fillRect(11, fy - 1, 1, 1);
  ctx.fillStyle = '#3a3028';
  ctx.fillRect(29, 3, 8, height - 6);
  ctx.fillStyle = state.pr > 0.6 ? '#7fd65f' : state.pr > 0.3 ? '#e0b040' : '#e04040';
  ctx.fillRect(29, 3 + (height - 6) * (1 - state.pr), 8, (height - 6) * state.pr);
}

const up = new Vector3(0, 1, 0);
const hand = new Vector3();
const tip = new Vector3();
const mid = new Vector3();
const dir = new Vector3();

function buildPond(scene: Scene, fish: FishState, pond: boolean): void {
  if (pond) {
    const group = new Group();
    group.name = 'fishing-pond';
    const waterMat = new MeshBasicMaterial({ color: '#2f8fd8' });
    waterMat.polygonOffset = true;
    waterMat.polygonOffsetFactor = -4;
    waterMat.polygonOffsetUnits = -4;
    const water = new Mesh(new CircleGeometry(4.4, 24), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.45;
    group.add(water);
    for (let i = 0; i < 11; i++) {
      const angle = (i / 11) * Math.PI * 2;
      const rock = new Mesh(
        new DodecahedronGeometry(0.34 + ((i * 17) % 10) / 40, 0),
        new MeshBasicMaterial({ color: '#8a8578' }),
      );
      rock.position.set(Math.sin(angle) * 3.55, 0.16, Math.cos(angle) * 3.55);
      rock.scale.y = 0.55;
      group.add(rock);
    }
    group.position.set(fish.bx, fish.surface, fish.bz);
    keep(group);
    scene.add(group);
    fish.props.push(group);
  }
  const bob = new Group();
  bob.name = 'fishing-float';
  const red = new Mesh(new SphereGeometry(0.22, 8, 6), new MeshBasicMaterial({ color: '#e04040' }));
  red.position.y = 0.1;
  const white = new Mesh(
    new SphereGeometry(0.16, 8, 6),
    new MeshBasicMaterial({ color: '#fffdf2' }),
  );
  white.position.y = 0.28;
  bob.add(red, white);
  bob.scale.setScalar(1.7);
  bob.position.set(fish.bx, fish.surface + 0.55, fish.bz);
  const line = new Mesh(
    new CylinderGeometry(0.06, 0.06, 1, 5),
    new MeshBasicMaterial({ color: '#f4efe2' }),
  );
  line.name = 'fishing-line';
  line.frustumCulled = false;
  const bite = biteMark();
  keep(bob);
  keep(line);
  keep(bite);
  scene.add(bob, line, bite);
  fish.bob = bob;
  fish.line = line;
  fish.bite = bite;
}

function aimLine(line: Mesh, hx: number, hy: number, hz: number, bob: Vector3): void {
  hand.set(hx, hy, hz);
  tip.set(bob.x, bob.y + 0.28, bob.z);
  mid.copy(hand).lerp(tip, 0.5);
  dir.copy(tip).sub(hand);
  const length = Math.max(0.2, dir.length());
  dir.multiplyScalar(1 / length);
  line.position.copy(mid);
  line.scale.set(1, length, 1);
  line.quaternion.setFromUnitVectors(up, dir);
}

function biteMark(): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fffdf2';
    ctx.strokeStyle = '#2a1c1c';
    ctx.lineWidth = 6;
    ctx.font = 'bold 52px monospace';
    ctx.textAlign = 'center';
    ctx.strokeText('!', 32, 50);
    ctx.fillText('!', 32, 50);
  }
  const map = pixelTexture(new CanvasTexture(canvas));
  const sprite = new Sprite(new SpriteMaterial({ map, depthTest: false }));
  sprite.scale.set(0.9, 0.9, 1);
  sprite.visible = false;
  sprite.name = 'fishing-bite';
  return sprite;
}

function nearestFishSign(scene: Scene, x: number, z: number): Object3D | null {
  let best: Object3D | null = null;
  let bestD = 8;
  scene.traverse((node) => {
    if (node.userData.mg !== 'fish') return;
    const dist = Math.hypot(node.position.x - x, node.position.z - z);
    if (dist < bestD) {
      best = node;
      bestD = dist;
    }
  });
  return best;
}

function keep(object: Object3D): void {
  object.traverse((node) => {
    node.userData.tbKeep = 1;
    node.frustumCulled = false;
  });
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
