import type { FighterInput } from '../core/combat/types';
import type { Keyboard } from './keyboard';

export interface DojoPad {
  a: boolean;
  d: boolean;
  w: boolean;
  s: boolean;
  j: boolean;
  k: boolean;
  mouseX: boolean;
  mouseY: boolean;
  /** Already an edge: Space, L, or gamepad B this frame. */
  counterEdge: boolean;
  stickX: number;
  /** Forward is positive, matching W. */
  stickZ: number;
  padX: boolean;
  padY: boolean;
}

export interface DojoStick {
  /** Strafe. D is positive. Not yet camera-relative. */
  ix: number;
  /** Forward. W is positive. */
  iz: number;
  xDown: boolean;
  yDown: boolean;
  counterPressed: boolean;
}

export function mapDojoInput(pad: DojoPad): DojoStick {
  let ix = (pad.d ? 1 : 0) - (pad.a ? 1 : 0) + pad.stickX;
  let iz = (pad.w ? 1 : 0) - (pad.s ? 1 : 0) + pad.stickZ;
  const mag = Math.hypot(ix, iz);
  if (mag > 1) {
    ix /= mag;
    iz /= mag;
  }
  return {
    ix,
    iz,
    xDown: pad.j || pad.mouseX || pad.padX,
    yDown: pad.k || pad.mouseY || pad.padY,
    counterPressed: pad.counterEdge,
  };
}

export function stickToInput(stick: DojoStick, wish: { x: number; z: number }): FighterInput {
  return {
    moveX: wish.x,
    moveZ: wish.z,
    xDown: stick.xDown,
    yDown: stick.yDown,
    counterPressed: stick.counterPressed,
  };
}

/**
 * Keyboard, mouse, and the standard gamepad into one stick.
 * Gamepad X and Y are the two attacks. B is the counter. The left stick moves.
 */
export class DojoInput {
  private readonly buttons = new Set<number>();
  private padCounter = false;
  private canvas: HTMLElement | null = null;

  constructor(private readonly keyboard: Keyboard) {}

  attach(canvas: HTMLElement): void {
    this.detach();
    this.canvas = canvas;
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('contextmenu', this.onContext);
  }

  detach(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('contextmenu', this.onContext);
    this.canvas = null;
    this.buttons.clear();
    this.padCounter = false;
  }

  sample(): DojoStick {
    if (typingTarget()) return mapDojoInput(blankPad());
    const pad = this.readPad();
    const counterEdge =
      this.keyboard.consumePress('Space') || this.keyboard.consumePress('KeyL') || pad.counterEdge;
    return mapDojoInput({
      a: this.keyboard.isDown('KeyA'),
      d: this.keyboard.isDown('KeyD'),
      w: this.keyboard.isDown('KeyW'),
      s: this.keyboard.isDown('KeyS'),
      j: this.keyboard.isDown('KeyJ'),
      k: this.keyboard.isDown('KeyK'),
      mouseX: this.buttons.has(0),
      mouseY: this.buttons.has(2),
      counterEdge,
      stickX: pad.x,
      stickZ: pad.z,
      padX: pad.xDown,
      padY: pad.yDown,
    });
  }

  private readonly onContext = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 2) return;
    this.buttons.add(event.button);
    if (event.button === 2) event.preventDefault();
  };

  private readonly onUp = (event: PointerEvent): void => {
    this.buttons.delete(event.button);
  };

  private readPad(): {
    x: number;
    z: number;
    xDown: boolean;
    yDown: boolean;
    counterEdge: boolean;
  } {
    const empty = { x: 0, z: 0, xDown: false, yDown: false, counterEdge: false };
    const nav = globalThis.navigator;
    if (!nav?.getGamepads) return empty;
    let list: Array<Gamepad | null> = [];
    try {
      list = [...nav.getGamepads()];
    } catch {
      return empty;
    }
    const pad = list.find((item): item is Gamepad => item !== null);
    if (!pad) {
      this.padCounter = false;
      return empty;
    }
    const dead = (value: number) => (Math.abs(value) < 0.18 ? 0 : value);
    const counter = !!pad.buttons[1]?.pressed;
    const counterEdge = counter && !this.padCounter;
    this.padCounter = counter;
    return {
      x: dead(pad.axes[0] ?? 0),
      z: -dead(pad.axes[1] ?? 0),
      xDown: !!pad.buttons[2]?.pressed,
      yDown: !!pad.buttons[3]?.pressed,
      counterEdge,
    };
  }
}

function blankPad(): DojoPad {
  return {
    a: false,
    d: false,
    w: false,
    s: false,
    j: false,
    k: false,
    mouseX: false,
    mouseY: false,
    counterEdge: false,
    stickX: 0,
    stickZ: 0,
    padX: false,
    padY: false,
  };
}

function typingTarget(): boolean {
  const target = globalThis.document?.activeElement;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    return true;
  }
  return (
    target instanceof HTMLInputElement &&
    !['checkbox', 'radio', 'range', 'button', 'color'].includes(target.type)
  );
}
