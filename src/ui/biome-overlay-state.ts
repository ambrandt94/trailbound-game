/**
 * Biome overlay state shared by World Gen and the overworld map: whether the
 * map's wash is on, and which biome the legend singles out (hover beats a tap).
 */
import { computed, signal } from '@preact/signals';

/** The overworld map's biome wash (HUD toggle). World Gen uses its own Biome overlay layer. */
export const mapBiomeOverlay = signal(false);
/** Biome under the pointer in the legend. */
export const biomeHover = signal<number | null>(null);
/** Biome tapped in the legend (tap again to clear). */
export const biomePinned = signal<number | null>(null);
/** The biome to highlight: hovered, else pinned, else none. */
export const biomeFocus = computed<number | null>(() => biomeHover.value ?? biomePinned.value);

export function toggleBiomePin(id: number): void {
  biomePinned.value = biomePinned.value === id ? null : id;
}

export function clearBiomeFocus(): void {
  biomeHover.value = null;
  biomePinned.value = null;
}
