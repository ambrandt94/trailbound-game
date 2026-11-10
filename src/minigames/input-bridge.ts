import type { MinigamePointer, MinigameStick } from './types';

/**
 * The slice of Keyboard the minigames read. Axes stay held.
 * Jump, use, and roll are pulses, the same ones the town consumes.
 */
export interface MinigameActionSource {
  areaActions(): {
    p1: { x: number; z: number; jump: boolean; roll: boolean; use: boolean };
    p2: { jump: boolean; roll: boolean; use: boolean };
  };
  consumePress(code: string): boolean;
  /** Space held. Reel and other holds read this; pulses stay on areaActions. */
  isDown?(code: string): boolean;
}

export interface PointerSample {
  x: number;
  y: number;
  down: boolean;
  dx: number;
  dy: number;
  tap: boolean;
  /** Set the frame the finger goes down. Non-drag games treat it as the action. */
  press: boolean;
  /** Pixel offset from the pointer-down point. Drag games turn this into the stick. */
  dragX: number;
  dragY: number;
  moved: boolean;
}

export class PointerTracker {
  private x = 0.5;
  private y = 0.5;
  private down = false;
  private dx = 0;
  private dy = 0;
  private tap = false;
  private press = false;
  private originX = 0;
  private originY = 0;
  private downClientX = 0;
  private downClientY = 0;
  private dragX = 0;
  private dragY = 0;
  private moved = false;
  private element: HTMLElement | null = null;

  attach(element: HTMLElement): void {
    this.detach();
    this.element = element;
    element.addEventListener('pointerdown', this.onDown);
    element.addEventListener('pointermove', this.onMove);
    element.addEventListener('pointerup', this.onUp);
    element.addEventListener('pointercancel', this.onUp);
  }

  detach(): void {
    const element = this.element;
    if (!element) return;
    element.removeEventListener('pointerdown', this.onDown);
    element.removeEventListener('pointermove', this.onMove);
    element.removeEventListener('pointerup', this.onUp);
    element.removeEventListener('pointercancel', this.onUp);
    this.element = null;
    this.down = false;
  }

  sample(): PointerSample {
    const tap = this.tap;
    const press = this.press;
    const dx = this.dx;
    const dy = this.dy;
    this.tap = false;
    this.press = false;
    this.dx = 0;
    this.dy = 0;
    return {
      x: this.x,
      y: this.y,
      down: this.down,
      dx,
      dy,
      tap,
      press,
      dragX: this.dragX,
      dragY: this.dragY,
      moved: this.moved,
    };
  }

  private readonly onDown = (event: PointerEvent): void => {
    const point = this.local(event);
    this.down = true;
    this.moved = false;
    this.press = true;
    this.dragX = 0;
    this.dragY = 0;
    this.downClientX = event.clientX;
    this.downClientY = event.clientY;
    this.originX = point.x;
    this.originY = point.y;
    this.x = point.x;
    this.y = point.y;
    this.element?.setPointerCapture?.(event.pointerId);
  };

  private readonly onMove = (event: PointerEvent): void => {
    if (!this.down) return;
    const point = this.local(event);
    this.dx += point.x - this.x;
    this.dy += point.y - this.y;
    this.dragX = event.clientX - this.downClientX;
    this.dragY = event.clientY - this.downClientY;
    if (Math.hypot(this.dragX, this.dragY) > 12) this.moved = true;
    this.x = point.x;
    this.y = point.y;
  };

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.down) return;
    const point = this.local(event);
    this.dx += point.x - this.x;
    this.dy += point.y - this.y;
    this.x = point.x;
    this.y = point.y;
    this.down = false;
    this.dragX = 0;
    this.dragY = 0;
    if (!this.moved) this.tap = true;
  };

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.element?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return { x: 0.5, y: 0.5 };
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }
}

export interface BridgedInput {
  in: MinigameStick;
  pointer: MinigamePointer;
  act: boolean;
  quit: boolean;
}

/** Read one frame. Pulses are consumed here so the town does not also see them. */
export function readMinigameInput(
  source: MinigameActionSource,
  pointer: PointerSample,
  drag: boolean,
  quitButton: boolean,
): BridgedInput {
  const actions = source.areaActions();
  const pad = actions.p1;
  const dragX = drag && pointer.moved ? clampAxis(pointer.dragX / 50) : 0;
  const dragY = drag && pointer.moved ? clampAxis(-pointer.dragY / 50) : 0;
  const x = clampAxis(pad.x + dragX);
  const y = clampAxis(pad.z + dragY);
  const act =
    pad.jump ||
    pad.use ||
    actions.p2.jump ||
    actions.p2.use ||
    (drag ? pointer.tap : pointer.press);
  const quit = quitButton || pad.roll || actions.p2.roll || source.consumePress('Escape');
  const hold = (source.isDown?.('Space') ?? false) || pointer.down;
  return {
    in: { x, y, hold },
    pointer: { ...pointer },
    act,
    quit,
  };
}

function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}
