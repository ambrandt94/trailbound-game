import { expect, test } from 'vitest';
import {
  avatarFromChoices,
  choiceHistory,
  choicesFromAvatar,
  defaultChoices,
  defaultPlayerAvatar,
  isRegaliaId,
  playableIds,
  profileEntryFromChoices,
  randomizeChoices,
  recordChoices,
  redoChoices,
  undoChoices,
} from '../../src/core/people/avatar';
import { createWorld } from '../../src/core/state/world-state';

test('a profile entry pins race, gender, style, and adult age', () => {
  const choices = defaultChoices('Mara');
  choices.race = 'pixie';
  choices.gender = 'f';
  choices.style = 'mage';
  choices.richness = 1.4;
  choices.slots = { feet: { mode: 'include', garment: 'boots' } };
  const entry = profileEntryFromChoices(choices);
  expect(entry.races).toEqual({ pixie: 1 });
  expect(entry.genders).toEqual({ f: 1 });
  expect(entry.styles).toEqual({ mage: 1 });
  expect(entry.ages).toEqual({ adult: 1 });
  expect(entry.richness).toBe(1);
  expect(entry.slots).toEqual({ feet: { include: ['boots'] } });
  expect(entry).not.toHaveProperty('child');
});

test('royal races stay out of the picker until richness clears the gate', () => {
  const races = ['human', 'royal_elf', 'pixie', 'royal_elf'];
  expect(playableIds(races, 0.84)).toEqual(['human', 'pixie']);
  expect(playableIds(races, 0.85)).toEqual(['human', 'royal_elf', 'pixie']);
  expect(isRegaliaId('royal')).toBe(true);
  expect(isRegaliaId('look:royal_king')).toBe(true);
  expect(isRegaliaId('wanderer')).toBe(false);
});

test('undo and redo walk the last few picks', () => {
  let history = choiceHistory(defaultChoices());
  history = recordChoices(history, { ...history.present, race: 'elf' });
  history = recordChoices(history, { ...history.present, style: 'knight' });
  history = recordChoices(history, { ...history.present, gender: 'f' });
  expect(history.present.gender).toBe('f');
  history = undoChoices(history);
  expect(history.present.style).toBe('knight');
  expect(history.present.gender).toBe('m');
  history = undoChoices(history);
  expect(history.present.race).toBe('elf');
  expect(history.present.style).toBe('wanderer');
  history = redoChoices(history);
  expect(history.present.style).toBe('knight');
  history = recordChoices(history, { ...history.present, name: 'Io' });
  expect(history.future).toEqual([]);
  expect(history.present.name).toBe('Io');
});

test('randomize keeps locked choices and always takes a new seed', () => {
  const choices = defaultChoices('Mara');
  choices.locks = { ...choices.locks, race: true, style: true };
  choices.race = 'kobold';
  choices.style = 'ranger';
  const rolls = [0.1, 0.2, 0.9, 0.4, 0.6];
  let index = 0;
  const next = randomizeChoices(
    choices,
    { races: ['human', 'elf', 'pixie'], styles: ['wanderer', 'knight', 'royal_king'] },
    () => rolls[index++] ?? 0,
  );
  expect(next.seed).not.toBe(choices.seed);
  expect(next.race).toBe('kobold');
  expect(next.style).toBe('ranger');
  expect(next.name).toBe('Mara');
  expect(next.slots).toEqual({});
});

test('the world saves an avatar and continue restores it', () => {
  const world = createWorld({ id: 'waystead', name: 'Waystead', x: 8, y: 8 });
  const avatar = avatarFromChoices(
    { ...defaultChoices('Sera'), race: 'goliath', gender: 'f', seed: 99, style: 'scholar' },
    'aabbccddeeff0011',
  );
  world.setAvatar(avatar);
  world.hero = { x: 3, y: 4, yaw: 0.5 };
  const packed = world.toPacked({
    gameVersion: '0.0.0',
    cfPin: { version: '1.1.0', generatorVersion: '1' },
  });
  expect(packed.player.name).toBe('Sera');
  expect(packed.player.avatar).toMatchObject({
    name: 'Sera',
    seed: 99,
    race: 'goliath',
    gender: 'f',
    recipeHash: 'aabbccddeeff0011',
    generatorVersion: 1,
  });
  expect(packed.player.avatar?.profileEntry.ages).toEqual({ adult: 1 });
  expect(packed.player.avatar?.profileEntry.races).toEqual({ goliath: 1 });

  const restored = createWorld({ id: 'other', name: 'Other', x: 0, y: 0 });
  restored.load(structuredClone(packed));
  expect(restored.avatar).toEqual(world.avatar);

  const saved = packed.player.avatar;
  if (!saved) throw new Error('expected avatar');
  saved.race = 'imp';
  expect(world.avatar.race).toBe('goliath');
  expect(restored.hero).toEqual({ x: 3, y: 4, yaw: 0.5 });
  expect(choicesFromAvatar(restored.avatar).style).toBe('scholar');
  expect(restored.events.at(-1)?.type).toBe('loaded');
});

test('a fresh avatar is an adult human traveller until the creator confirms', () => {
  const avatar = defaultPlayerAvatar();
  expect(avatar).toMatchObject({ name: 'Traveller', race: 'human', gender: 'm', recipeHash: '' });
  expect(avatar.profileEntry.ages).toEqual({ adult: 1 });
});
