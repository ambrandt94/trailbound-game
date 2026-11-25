import { expect, test } from 'vitest';
import { createFight, IDLE_INPUT, type FighterInput } from '../../src/core/combat/fight';
import type { SpecialRequest } from '../../src/core/combat/types';

const DT = 1 / 60;

function hold(fight: ReturnType<typeof createFight>, seconds: number, input: FighterInput): void {
  let left = seconds;
  while (left > 0) {
    const step = Math.min(DT, left);
    fight.step(step, input);
    left -= step;
  }
}

test('a counter inside the window cancels the hit, damages, and staggers', () => {
  const specials: SpecialRequest[] = [];
  const fight = createFight(
    {
      weaponId: 'sword-shield',
      enemyCount: 1,
      counterWindowMs: 200,
      aggression: 0,
      attackRate: 0,
      script: [{ at: 0 }],
    },
    {
      onSpecial(request) {
        specials.push(request);
        return 'continue';
      },
    },
  );
  fight.teleport('enemy-0', 0, -1.05);
  hold(fight, 0.55, IDLE_INPUT);
  expect(fight.snapshot().enemies[0]?.telegraph).toBe('open');
  fight.step(DT, { ...IDLE_INPUT, counterPressed: true });
  const snap = fight.snapshot();
  expect(snap.player.hp).toBe(100);
  expect(snap.enemies[0]?.hp).toBeLessThan(48);
  expect(snap.enemies[0]?.staggered).toBe(true);
  expect(snap.player.moveId).toBe('parry');
  expect(specials).toEqual([
    {
      kind: 'counter',
      weaponId: 'sword-shield',
      moveId: 'parry',
      minigameId: null,
    },
  ]);
});

test('a counter outside the window whiffs and the strike still lands', () => {
  const fight = createFight({
    weaponId: 'sword-shield',
    enemyCount: 1,
    counterWindowMs: 200,
    aggression: 0,
    attackRate: 0,
    script: [{ at: 0 }],
  });
  fight.teleport('enemy-0', 0, -1.05);
  hold(fight, 0.4, IDLE_INPUT);
  expect(fight.snapshot().enemies[0]?.telegraph).toBe('windup');
  fight.step(DT, { ...IDLE_INPUT, counterPressed: true });
  expect(fight.snapshot().player.state).toBe('whiff');
  expect(fight.snapshot().player.hp).toBe(100);
  hold(fight, 0.45, IDLE_INPUT);
  const snap = fight.snapshot();
  expect(snap.player.hp).toBe(91);
  expect(snap.enemies[0]?.hp).toBe(48);
});

test('a shorter counter window opens later', () => {
  const tight = createFight({
    weaponId: 'hammer',
    enemyCount: 1,
    counterWindowMs: 100,
    aggression: 0,
    attackRate: 0,
    script: [{ at: 0 }],
  });
  hold(tight, 0.55, IDLE_INPUT);
  expect(tight.snapshot().enemies[0]?.telegraph).toBe('windup');
  hold(tight, 0.1, IDLE_INPUT);
  expect(tight.snapshot().enemies[0]?.telegraph).toBe('open');
});

test('a minigame answer pauses the fight until resume', () => {
  const fight = createFight(
    {
      weaponId: 'fists',
      enemyCount: 1,
      counterWindowMs: 400,
      aggression: 0,
      attackRate: 0,
      script: [{ at: 0 }],
    },
    { onSpecial: () => 'minigame' },
  );
  fight.teleport('enemy-0', 0, -1.05);
  hold(fight, 0.5, IDLE_INPUT);
  fight.step(DT, { ...IDLE_INPUT, counterPressed: true });
  expect(fight.snapshot().paused).toBe(true);
  const at = fight.snapshot().time;
  hold(fight, 0.5, { ...IDLE_INPUT, xDown: true });
  expect(fight.snapshot().time).toBeCloseTo(at, 5);
  fight.resume();
  hold(fight, 0.12, IDLE_INPUT);
  expect(fight.snapshot().paused).toBe(false);
  expect(fight.snapshot().time).toBeGreaterThan(at);
});
