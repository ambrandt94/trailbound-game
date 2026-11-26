import { expect, test } from 'vitest';
import { hitDamage } from '../../src/core/combat/damage';
import { createFight, IDLE_INPUT, type FighterInput } from '../../src/core/combat/fight';
import { weaponById } from '../../src/core/combat';
import type { MoveSpec, WeaponStyle } from '../../src/core/combat/types';

const DT = 1 / 60;

function frames(
  fight: ReturnType<typeof createFight>,
  seconds: number,
  input: FighterInput = IDLE_INPUT,
): void {
  let left = seconds;
  while (left > 0) {
    const step = Math.min(DT, left);
    fight.step(step, input);
    left -= step;
  }
}

function down(button: 'x' | 'y'): FighterInput {
  return {
    moveX: 0,
    moveZ: 0,
    xDown: button === 'x',
    yDown: button === 'y',
    counterPressed: false,
    lockDown: false,
    forward: 0,
    strafe: 0,
    shiftDown: false,
  };
}

test('hit damage uses the move and a style can change it', () => {
  const fists = weaponById('fists');
  const jab = fists.moves.find((move) => move.id === 'jab');
  expect(jab).toBeDefined();
  expect(hitDamage(fists, jab!)).toBe(7);
  const doubled: WeaponStyle = {
    ...fists,
    behavior: { modifyDamage: (damage) => damage * 2 },
  };
  expect(hitDamage(doubled, jab!)).toBe(14);
});

test('a tap and a hold of the same button deal different damage', () => {
  const light = createFight({ weaponId: 'fists', enemyCount: 1, aggression: 0, attackRate: 0 });
  light.teleport('enemy-0', 0, -1);
  frames(light, 0.08, down('x'));
  frames(light, 0.05, IDLE_INPUT);
  frames(light, 0.4, IDLE_INPUT);
  expect(light.snapshot().enemies[0]?.hp).toBe(48 - 7);

  const heavy = createFight({ weaponId: 'fists', enemyCount: 1, aggression: 0, attackRate: 0 });
  heavy.teleport('enemy-0', 0, -1);
  frames(heavy, 0.32, down('x'));
  frames(heavy, 0.45, IDLE_INPUT);
  expect(heavy.snapshot().enemies[0]?.hp).toBe(48 - 14);
  expect(
    heavy.snapshot().player.moveId === 'cross' ||
      heavy.snapshot().events.some((event) => event.type === 'hit' && event.moveId === 'cross'),
  ).toBe(true);
});

test('a hit staggers, knocks back, and hit-stop freezes the victim', () => {
  const fight = createFight({ weaponId: 'fists', enemyCount: 1, aggression: 0, attackRate: 0 });
  fight.teleport('enemy-0', 0, -1);
  let frozenAt: number | null = null;
  let left = 1.2;
  while (left > 0 && frozenAt === null) {
    fight.step(DT, left > 1.05 ? down('x') : IDLE_INPUT);
    left -= DT;
    const enemy = fight.snapshot().enemies[0];
    if (enemy && enemy.hp < 48) {
      frozenAt = enemy.z;
      fight.step(0.02, IDLE_INPUT);
      expect(fight.snapshot().enemies[0]?.z).toBeCloseTo(frozenAt, 4);
      expect(fight.snapshot().enemies[0]?.staggered).toBe(true);
    }
  }
  expect(frozenAt).not.toBeNull();
  frames(fight, 0.2, IDLE_INPUT);
  expect(fight.snapshot().enemies[0]!.z).toBeLessThan(frozenAt! - 0.05);
});

test('stagger locks the player out of starting an attack', () => {
  const fight = createFight({
    weaponId: 'fists',
    enemyCount: 1,
    aggression: 0,
    attackRate: 0,
    script: [{ at: 0 }],
    counterWindowMs: 120,
  });
  fight.teleport('enemy-0', 0, -1);
  frames(fight, 0.85, IDLE_INPUT);
  expect(fight.snapshot().player.hp).toBeLessThan(100);
  expect(fight.snapshot().player.staggered).toBe(true);
  frames(fight, 0.08, down('x'));
  frames(fight, 0.05, IDLE_INPUT);
  expect(fight.snapshot().player.moveId).toBeNull();
});

test('dagger taps land more than once and a hammer slam hits everyone in the area', () => {
  const daggers = createFight({
    weaponId: 'daggers',
    enemyCount: 1,
    aggression: 0,
    attackRate: 0,
  });
  daggers.teleport('enemy-0', 0, -1);
  frames(daggers, 0.08, down('x'));
  frames(daggers, 0.05, IDLE_INPUT);
  frames(daggers, 0.4, IDLE_INPUT);
  const hits = daggers.snapshot().events.filter((event) => event.type === 'hit');
  expect(hits.length).toBeGreaterThanOrEqual(2);
  expect(daggers.snapshot().enemies[0]?.hp).toBe(48 - 4 * 2);

  const hammer = createFight({
    weaponId: 'hammer',
    enemyCount: 2,
    aggression: 0,
    attackRate: 0,
  });
  hammer.teleport('enemy-0', 0.7, -0.8);
  hammer.teleport('enemy-1', -0.7, -0.8);
  frames(hammer, 0.34, down('y'));
  frames(hammer, 0.7, IDLE_INPUT);
  expect(hammer.snapshot().enemies[0]?.hp).toBeLessThan(48);
  expect(hammer.snapshot().enemies[1]?.hp).toBeLessThan(48);
});

test('a downed enemy comes back after the respawn delay', () => {
  const fight = createFight({
    weaponId: 'axe',
    enemyCount: 1,
    aggression: 0,
    attackRate: 0,
    respawnSec: 0.3,
  });
  fight.teleport('enemy-0', 0, -1);
  let guard = 0;
  while ((fight.snapshot().enemies[0]?.hp ?? 0) > 0 && guard < 12) {
    frames(fight, 0.34, down('x'));
    let spun = 0;
    while ((fight.snapshot().enemies[0]?.hp ?? 0) > 0 && spun < 0.85) {
      fight.step(DT, IDLE_INPUT);
      spun += DT;
    }
    guard += 1;
  }
  const deadAt = fight.snapshot().time;
  expect(fight.snapshot().enemies[0]?.hp).toBe(0);
  while (fight.snapshot().time < deadAt + 0.2) fight.step(DT, IDLE_INPUT);
  expect(fight.snapshot().enemies[0]?.hp).toBe(0);
  while (fight.snapshot().time < deadAt + 0.35) fight.step(DT, IDLE_INPUT);
  expect(fight.snapshot().enemies[0]?.hp).toBe(48);
});

test('move specs used above stay the numbers the tests assume', () => {
  const move = (id: string, weapon: string): MoveSpec => {
    const found = weaponById(weapon).moves.find((item) => item.id === id);
    if (!found) throw new Error(id);
    return found;
  };
  expect(move('jab', 'fists').damage).toBe(7);
  expect(move('cross', 'fists').damage).toBe(14);
  expect(move('nick', 'daggers').damage).toBe(4);
  expect(move('nick', 'daggers').hits).toBe(2);
  expect(move('slam', 'hammer').aoe).toBe(true);
});
