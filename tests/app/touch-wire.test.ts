import { expect, test } from 'vitest';
import { attachTouchControls } from '../../src/input/touch/index';
import { codeForTouchAction } from '../../src/app/touch-wire';

test('touch actions map onto the keyboard codes the shell already listens for', () => {
  expect(codeForTouchAction('up')).toBe('KeyW');
  expect(codeForTouchAction('down')).toBe('KeyS');
  expect(codeForTouchAction('left')).toBe('KeyA');
  expect(codeForTouchAction('right')).toBe('KeyD');
  expect(codeForTouchAction('confirm')).toBe('Enter');
  expect(codeForTouchAction('cancel')).toBe('Escape');
});

test('the touch entrypoint is wired as an unsubscribe and does not throw', () => {
  const root = { nodeType: 1 } as HTMLElement;
  const stop = attachTouchControls(root, {
    setHeld() {
      return;
    },
  });
  expect(typeof stop).toBe('function');
  stop();
});
