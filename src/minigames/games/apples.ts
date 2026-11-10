import { clamp, rnd2 } from '../helpers/runtime';
import type { MinigameDef } from '../types';

interface Apple {
  x: number;
  y: number;
  v: number;
  bad: boolean;
  gone?: number;
}

interface AppleState {
  bx: number;
  apples: Apple[];
  caught: number;
  life: number;
  left: number;
  spawn: number;
}

function blank(width: number): AppleState {
  return { bx: width / 2, apples: [], caught: 0, life: 3, left: 30, spawn: 0 };
}

let state = blank(120);

/** Catch red apples, skip the brown ones. Thirty seconds, three lives. */
export const applesGame: MinigameDef = {
  id: 'apples',
  name: 'Apple Catch',
  type: 'pop2d',
  size: 'part',
  h: 90,
  drag: true,
  start(g) {
    state = blank(g.W || g.width || 160);
    if (g.hud)
      g.hud.innerHTML = '< > or drag to move the basket | catch red apples, skip the rotten ones';
    g.over = false;
  },
  update(g, dt) {
    const width = g.W || g.width || 160;
    const height = g.H || g.height || 90;
    const basketY = height - 12;
    if (!g.over) {
      state.left -= dt;
      state.bx = clamp(state.bx + g.in.x * 95 * dt, 8, width - 8);
      state.spawn -= dt;
      if (state.spawn <= 0) {
        state.spawn = rnd2(0.45, 0.9);
        state.apples.push({
          x: rnd2(6, width - 6),
          y: 14,
          v: rnd2(26, 48) * (1 + (30 - state.left) / 40),
          bad: Math.random() < 0.22,
        });
      }
      for (const apple of state.apples) {
        apple.y += apple.v * dt;
        if (
          !apple.gone &&
          apple.y > basketY - 3 &&
          apple.y < basketY + 3 &&
          Math.abs(apple.x - state.bx) < 9
        ) {
          apple.gone = 1;
          if (apple.bad) state.life -= 1;
          else state.caught += 1;
        }
      }
      state.apples = state.apples.filter((apple) => !apple.gone && apple.y < height + 4);
      if (state.life <= 0) {
        g.done({
          ok: state.caught > 0,
          message: `Too many rotten apples!\nCaught ${state.caught}`,
          coins: Math.floor(state.caught / 4),
        });
      } else if (state.left <= 0) {
        g.done({
          ok: true,
          message: `Time! Caught ${state.caught} apples`,
          coins: Math.floor(state.caught / 3),
        });
      }
    }
    paint(g, width, height, basketY);
  },
  status() {
    return {
      hot: false,
      hits: state.caught,
      beat: state.life,
      detail: 'Drag the basket. Skip the brown apples.',
    };
  },
};

function paint(
  g: { gfx: CanvasRenderingContext2D | null },
  width: number,
  height: number,
  basketY: number,
): void {
  const ctx = g.gfx;
  if (!ctx) return;
  ctx.fillStyle = '#cfe6c2';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#3f7a3a';
  for (let i = -4; i < width; i += 14) ctx.fillRect(i, 0, 16, 10 + Math.abs((i * 5) % 7));
  ctx.fillStyle = '#6a9a45';
  ctx.fillRect(0, basketY + 5, width, height - basketY);
  for (const apple of state.apples) {
    ctx.fillStyle = apple.bad ? '#7a5230' : '#d93a2a';
    ctx.fillRect(Math.round(apple.x) - 2, Math.round(apple.y) - 2, 5, 5);
    ctx.fillStyle = '#3f7a3a';
    ctx.fillRect(Math.round(apple.x), Math.round(apple.y) - 4, 1, 2);
  }
  const basket = Math.round(state.bx);
  ctx.fillStyle = '#a9783c';
  ctx.fillRect(basket - 8, basketY - 2, 16, 7);
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(basket - 8, basketY - 2, 16, 2);
  ctx.fillStyle = '#2a1c1c';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`apple ${state.caught}`, 3, height - 2);
  ctx.textAlign = 'right';
  ctx.fillText(
    `${'♥'.repeat(Math.max(0, state.life))} ${Math.ceil(Math.max(0, state.left))}s`,
    width - 3,
    height - 2,
  );
}
