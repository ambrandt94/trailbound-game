import { FLAP_COINS } from './rewards';
import { BERRY, CREAM, MOSS, WOOD, drawLabel, paintField } from '../helpers/draw';
import type { MinigameDef } from '../types';

export const FLAP_GATES = 8;

interface Pipe {
  x: number;
  gap: number;
  scored: boolean;
}

interface FlapState {
  y: number;
  vy: number;
  time: number;
  pipes: Pipe[];
  passed: number;
  over: boolean;
}

function fresh(): FlapState {
  return { y: 0.55, vy: 0, time: 0, pipes: [], passed: 0, over: false };
}

let state = fresh();

/** Flap through eight gates. Space, F, or a tap lifts the bird. */
export const flapGame: MinigameDef = {
  id: 'flap',
  name: 'Flap',
  type: 'pop2d',
  size: 'full',
  start() {
    state = fresh();
  },
  update(g, dt) {
    if (state.over) return;
    const step = Math.min(0.05, Math.max(0, dt));
    if (g.quit) return finish(g, false, 'You let it go.');
    if (g.act) state.vy = -0.85;
    state.vy += 1.7 * step;
    state.y += state.vy * step;
    state.time += step;
    const spawnEvery = 2.4;
    const due = Math.floor(state.time / spawnEvery);
    while (state.pipes.length < due + 1 && state.pipes.length < FLAP_GATES + 2) {
      state.pipes.push({
        x: 1.15,
        gap: 0.32 + ((state.pipes.length * 37) % 40) / 100,
        scored: false,
      });
    }
    const birdX = 0.28;
    for (const pipe of state.pipes) {
      pipe.x -= step * 0.28;
      if (!pipe.scored && pipe.x < birdX) {
        pipe.scored = true;
        state.passed += 1;
      }
      const near = Math.abs(pipe.x - birdX) < 0.04;
      const hitGap = Math.abs(state.y - pipe.gap) > 0.16;
      if (near && hitGap) return finish(g, false, 'Clipped a gate.');
    }
    if (state.y < 0.08 || state.y > 0.96) return finish(g, false, 'Down you go.');
    if (state.passed >= FLAP_GATES)
      return finish(g, true, `Through the gates. +${FLAP_COINS} coins.`);
    paint(g);
  },
  status() {
    return { hot: false, hits: state.passed, beat: 0, detail: 'Tap or Space to flap.' };
  },
};

function finish(g: Parameters<MinigameDef['update']>[0], ok: boolean, message: string): void {
  state.over = true;
  g.done(ok ? { ok, message, coins: FLAP_COINS } : { ok, message });
}

function paint(g: Parameters<MinigameDef['update']>[0]): void {
  const canvas = g.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  paintField(ctx, g.width, g.height);
  drawLabel(ctx, 'Flap', 18, 14, 20);
  drawLabel(ctx, `${state.passed} / ${FLAP_GATES}`, 18, 42, 14, WOOD);
  for (const pipe of state.pipes) {
    const x = pipe.x * g.width;
    const gapY = pipe.gap * g.height;
    ctx.fillStyle = MOSS;
    ctx.fillRect(x - 18, 0, 36, gapY - 70);
    ctx.fillRect(x - 18, gapY + 70, 36, g.height);
    ctx.fillStyle = WOOD;
    ctx.fillRect(x - 22, gapY - 78, 44, 12);
    ctx.fillRect(x - 22, gapY + 66, 44, 12);
  }
  ctx.fillStyle = BERRY;
  ctx.beginPath();
  ctx.arc(0.28 * g.width, state.y * g.height, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.fillRect(0.28 * g.width + 6, state.y * g.height - 3, 10, 6);
}
