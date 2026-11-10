import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  CircleGeometry,
  DodecahedronGeometry,
  type Object3D,
  type Scene,
} from 'three';
import { rnd2 } from '../helpers/runtime';
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
  line: Line | null;
  props: Object3D[];
  cv: HTMLCanvasElement | null;
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
    props: [],
    cv: null,
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
    state.bx = pose.x + Math.sin(pose.yaw) * 2.2;
    state.bz = pose.z + Math.cos(pose.yaw) * 2.2;
    const scene = g.worldScene;
    if (scene && typeof document !== 'undefined') buildPond(scene, state);
    if (g.hud) g.hud.innerHTML = 'Casting…';
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
    let by = 0.04;
    if (state.phase === 'cast') {
      state.pt += dt / 0.55;
      const u = Math.min(1, state.pt);
      state.bob?.position.set(
        hx + (state.bx - hx) * u,
        hy + (0.04 - hy) * u + Math.sin(u * Math.PI) * 1.2,
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
          if (g.hud) g.hud.innerHTML = '!';
        }
      } else if (state.phase === 'bite') {
        state.pt -= dt;
        by -= 0.12;
        if (g.act) beginReel(g);
        else if (state.pt <= 0) {
          if (g.hud) g.hud.innerHTML = 'It got away…';
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
    const line = state.line?.geometry.getAttribute('position');
    if (line && state.bob) {
      line.setXYZ(0, hx, hy, hz);
      line.setXYZ(1, state.bob.position.x, state.bob.position.y + 0.2, state.bob.position.z);
      line.needsUpdate = true;
    }
  },
  end() {
    for (const prop of state.props) prop.parent?.remove(prop);
    state.bob?.parent?.remove(state.bob);
    state.line?.parent?.remove(state.line);
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
      'Hold <b>Space</b> (or the screen) to raise the bar · keep the fish inside it';
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

function buildPond(scene: Scene, fish: FishState): void {
  const group = new Group();
  const water = new Mesh(
    new CircleGeometry(2.6, 20),
    new MeshLambertMaterial({ color: '#4f8fb8', transparent: true, opacity: 0.9 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.04;
  group.add(water);
  for (let i = 0; i < 11; i++) {
    const angle = (i / 11) * Math.PI * 2;
    const rock = new Mesh(
      new DodecahedronGeometry(0.28 + ((i * 17) % 10) / 50, 0),
      new MeshLambertMaterial({ color: '#8a8578' }),
    );
    rock.position.set(Math.sin(angle) * 2.75, 0.08, Math.cos(angle) * 2.75);
    rock.scale.y = 0.55;
    group.add(rock);
  }
  const bob = new Group();
  const red = new Mesh(
    new SphereGeometry(0.12, 8, 6),
    new MeshLambertMaterial({ color: '#e04040' }),
  );
  red.position.y = 0.06;
  const white = new Mesh(
    new SphereGeometry(0.09, 8, 6),
    new MeshLambertMaterial({ color: '#fffdf2' }),
  );
  white.position.y = 0.17;
  bob.add(red, white);
  const line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: '#e8e0cc' }));
  line.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
  line.frustumCulled = false;
  group.position.set(fish.bx, 0, fish.bz);
  bob.position.set(0, 0.2, 0);
  scene.add(group, bob, line);
  fish.props.push(group);
  fish.bob = bob;
  fish.line = line;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
