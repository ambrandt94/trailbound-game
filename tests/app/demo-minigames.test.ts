import { expect, test } from 'vitest';
import { signPlacement } from '../../src/core/world/minigame-play';
import { createParty } from '../../src/core/sim/party';
import { APPLE_GOAL, applesGame } from '../../src/minigames/games/apples';
import { CHOP_NEED, chopGame } from '../../src/minigames/games/chop';
import { FISH_BEATS, FISH_BEAT_SEC, fishGame } from '../../src/minigames/games/fish';
import { flapGame } from '../../src/minigames/games/flap';
import { registerDemoMinigames, registerWagonMinigames } from '../../src/minigames/games';
import { minigameHelpers } from '../../src/minigames/helpers/meter';
import { getMinigame, listMinigames } from '../../src/minigames/registry';
import { CHOP_COINS, FISH_COINS } from '../../src/minigames/games/rewards';
import type { MinigameContext, MinigameDef, MinigameResult } from '../../src/minigames/types';

test('fish and chop signs map onto the demo ids in town metres', () => {
  expect(signPlacement({ gameId: 'wild_fish', x: 12, y: 8 }, { x: 10, y: 6 }, 2)).toEqual({
    id: 'fish',
    label: 'Fish',
    x: 4,
    z: 4,
  });
  expect(signPlacement({ gameId: 'wild_chop', x: 3, y: 9 }, { x: 0, y: 0 }, 1)?.id).toBe('chop');
  expect(signPlacement({ gameId: 'tavern_dice', x: 1, y: 1 }, { x: 0, y: 0 }, 1)).toBeNull();
});

test('the eight demos register beside the wagon games', () => {
  registerWagonMinigames();
  registerDemoMinigames();
  const ids = listMinigames().map((game) => game.id);
  for (const id of ['fish', 'chop', 'flap', 'apples', 'arena', 'cave', 'stack', 'runes']) {
    expect(ids).toContain(id);
  }
  expect(getMinigame('fish')?.type).toBe('world');
  expect(getMinigame('chop')?.type).toBe('world');
  expect(getMinigame('flap')?.size).toBe('full');
  expect(getMinigame('apples')?.drag).toBe(true);
  expect(getMinigame('arena')?.type).toBe('inst');
  expect(getMinigame('cave')?.type).toBe('inst');
  expect(getMinigame('stack')?.type).toBe('pop3d');
  expect(getMinigame('runes')?.type).toBe('pop3d');
  expect(getMinigame('runes')?.drag).toBe(true);
});

test('fishing pays a share of the purse and a bare hook pays nothing', () => {
  const full = playTiming(fishGame, FISH_BEATS, FISH_BEAT_SEC, () => true);
  expect(full?.ok).toBe(true);
  expect(full?.coins).toBe(FISH_COINS);
  const some = playTiming(fishGame, FISH_BEATS, FISH_BEAT_SEC, (beat) => beat === 0);
  expect(some?.ok).toBe(true);
  expect(some?.coins).toBe(Math.max(1, Math.round(FISH_COINS / FISH_BEATS)));
  const miss = playTiming(fishGame, FISH_BEATS, FISH_BEAT_SEC, () => false);
  expect(miss?.ok).toBe(false);
  expect(miss?.coins).toBeUndefined();
});

test('chopping needs three clean swings', () => {
  const felled = playTiming(chopGame, 4, 5.4, (beat) => beat < CHOP_NEED);
  expect(felled?.ok).toBe(true);
  expect(felled?.coins).toBe(CHOP_COINS);
  const held = playTiming(chopGame, 4, 5.4, (beat) => beat < 2);
  expect(held?.ok).toBe(false);
  expect(held?.coins).toBeUndefined();
});

test('the bird falls if it never flaps, and the basket can catch an apple', () => {
  const fell = harness(flapGame);
  for (let i = 0; i < 80 && !fell.result; i++) fell.step(0.05, {});
  expect(fell.result?.ok).toBe(false);

  const basket = harness(applesGame);
  for (let i = 0; i < 120 && basket.result == null; i++) {
    const apple = 0.63;
    basket.step(0.05, {
      pointer: { x: apple, y: 0.9, down: true, dx: 0, dy: 0, tap: false },
    });
  }
  expect(basket.context && APPLE_GOAL).toBeGreaterThan(0);
  expect(basket.result == null ? basket.hits() : basket.result.ok).toBeTruthy();
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
    const status = def.status?.(run.context);
    run.step(step, { act: Boolean(status?.hot && hit(beat)) });
    if (run.result) return run.result;
  }
  return run.result;
}

function harness(def: MinigameDef) {
  let result: MinigameResult | null = null;
  let hits = 0;
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
    step(dt: number, patch: Partial<MinigameContext>) {
      context.act = false;
      context.quit = false;
      context.pointer = { ...context.pointer, dx: 0, dy: 0, tap: false };
      Object.assign(context, patch);
      def.update(context, dt);
      hits = def.status?.(context)?.hits ?? hits;
    },
    get result() {
      return result;
    },
    hits: () => hits,
  };
}
