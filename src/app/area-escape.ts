/** Escape leaves the area only when a minigame and the settings panel are not using it. */
export function areaEscapeAction(state: {
  minigameOpen: boolean;
  settingsOpen: boolean;
  escape: boolean;
}): 'stay' | 'close-settings' | 'leave' {
  if (state.minigameOpen || !state.escape) return 'stay';
  if (state.settingsOpen) return 'close-settings';
  return 'leave';
}
