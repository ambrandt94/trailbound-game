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

  /** Area axes. North is -z. Kept for callers that want world-aligned arrows. */
  areaAxis(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z += 1;
    return { x, z };
  }

  /**
   * Camera-relative town controls. Pulses (jump, roll, use, view, mode) are
   * consumed. The touch pad reaches this through setHeld, not a second map.
   */
  areaActions(): AreaActionSnapshot {
    this.viewPulse = false;
    this.modePulse = false;
    const pads = this.gamepads();
    const p1 = pads[0] ?? blankPad();
    const p2 = pads[1] ?? blankPad();
    p1.x += (this.isDown('KeyD') ? 1 : 0) - (this.isDown('KeyA') ? 1 : 0);
    p1.z += (this.isDown('KeyW') ? 1 : 0) - (this.isDown('KeyS') ? 1 : 0);
    p2.x += (this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('ArrowLeft') ? 1 : 0);
    p2.z += (this.isDown('ArrowUp') ? 1 : 0) - (this.isDown('ArrowDown') ? 1 : 0);
    if (this.isDown('ShiftLeft')) p1.sprint = true;
    if (this.isDown('ShiftRight')) p2.sprint = true;
    if (this.isDown('ControlLeft')) p1.sneak = true;
    if (this.isDown('ControlRight')) p2.sneak = true;
    if (this.isDown('KeyR')) p1.emote = true;
    if (this.isDown('Slash')) p2.emote = true;
    if (this.consumePress('Space')) p1.jump = true;
    if (this.consumePress('Enter')) p2.jump = true;
    if (this.consumePress('AltLeft')) p1.roll = true;
    if (this.consumePress('AltRight')) p2.roll = true;
    if (this.consumePress('KeyF')) p1.use = true;
    if (this.consumePress('Period')) p2.use = true;
    return {
      p1: clampPad(p1),
      p2: clampPad(p2),
      camLeft: this.isDown('KeyQ'),
      camRight: this.isDown('KeyE'),
      camUp: this.isDown('KeyX'),
      camDown: this.isDown('KeyZ'),
      view: this.consumePress('KeyV') || this.viewPulse,
      mode: this.consumePress('KeyC') || this.modePulse,
    };
  }

  private readonly padDown = {
    jump: [false, false],
    roll: [false, false],
    use: [false, false],
    view: [false, false],
    mode: [false, false],
  };

  private viewPulse = false;
  private modePulse = false;

  private gamepads(): [AreaActionPad, AreaActionPad] {
    const pads: [AreaActionPad, AreaActionPad] = [blankPad(), blankPad()];
    const nav = globalThis.navigator;
    if (!nav?.getGamepads) return pads;
    let list: Array<Gamepad | null> = [];
    try {
      list = [...nav.getGamepads()];
    } catch {
      return pads;
    }
    const sticks = list.filter((pad): pad is Gamepad => pad !== null).slice(0, 2);
    sticks.forEach((pad, index) => {
      const out = pads[index];
      if (!out) return;
      const dead = (value: number) => (Math.abs(value) < 0.18 ? 0 : value);
      out.x += dead(pad.axes[0] ?? 0);
      out.z += -dead(pad.axes[1] ?? 0);
      const jump = !!pad.buttons[0]?.pressed;
      const roll = !!(pad.buttons[1]?.pressed || pad.buttons[5]?.pressed);
      const use = !!pad.buttons[2]?.pressed;
      const emote = !!pad.buttons[3]?.pressed;
      const view = !!pad.buttons[11]?.pressed;
      const mode = !!pad.buttons[8]?.pressed;
      if (pad.buttons[4]?.pressed) out.sprint = true;
      if (pad.buttons[6]?.pressed) out.sneak = true;
      if (emote) out.emote = true;
      if (jump && !this.padDown.jump[index]) out.jump = true;
      if (roll && !this.padDown.roll[index]) out.roll = true;
      if (use && !this.padDown.use[index]) out.use = true;
      if (index === 0 && view && !this.padDown.view[0]) this.viewPulse = true;
      if (index === 0 && mode && !this.padDown.mode[0]) this.modePulse = true;
      this.padDown.jump[index] = jump;
      this.padDown.roll[index] = roll;
      this.padDown.use[index] = use;
      this.padDown.view[index] = view;
      this.padDown.mode[index] = mode;
    });
    return pads;
  }
}

export interface AreaActionPad {
  x: number;
  z: number;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
  roll: boolean;
  use: boolean;
  emote: boolean;
}

export interface AreaActionSnapshot {
  p1: AreaActionPad;
  p2: AreaActionPad;
  camLeft: boolean;
  camRight: boolean;
  camUp: boolean;
  camDown: boolean;
  view: boolean;
  mode: boolean;
}

function blankPad(): AreaActionPad {
  return {
    x: 0,
    z: 0,
    jump: false,
    sprint: false,
    sneak: false,
    roll: false,
    use: false,
    emote: false,
  };
}

function clampPad(pad: AreaActionPad): AreaActionPad {
  return { ...pad, x: Math.max(-1, Math.min(1, pad.x)), z: Math.max(-1, Math.min(1, pad.z)) };
}
