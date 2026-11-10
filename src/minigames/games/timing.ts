import { wagonPlayResult, type MinigameResult, type WagonPlayId } from '../../core/sim/party';
import {
  BERRY,
  CREAM,
  INK,
  MOSS,
  WATER,
  WOOD,
  drawCenter,
  drawLabel,
  drawPips,
  drawTrack,
  paintField,
  roundRect,
} from '../helpers/draw';
import type {
  MinigameContext,
  MinigameDef,
  MinigameKind,
  MinigameSize,
  MinigameStatus,
} from '../types';

export interface TimingSpec {
  id: string;
  name: string;
  activity?: WagonPlayId;
  type?: MinigameKind;
  size?: MinigameSize;
  h?: number;
  beats: number;
  beatSec: number;
  winStart: number;
  winEnd: number;
  /** Hits required. A hunt succeeds on any hit and scales the food. */
  need: number;
  scaleFood: boolean;
  hint: string;
  doodle: TimingDoodle;
  /** When set, this replaces the wagon reward. Used by the world fish and chop games. */
  reward?(hits: number, beats: number): MinigameResult;
}

export type TimingDoodle = 'tracks' | 'pot' | 'bowl' | 'water' | 'axe';

interface TimingState {
  time: number;
  hits: number;
  scored: boolean[];
  over: boolean;
}

export function createTimingGame(spec: TimingSpec): MinigameDef {
  let state: TimingState = fresh(spec.beats);
  return {
    id: spec.id,
    name: spec.name,
    type: spec.type ?? 'pop2d',
    size: spec.size ?? 'part',
    h: spec.h ?? 420,
    activity: spec.activity,
    start() {
      state = fresh(spec.beats);
    },
    update(g, dt) {
      if (state.over) return;
      const step = Math.min(0.05, Math.max(0, dt));
      if (g.quit) {
        state.over = true;
        g.done(quitResult(spec));
        return;
      }
      const view = viewAt(spec, state);
      if (g.act && view.hot) {
        state.scored[view.beat] = true;
        state.hits += 1;
      }
      state.time += step;
      if (state.time >= spec.beats * spec.beatSec) finish(g, spec, state);
      paint(g, spec, state);
    },
    status(): MinigameStatus {
      const view = viewAt(spec, state);
      return {
        hot: view.hot,
        hits: state.hits,
        beat: view.beat,
        detail: spec.hint,
      };
    },
  };
}

function fresh(beats: number): TimingState {
  return { time: 0, hits: 0, scored: Array.from({ length: beats }, () => false), over: false };
}

function viewAt(spec: TimingSpec, state: TimingState) {
  const span = spec.beatSec;
  const beat = Math.min(spec.beats - 1, Math.floor(state.time / span));
  const phase = (state.time - beat * span) / span;
  const hot = !state.scored[beat]! && phase >= spec.winStart && phase <= spec.winEnd;
  return { beat, phase, hot };
}

function quitResult(spec: TimingSpec): MinigameResult {
  if (spec.activity)
    return wagonPlayResult(spec.activity, { ok: false, message: 'You let it go.' });
  return { ok: false, message: 'You let it go.' };
}

function finish(g: MinigameContext, spec: TimingSpec, state: TimingState): void {
  state.over = true;
  if (spec.reward) {
    g.done(spec.reward(state.hits, spec.beats));
    return;
  }
  if (!spec.activity) {
    g.done({ ok: false, message: 'The moment passed.' });
    return;
  }
  if (spec.scaleFood) {
    if (state.hits <= 0) {
      g.done(wagonPlayResult(spec.activity, { ok: false }));
      return;
    }
    g.done(
      wagonPlayResult(spec.activity, {
        ok: true,
        foodScale: state.hits / spec.beats,
        message: `The hunt brings back a share of the bag (${state.hits}/${spec.beats}).`,
      }),
    );
    return;
  }
  const ok = state.hits >= spec.need;
  g.done(
    wagonPlayResult(spec.activity, {
      ok,
      message: ok ? undefined : undefined,
    }),
  );
}

