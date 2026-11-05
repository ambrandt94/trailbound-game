import { expect, test } from 'vitest';
import { formatClock, START_HOUR } from '../../src/core/sim/clock';
import { createWorld, HERO_OUTSIDE_TOWN, WorldState } from '../../src/core/state/world-state';
import { DEFAULT_WORLD_SEED } from '../../src/core/world/index';

test('a new world starts at 08:00 on the parity seed, west of its town', () => {
  const world = createWorld({ id: 'waystead', name: 'Waystead', x: 8, y: 8 });
  expect(world.clockHours).toBe(START_HOUR);
  expect(world.seed).toBe(DEFAULT_WORLD_SEED);
  expect(world.hero.x).toBe(5.5);
  expect(world.hero.y).toBe(8);
  expect(formatClock(world.clockHours)).toBe('Day 1  08:00');
  expect(world.rev).toBe(0);
});

test('the clock bumps rev when a game minute passes and not before', () => {
  const world = new WorldState();
  world.advanceClock(0.01);
  expect(world.rev).toBe(0);
  world.advanceClock(1);
  expect(world.events.at(-1)?.type).toBe('clock-tick');
  expect(world.rev).toBe(1);
  expect(world.clockHours).toBeGreaterThan(START_HOUR);
});

test('leaving an area lands the hero just outside the town on that side', () => {
  const world = createWorld({ id: 'waystead', name: 'Waystead', x: 8, y: 4 });
  world.placeHeroOutside({ side: 'north', pos: 0.5, yaw: 0.25 });
  expect(world.hero.x).toBeCloseTo(8, 5);
  expect(world.hero.y).toBeCloseTo(4 - HERO_OUTSIDE_TOWN, 5);
  expect(world.hero.yaw).toBe(0.25);
  expect(world.events.at(-1)?.type).toBe('area-exit');

  world.placeHeroOutside({ side: 'east', pos: 1, yaw: 1 });
  expect(world.hero.x).toBeCloseTo(8 + HERO_OUTSIDE_TOWN, 5);
  expect(world.hero.y).toBeGreaterThan(4);
});

test('formatClock rolls the day after 24 game hours', () => {
  expect(formatClock(26.5)).toBe('Day 2  02:30');
});
