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
}

export interface PointerSample {
  x: number;
  y: number;
  down: boolean;
  dx: number;
  dy: number;
  tap: boolean;
}

export class PointerTracker {
  private x = 0.5;
  private y = 0.5;
  private down = false;
  private dx = 0;
  private dy = 0;
  private tap = false;
  private originX = 0;
  private originY = 0;
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
    const dx = this.dx;
    const dy = this.dy;
    this.tap = false;
    this.dx = 0;
    this.dy = 0;
    return { x: this.x, y: this.y, down: this.down, dx, dy, tap };
  }

  private readonly onDown = (event: PointerEvent): void => {
    const point = this.local(event);
    this.down = true;
    this.moved = false;
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
    if (Math.hypot(point.x - this.originX, point.y - this.originY) > 0.03) this.moved = true;
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
  const x = clampAxis(pad.x);
  const y = clampAxis(pad.z);
  const tap = pointer.tap;
  const act = pad.jump || pad.use || actions.p2.jump || actions.p2.use || (!drag && tap);
  const quit = quitButton || pad.roll || actions.p2.roll || source.consumePress('Escape');
  return {
    in: { x, y, hold: Math.hypot(x, y) > 0.2 || pointer.down },
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
