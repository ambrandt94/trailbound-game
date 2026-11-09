import { expect, test } from 'vitest';
import { HUNT_FOOD, wagonPlayResult } from '../../src/core/sim/party';
import { areaEscapeAction } from '../../src/app/area-escape';
import { minigameHelpers } from '../../src/minigames/helpers/meter';
import {
  COOK_BEATS,
  COOK_BEAT_SEC,
  COOK_NEED,
  wagonCook,
} from '../../src/minigames/games/wagon-cook';
import { EAT_BEATS, EAT_BEAT_SEC, EAT_NEED, wagonEat } from '../../src/minigames/games/wagon-eat';
import { HUNT_BEATS, HUNT_BEAT_SEC, wagonHunt } from '../../src/minigames/games/wagon-hunt';
import { WASH_GOAL, wagonWash } from '../../src/minigames/games/wagon-wash';
import { createParty } from '../../src/core/sim/party';
import type { MinigameContext, MinigameDef, MinigameResult } from '../../src/minigames/types';

test('escape inside a minigame does not leave the area', () => {
  expect(areaEscapeAction({ minigameOpen: true, settingsOpen: false, escape: true })).toBe('stay');
  expect(areaEscapeAction({ minigameOpen: false, settingsOpen: true, escape: true })).toBe(
    'close-settings',
  );
  expect(areaEscapeAction({ minigameOpen: false, settingsOpen: false, escape: true })).toBe(
    'leave',
  );
  expect(areaEscapeAction({ minigameOpen: false, settingsOpen: false, escape: false })).toBe(
    'stay',
  );
});

test('hunt scales food with the strikes and a miss spends nothing inside the game', () => {
  const full = playTiming(wagonHunt, HUNT_BEATS, HUNT_BEAT_SEC, () => true);
  expect(full?.ok).toBe(true);
  expect(full?.rawFoodDelta).toBe(HUNT_FOOD);
  expect(full?.tu).toBe(wagonPlayResult('hunt', { ok: true }).tu);

  const half = playTiming(wagonHunt, HUNT_BEATS, HUNT_BEAT_SEC, (beat) => beat < 2);
  expect(half?.ok).toBe(true);
  expect(half?.rawFoodDelta).toBe(Math.round(HUNT_FOOD * (2 / HUNT_BEATS)));

  const miss = playTiming(wagonHunt, HUNT_BEATS, HUNT_BEAT_SEC, () => false);
  expect(miss?.ok).toBe(false);
  expect(miss?.rawFoodDelta).toBeUndefined();
  expect(miss?.activity).toBe('hunt');
});

test('cook and eat need their strikes, and quitting spends no stores inside the game', () => {
  const cooked = playTiming(wagonCook, COOK_BEATS, COOK_BEAT_SEC, (beat) => beat < COOK_NEED);
  expect(cooked?.ok).toBe(true);
  expect(cooked?.rawFoodDelta).toBe(-1);
  expect(cooked?.mealsDelta).toBe(1);

  const raw = playTiming(wagonCook, COOK_BEATS, COOK_BEAT_SEC, () => false);
  expect(raw?.ok).toBe(false);
  expect(raw?.mealsDelta).toBeUndefined();

  const ate = playTiming(wagonEat, EAT_BEATS, EAT_BEAT_SEC, (beat) => beat < EAT_NEED);
  expect(ate?.ok).toBe(true);
  expect(ate?.clearHungry).toBe(true);
  expect(ate?.dirtyDishesDelta).toBe(1);
  expect(ate?.mealsDelta).toBe(-1);

  const quit = playUntilQuit(wagonEat);
  expect(quit?.ok).toBe(false);
  expect(quit?.message).toBe('You let it go.');
  expect(quit?.mealsDelta).toBeUndefined();
});

test('washing clears when the plate has been rubbed enough', () => {
  const done = playWash(Math.ceil(WASH_GOAL / 1.25));
  expect(done?.ok).toBe(true);
  expect(done?.activity).toBe('wash');
  expect(done?.moraleDelta).toBeGreaterThan(0);

  const quit = playUntilQuit(wagonWash);
  expect(quit?.ok).toBe(false);
  expect(quit?.activity).toBe('wash');
});

function playTiming(
  def: MinigameDef,
  beats: number,
  beatSec: number,
  hit: (beat: number) => boolean,
): MinigameResult | null {
  const run = harness(def);
  const step = 0.05;
  for (let t = 0; t < beats * beatSec + step; t += step) {
    const beat = Math.min(beats - 1, Math.floor(t / beatSec));
    const phase = (t - beat * beatSec) / beatSec;
    const status = def.status?.(run.context);
    run.step(step, { act: Boolean(status?.hot && hit(beat)) });
    if (run.result) return run.result;
    void phase;
  }
  return run.result;
}

function playUntilQuit(def: MinigameDef): MinigameResult | null {
  const run = harness(def);
  run.step(0.05, { quit: true });
  return run.result;
}

function playWash(rubs: number): MinigameResult | null {
  const run = harness(wagonWash);
  for (let i = 0; i < rubs; i++) {
    run.step(0.05, {
      pointer: { x: 0.5, y: 0.5, down: true, dx: 1, dy: 0, tap: false },
    });
    if (run.result) return run.result;
  }
  return run.result;
}

function harness(def: MinigameDef): {
  context: MinigameContext;
  step: (dt: number, patch: Partial<MinigameContext>) => void;
  result: MinigameResult | null;
} {
  let result: MinigameResult | null = null;
  const context: MinigameContext = {
    in: { x: 0, y: 0, hold: false },
    pointer: { x: 0.5, y: 0.5, down: false, dx: 0, dy: 0, tap: false },
    act: false,
    quit: false,
    canvas: null,
    scene: null,
    camera: null,
    width: 480,
    height: 320,
    supplies: createParty(),
    helpers: minigameHelpers,
    done: (next) => {
      result = next;
    },
  };
  def.start(context);
  return {
    context,
    step(dt, patch) {
      context.act = false;
      context.quit = false;
      context.pointer = { ...context.pointer, dx: 0, dy: 0, tap: false };
      Object.assign(context, patch);
      def.update(context, dt);
    },
    get result() {
      return result;
    },
  };
}
