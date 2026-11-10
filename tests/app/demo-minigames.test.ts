import { expect, test } from 'vitest';
import { signPlacement } from '../../src/core/world/minigame-play';
import { createParty } from '../../src/core/sim/party';
import { applesGame } from '../../src/minigames/games/apples';
import { CHOP_COINS, chopGame } from '../../src/minigames/games/chop';
import { fishGame } from '../../src/minigames/games/fish';
import { flapGame } from '../../src/minigames/games/flap';
import { registerDemoMinigames, registerWagonMinigames } from '../../src/minigames/games';
import { minigameHelpers } from '../../src/minigames/helpers/meter';
import { getMinigame, listMinigames } from '../../src/minigames/registry';
import type { MinigameContext, MinigameDef, MinigameResult } from '../../src/minigames/types';

test('fish and chop signs map onto the demo ids in town metres', () => {
  expect(signPlacement({ gameId: 'wild_fish', x: 12, y: 8 }, { x: 10, y: 6 }, 2)).toEqual({
    id: 'fish',
    label: 'Fishing',
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

test('fishing reaches a bite, and hooking starts the reel', () => {
  const run = harness(fishGame);
  for (let i = 0; i < 160 && fishGame.status?.(run.context)?.detail !== 'bite'; i++)
    run.step(0.05, {});
  expect(fishGame.status?.(run.context)?.detail).toBe('bite');
  run.step(0.016, { act: true });
  expect(fishGame.status?.(run.context)?.detail).toBe('reel');
});

test('three clean chops split the log for 3 coins, and three misses do not', () => {
  const felled = harness(chopGame);
  let armed = false;
  for (let i = 0; i < 800 && !felled.result; i++) {
    const hot = chopGame.status?.(felled.context)?.hot === true;
    felled.step(0.02, { act: hot && !armed });
    armed = hot;
  }
  expect(felled.result?.ok).toBe(true);
  expect(felled.result?.coins).toBe(CHOP_COINS);

  const missed = harness(chopGame);
  for (let i = 0; i < 2000 && !missed.result; i++) {
    const hot = chopGame.status?.(missed.context)?.hot === true;
    if (hot) missed.step(0.03, {});
    else missed.step(0.0001, { act: true });
  }
  expect(missed.result?.ok).toBe(false);
  expect(missed.result?.coins).toBe(0);
});

test('the finch falls without a flap, and apple catch ends when time does', () => {
  const fell = harness(flapGame);
  fell.context.W = 160;
  fell.context.H = 120;
  fell.step(0.05, { act: true });
  for (let i = 0; i < 80 && !fell.result; i++) fell.step(0.05, {});
  expect(fell.result?.message).toMatch(/Score 0/);
  expect(fell.result?.coins).toBe(0);

  const basket = harness(applesGame);
  basket.context.W = 160;
  basket.context.H = 90;
  for (let i = 0; i < 700 && !basket.result; i++)
    basket.step(0.05, { in: { x: 0, y: 0, hold: false } });
  expect(basket.result?.message).toMatch(/Caught/);
});

function harness(def: MinigameDef) {
  let result: MinigameResult | null = null;
  const context: MinigameContext = {
    in: { x: 0, y: 0, hold: false },
    pointer: {
      x: 0.5,
      y: 0.5,
      down: false,
      dx: 0,
      dy: 0,
      tap: false,
      press: false,
      dragX: 0,
      dragY: 0,
      moved: false,
    },
    act: false,
    quit: false,
    canvas: null,
    gfx: null,
    scene: null,
    camera: null,
    worldScene: null,
    pose: null,
    A: null,
    camYaw: 45,
    hud: null,
    side: null,
    width: 480,
    height: 320,
    W: 160,
    H: 120,
    t: 0,
    over: false,
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
      context.t += dt;
      Object.assign(context, patch);
      def.update(context, dt);
    },
    get result() {
      return result;
    },
  };
}
