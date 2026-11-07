/** Body-level overlays the area module paints while walking off an edge. */
export const AREA_LEAVE_OVERLAYS = [
  'tb-leave-fade',
  'tb-leave-vig',
  'tb-leave-warn',
  'tb-back-card',
] as const;

/**
 * The edge fade is appended outside the game root and left at full black
 * after the area session is disposed. Remove it so the map can show through.
 */
export function clearAreaLeaveOverlay(doc: Document): void {
  for (const id of AREA_LEAVE_OVERLAYS) {
    const el = doc.getElementById(id);
    if (!el) continue;
    if (el instanceof HTMLElement) {
      el.style.opacity = '0';
      el.style.display = 'none';
    }
    el.remove();
  }
}
