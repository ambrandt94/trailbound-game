import { APPLES_COINS } from './rewards';
import { BERRY, CREAM, MOSS, WOOD, drawLabel, paintField } from '../helpers/draw';
import type { MinigameDef } from '../types';

export const APPLE_GOAL = 8;

interface Apple {
  x: number;
  y: number;
  caught: boolean;
  missed: boolean;
}

interface AppleState {
  time: number;
  next: number;
  apples: Apple[];
  caught: number;
  missed: number;
  basket: number;
  over: boolean;
}

function fresh(): AppleState {
  return { time: 0, next: 0.4, apples: [], caught: 0, missed: 0, basket: 0.5, over: false };
}

let state = fresh();

/** Drag the basket, or hold A and D. Eight apples pay the purse. */
export const applesGame: MinigameDef = {
  id: 'apples',
  name: 'Apples',
  type: 'pop2d',
  size: 'part',
  h: 460,
  drag: true,
  start() {
    state = fresh();
  },
  update(g, dt) {
    if (state.over) return;
    const step = Math.min(0.05, Math.max(0, dt));
    if (g.quit) return finish(g, false, 'You let it go.');
    if (g.pointer.down) state.basket = g.pointer.x;
    else state.basket = Math.max(0.08, Math.min(0.92, state.basket + g.in.x * step * 0.8));
    state.time += step;
    if (state.time >= state.next && state.apples.length < 14) {
      state.next += 1.5;
      const n = state.apples.length + 1;
      state.apples.push({ x: ((n * 53) % 80) / 100 + 0.1, y: 0.12, caught: false, missed: false });
    }
    for (const apple of state.apples) {
      if (apple.caught || apple.missed) continue;
      apple.y += step * 0.28;
      if (apple.y >= 0.82) {
        if (Math.abs(apple.x - state.basket) < 0.09) {
          apple.caught = true;
          state.caught += 1;
        } else {
          apple.missed = true;
          state.missed += 1;
        }
      }
    }
    if (state.caught >= APPLE_GOAL)
      return finish(g, true, `A full basket. +${APPLES_COINS} coins.`);
    if (state.missed >= 6) return finish(g, false, 'Too many on the ground.');
    paint(g);
  },
  status() {
    return { hot: false, hits: state.caught, beat: 0, detail: 'Drag the basket under the apples.' };
  },
};

function finish(g: Parameters<MinigameDef['update']>[0], ok: boolean, message: string): void {
  state.over = true;
  g.done(ok ? { ok, message, coins: APPLES_COINS } : { ok, message });
}

function paint(g: Parameters<MinigameDef['update']>[0]): void {
  const canvas = g.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  paintField(ctx, g.width, g.height);
  drawLabel(ctx, 'Apples', 18, 14, 20);
  drawLabel(ctx, `${state.caught} / ${APPLE_GOAL}`, 18, 42, 14, WOOD);
  for (const apple of state.apples) {
    if (apple.missed) continue;
    ctx.fillStyle = apple.caught ? MOSS : BERRY;
    ctx.beginPath();
    ctx.arc(apple.x * g.width, (apple.caught ? 0.78 : apple.y) * g.height, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  const bx = state.basket * g.width;
  ctx.fillStyle = WOOD;
  ctx.fillRect(bx - 36, g.height * 0.84, 72, 16);
  ctx.fillStyle = CREAM;
  ctx.fillRect(bx - 28, g.height * 0.8, 56, 8);
}
