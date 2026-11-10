import { rnd2 } from '../helpers/runtime';
import type { MinigameDef } from '../types';

interface Pipe {
  x: number;
  gy: number;
  scored: number;
}

interface FlapState {
  by: number;
  vy: number;
  pipes: Pipe[];
  score: number;
  going: boolean;
  pt: number;
  clouds: Array<[number, number]>;
}

function blank(): FlapState {
  return { by: 50, vy: 0, pipes: [], score: 0, going: false, pt: 0, clouds: [] };
}

let state = blank();

/** Flappy Finch. Coins are half the gate count, rounded down. */
export const flapGame: MinigameDef = {
  id: 'flap',
  name: 'Flappy Finch',
  type: 'pop2d',
  size: 'full',
  h: 120,
  start(g) {
    state = blank();
    state.clouds = [0, 1, 2].map((i) => [Math.random() * (g.W || 160), 10 + i * 14]);
    if (g.hud) g.hud.innerHTML = 'Space / F / tap to flap';
    g.over = false;
  },
  update(g, dt) {
    const width = g.W || g.width || 160;
    const height = g.H || g.height || 120;
    const ground = height - 12;
    const birdX = Math.round(width * 0.3);
    if (!g.over) {
      if (!state.going) {
        state.by = 50 + Math.sin(g.t * 4) * 3;
        if (g.act) {
          state.going = true;
          state.vy = -88;
        }
      } else {
        if (g.act) state.vy = -88;
        state.vy += 260 * dt;
        state.by += state.vy * dt;
        state.pt -= dt;
        if (state.pt <= 0) {
          state.pt = 1.55;
          state.pipes.push({ x: width + 8, gy: rnd2(22, ground - 46), scored: 0 });
        }
        for (const pipe of state.pipes) {
          pipe.x -= 42 * dt;
          if (!pipe.scored && pipe.x + 14 < birdX) {
            pipe.scored = 1;
            state.score += 1;
          }
        }
        state.pipes = state.pipes.filter((pipe) => pipe.x > -20);
        const hit =
          state.by > ground - 3 ||
          state.by < -10 ||
          state.pipes.some(
            (pipe) =>
              birdX + 3 > pipe.x &&
              birdX - 3 < pipe.x + 14 &&
              (state.by - 3 < pipe.gy || state.by + 3 > pipe.gy + 38),
          );
        if (hit)
          g.done({
            ok: state.score > 0,
            message: `Score ${state.score}`,
            coins: Math.floor(state.score / 2),
          });
      }
    }
    for (const cloud of state.clouds) {
      cloud[0] -= (state.going && !g.over ? 8 : 3) * dt;
      if (cloud[0] < -24) cloud[0] = width + 4;
    }
    paint(g, width, height, ground, birdX);
  },
  status() {
    return { hot: false, hits: state.score, beat: 0, detail: 'Space / F / tap to flap' };
  },
};

function paint(
  g: MinigameContextLike,
  width: number,
  height: number,
  ground: number,
  birdX: number,
): void {
  const ctx = g.gfx;
  if (!ctx) return;
  ctx.fillStyle = '#a9cfe0';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#fffdf2';
  for (const cloud of state.clouds) {
    ctx.fillRect(Math.round(cloud[0]), cloud[1], 18, 4);
    ctx.fillRect(Math.round(cloud[0]) + 4, cloud[1] - 3, 9, 3);
  }
  ctx.fillStyle = '#8fb3a8';
  for (let i = 0; i < width; i += 16) ctx.fillRect(i, ground - 8 - ((i * 7) % 11), 16, 20);
  for (const pipe of state.pipes) {
    const px = Math.round(pipe.x);
    ctx.fillStyle = '#3f7a3a';
    ctx.fillRect(px, 0, 14, pipe.gy);
    ctx.fillRect(px, pipe.gy + 38, 14, ground - pipe.gy - 38);
    ctx.fillStyle = '#6a9a45';
    ctx.fillRect(px - 2, pipe.gy - 5, 18, 5);
    ctx.fillRect(px - 2, pipe.gy + 38, 18, 5);
    ctx.fillRect(px + 2, 0, 3, pipe.gy - 5);
  }
  ctx.fillStyle = '#a98b5a';
  ctx.fillRect(0, ground, width, height - ground);
  ctx.fillStyle = '#6a9a45';
  ctx.fillRect(0, ground, width, 3);
  const by = Math.round(state.by);
  const tilt = state.vy > 40 ? 1 : 0;
  ctx.fillStyle = '#e0b040';
  ctx.fillRect(birdX - 4, by - 3, 8, 6);
  ctx.fillStyle = '#d9602a';
  ctx.fillRect(birdX + 4, by - 1 + tilt, 3, 2);
  ctx.fillStyle = '#fffdf2';
  ctx.fillRect(birdX - 3, by - 1 + (state.vy < 0 ? -1 : 1), 4, 2);
  ctx.fillStyle = '#2a1c1c';
  ctx.fillRect(birdX + 1, by - 2, 1, 1);
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(state.going ? String(state.score) : 'Space to flap', width / 2, 14);
}

interface MinigameContextLike {
  gfx: CanvasRenderingContext2D | null;
}
