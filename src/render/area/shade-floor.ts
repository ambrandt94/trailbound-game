/**
 * Linear max-channel floor in the cel lighting pass, before the screen grade
 * `pow(c, 0.38)`. A floor of 0.08 displays as about 0.38, a daytime midtone,
 * so a night scene that falls under it is lifted into a flat wash. This stays
 * dark without resolving to black.
 */
export const SHADE_VALUE_FLOOR = 0.018;

/** Exponent in the area screen composite. Shared with the floor's display check. */
export const SCREEN_GRADE_EXPONENT = 0.38;

/** How bright the floor is after the screen grade. */
export function shadeFloorDisplay(floor = SHADE_VALUE_FLOOR): number {
  return Math.pow(Math.max(floor, 0), SCREEN_GRADE_EXPONENT);
}
