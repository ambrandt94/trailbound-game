import { expect, test } from 'vitest';
import { SHADE_VALUE_FLOOR, shadeFloorDisplay } from '../../src/render/area/shade-floor';

test('the cel floor stays dark after the screen grade without crushing to black', () => {
  const shown = shadeFloorDisplay();
  expect(SHADE_VALUE_FLOOR).toBeLessThan(0.04);
  expect(shown).toBeGreaterThan(0.16);
  expect(shown).toBeLessThan(0.28);
  expect(shadeFloorDisplay(0.08)).toBeGreaterThan(0.35);
});
