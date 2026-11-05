/** Person, party, camp, and ledger ports land in G3. */
export const PEOPLE_PORT = 'g3' as const;

export {
  AVATAR_HISTORY_LIMIT,
  GENERATOR_VERSION,
  REGALIA_MIN_RICHNESS,
  avatarFromChoices,
  choiceHistory,
  choicesFromAvatar,
  cloneChoices,
  defaultChoices,
  defaultPlayerAvatar,
  isPlayerAvatar,
  isRegaliaId,
  playableIds,
  profileEntryFromChoices,
  randomizeChoices,
  recordChoices,
  redoChoices,
  sameChoices,
  undoChoices,
} from './avatar';
export type {
  AvatarChoices,
  AvatarGender,
  AvatarLocks,
  ChoiceHistory,
  PlayerAvatar,
  PlayerProfileEntry,
  RandomizeCatalog,
  SlotChoice,
  SlotMode,
  SlotRule,
} from './avatar';
