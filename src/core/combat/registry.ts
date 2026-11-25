import type { WeaponStyle } from './types';

const styles: WeaponStyle[] = [];

/** Called from each weapon file. One file is enough to add a style. */
export function registerWeapon(style: WeaponStyle): WeaponStyle {
  const index = styles.findIndex((item) => item.id === style.id);
  if (index >= 0) styles.splice(index, 1, style);
  else styles.push(style);
  return style;
}

export function weapons(): readonly WeaponStyle[] {
  return styles;
}

export function weaponById(id: string): WeaponStyle {
  const found = styles.find((style) => style.id === id);
  if (!found) throw new Error(`unknown weapon style ${id}`);
  return found;
}
