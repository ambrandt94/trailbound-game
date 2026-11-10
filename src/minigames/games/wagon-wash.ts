import { wagonPlayResult } from '../../core/sim/party';
import { CREAM, INK, MOSS, WATER, WOOD, drawCenter, drawLabel, paintField } from '../helpers/draw';
import type { MinigameDef, MinigameStatus } from '../types';

/** Rub distance, in surface-widths, that clears the plate. */
export const WASH_GOAL = 40;
/** A missed wash ends here, inside the 20–45s band if the player keeps rubbing. */
export const WASH_LIMIT_SEC = 42;

interface WashState {
  time: number;
  scrub: number;
  prevX: number;
  prevY: number;
  over: boolean;
  primed: boolean;
}

function fresh(): WashState {
  return { time: 0, scrub: 0, prevX: 0, prevY: 0, over: false, primed: false };
}

let state = fresh();

/** Drag or wag the stick to scrub. A clean plate clears every dirty dish. */
export const wagonWash: MinigameDef = {
  id: 'wagon_wash',
  name: 'Wash dishes',
  type: 'pop2d',
  size: 'part',
  h: 420,
  drag: true,
  activity: 'wash',
  start() {
    state = fresh();
  },
  update(g, dt) {
    if (state.over) return;
    const step = Math.min(0.05, Math.max(0, dt));
    if (g.quit) {
      state.over = true;
      g.done(wagonPlayResult('wash', { ok: false, message: 'You let it go.' }));
      return;
    }
    if (!state.primed) {
      state.prevX = g.in.x;
      state.prevY = g.in.y;
      state.primed = true;
    }
    state.scrub += Math.abs(g.in.x - state.prevX) * 0.9;
    state.scrub += Math.abs(g.in.y - state.prevY) * 0.9;
    state.prevX = g.in.x;
    state.prevY = g.in.y;
    state.scrub += (Math.abs(g.pointer.dx) + Math.abs(g.pointer.dy)) * 1.25;
    state.time += step;
    if (state.scrub >= WASH_GOAL) {
      state.over = true;
      g.done(wagonPlayResult('wash', { ok: true }));
    } else if (state.time >= WASH_LIMIT_SEC) {
      state.over = true;
      g.done(wagonPlayResult('wash', { ok: false }));
    }
    paint(g);
  },
  status(): MinigameStatus {
    return {
      hot: state.scrub > 0 && !state.over,
      hits: Math.min(WASH_GOAL, Math.floor(state.scrub)),
      beat: 0,
      detail: 'Rub the plate.',
    };
  },
};

function paint(g: Parameters<MinigameDef['update']>[0]): void {
  const canvas = g.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  paintField(ctx, g.width, g.height);
  drawLabel(ctx, 'Wash dishes', 18, 14, 20);
  drawLabel(ctx, 'Rub the plate with a finger, or wag A and D.', 18, 42, 13, WOOD);
  const cx = g.width / 2;
  const cy = g.height * 0.48;
  const left = 1 - Math.min(1, state.scrub / WASH_GOAL);
  ctx.fillStyle = CREAM;
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, 78, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = `rgba(90, 74, 48, ${0.15 + left * 0.55})`;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const speck = 8 + left * 16;
    ctx.beginPath();
    ctx.ellipse(
      cx + Math.cos(a) * 36,
      cy + Math.sin(a) * 28,
      speck,
      speck * 0.6,
      a,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.fillStyle = WATER;
  ctx.fillRect(24, g.height - 78, (g.width - 48) * Math.min(1, state.scrub / WASH_GOAL), 22);
  ctx.strokeStyle = WOOD;
  ctx.strokeRect(24, g.height - 78, g.width - 48, 22);
  drawCenter(
    ctx,
    left <= 0.02 ? 'Clean' : 'Scrub',
    cx,
    g.height - 96,
    14,
    left <= 0.02 ? MOSS : INK,
  );
}
