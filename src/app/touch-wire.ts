import type { TouchAction } from '../input/touch/index';

/** Maps pad actions onto the same key codes the keyboard already uses. */
export function codeForTouchAction(action: TouchAction): string {
  switch (action) {
    case 'up':
      return 'KeyW';
    case 'down':
      return 'KeyS';
    case 'left':
      return 'KeyA';
    case 'right':
      return 'KeyD';
    case 'confirm':
      return 'Enter';
    case 'cancel':
      return 'Escape';
    default: {
      const unknown: never = action;
      return unknown;
    }
  }
}
