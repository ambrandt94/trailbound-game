const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/** Keyboard (and, through the touch wire, the touch pad) as held keys plus one-shot presses. */
export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private attached = false;

  private readonly onDown = (event: KeyboardEvent) => {
    if (SCROLL_KEYS.has(event.code)) event.preventDefault();
    if (event.repeat || this.down.has(event.code)) return;
    this.down.add(event.code);
    this.pressed.add(event.code);
  };

  private readonly onUp = (event: KeyboardEvent) => {
    this.down.delete(event.code);
  };

  private readonly onBlur = () => {
    this.down.clear();
    this.pressed.clear();
  };

  attach(target: Window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    this.attached = false;
    target.removeEventListener('keydown', this.onDown);
    target.removeEventListener('keyup', this.onUp);
    target.removeEventListener('blur', this.onBlur);
    this.down.clear();
    this.pressed.clear();
  }

  /** Drop one-shot presses so a key from the previous scene cannot fire in the next. */
  clearPresses(): void {
    this.pressed.clear();
  }

  /** Used by the touch-controls wire so the pad and the keyboard share one path. */
  setHeld(code: string, held: boolean): void {
    if (held) this.down.add(code);
    else this.down.delete(code);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  consumePress(code: string): boolean {
    if (code === 'Enter') {
      const enter = this.pressed.delete('Enter');
      const numpad = this.pressed.delete('NumpadEnter');
      return enter || numpad;
    }
    return this.pressed.delete(code);
  }

  /** Map axes. North is -y. */
  mapAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y += 1;
    return { x, y };
  }

  /** Area axes. North is -z. */
  areaAxis(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z += 1;
    return { x, z };
  }
}