function paint(g: MinigameContext, spec: TimingSpec, state: TimingState): void {
  const canvas = g.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const view = viewAt(spec, state);
  paintField(ctx, g.width, g.height);
  drawLabel(ctx, spec.name, 18, 14, 20);
  drawLabel(ctx, spec.hint, 18, 42, 13, WOOD);
  drawPips(ctx, state.hits, spec.beats, 28, 78);
  if (spec.doodle === 'pot') drawPot(ctx, g.width, g.height, view.phase, view.hot);
  else if (spec.doodle === 'bowl') drawBowl(ctx, g.width, g.height, view.phase, view.hot);
  else if (spec.doodle === 'water') drawWater(ctx, g.width, g.height, view.phase);
  else if (spec.doodle === 'axe') drawAxe(ctx, g.width, g.height, view.phase, view.hot);
  else drawTracks(ctx, g.width, g.height);
  const trackY = g.height - 92;
  drawTrack(ctx, 24, trackY, g.width - 48, 28, view.phase, spec.winStart, spec.winEnd, view.hot);
  drawCenter(
    ctx,
    view.hot ? 'Now' : `${view.beat + 1} / ${spec.beats}`,
    g.width / 2,
    trackY - 18,
    14,
    view.hot ? MOSS : INK,
  );
}

function drawWater(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: number,
): void {
  ctx.fillStyle = WATER;
  ctx.beginPath();
  ctx.ellipse(width / 2, height * 0.48, width * 0.28, 36, 0, 0, Math.PI * 2);
  ctx.fill();
  const bob = Math.sin(phase * Math.PI * 2) * 8;
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 40, height * 0.22);
  ctx.lineTo(width / 2 + bob, height * 0.48);
  ctx.stroke();
}

function drawAxe(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: number,
  hot: boolean,
): void {
  const cx = width / 2;
  const cy = height * 0.48;
  ctx.fillStyle = WOOD;
  ctx.fillRect(cx - 46, cy - 8, 92, 28);
  ctx.strokeStyle = hot ? BERRY : INK;
  ctx.lineWidth = 5;
  const swing = Math.sin(phase * Math.PI) * 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - 20, cy - 70);
  ctx.lineTo(cx + Math.sin(swing) * 30, cy - 10);
  ctx.stroke();
}

function drawTracks(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(40, height * 0.42);
  ctx.bezierCurveTo(
    width * 0.3,
    height * 0.28,
    width * 0.6,
    height * 0.55,
    width - 36,
    height * 0.36,
  );
  ctx.stroke();
  ctx.fillStyle = BERRY;
  for (const x of [0.28, 0.48, 0.7]) {
    ctx.beginPath();
    ctx.ellipse(width * x, height * 0.4, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPot(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: number,
  hot: boolean,
): void {
  const cx = width / 2;
  const cy = height * 0.46;
  ctx.fillStyle = WOOD;
  roundRect(ctx, cx - 70, cy - 36, 140, 90, 16);
  ctx.fill();
  ctx.fillStyle = hot ? '#e07a3a' : '#c46a32';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 30, 58, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  const angle = phase * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * 54, cy - 30 + Math.sin(angle) * 14);
  ctx.stroke();
}

function drawBowl(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  phase: number,
  hot: boolean,
): void {
  const cx = width / 2;
  const cy = height * 0.48;
  ctx.fillStyle = '#f7f1e4';
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 78, 36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hot ? WATER : '#7eb8c4';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 4, 60, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  const dip = Math.sin(phase * Math.PI);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx + 30, cy - 70);
  ctx.lineTo(cx + 8, cy - 20 + dip * 18);
  ctx.stroke();
}

export function timingLength(spec: Pick<TimingSpec, 'beats' | 'beatSec'>): number {
  return spec.beats * spec.beatSec;
}
