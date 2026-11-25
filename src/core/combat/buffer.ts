import type { AttackButton, ButtonKind } from './types';

export interface AttackEdge {
  button: AttackButton;
  kind: ButtonKind;
  atMs: number;
}

export interface BufferOptions {
  holdThresholdMs: number;
  windowMs: number;
}

interface Track {
  down: boolean;
  pressedAt: number;
  heldEmitted: boolean;
}

/**
 * Tap versus hold. A press that is still down at `holdThresholdMs` releases
 * the heavy immediately. Releasing earlier is a tap. A release after the
 * heavy does not also emit a tap.
 */
export class AttackBuffer {
  private readonly tracks: Record<AttackButton, Track> = {
    x: { down: false, pressedAt: 0, heldEmitted: false },
    y: { down: false, pressedAt: 0, heldEmitted: false },
  };

  private edges: AttackEdge[] = [];

  constructor(private options: BufferOptions) {}

  setThreshold(holdThresholdMs: number): void {
    this.options.holdThresholdMs = holdThresholdMs;
  }

  update(nowMs: number, held: { x: boolean; y: boolean }): AttackEdge[] {
    const fresh: AttackEdge[] = [];
    const buttons: AttackButton[] = ['x', 'y'];
    for (const button of buttons) {
      const track = this.tracks[button];
      const isDown = held[button];
      if (isDown && !track.down) {
        track.down = true;
        track.pressedAt = nowMs;
        track.heldEmitted = false;
      } else if (isDown && track.down && !track.heldEmitted) {
        if (nowMs - track.pressedAt >= this.options.holdThresholdMs) {
          const edge: AttackEdge = { button, kind: 'hold', atMs: nowMs };
          fresh.push(edge);
          this.edges.push(edge);
          track.heldEmitted = true;
        }
      } else if (!isDown && track.down) {
        if (!track.heldEmitted) {
          const edge: AttackEdge = { button, kind: 'tap', atMs: nowMs };
          fresh.push(edge);
          this.edges.push(edge);
        }
        track.down = false;
      }
    }
    this.edges = this.edges.filter((edge) => nowMs - edge.atMs < this.options.windowMs);
    return fresh;
  }

  pending(nowMs: number): AttackEdge[] {
    return this.edges.filter((edge) => nowMs - edge.atMs < this.options.windowMs);
  }

  consume(edge: AttackEdge): void {
    const index = this.edges.indexOf(edge);
    if (index >= 0) this.edges.splice(index, 1);
  }

  clear(): void {
    this.edges = [];
    this.tracks.x = { down: false, pressedAt: 0, heldEmitted: false };
    this.tracks.y = { down: false, pressedAt: 0, heldEmitted: false };
  }
}
