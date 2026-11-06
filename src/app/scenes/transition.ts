import type { AreaExit } from '../area-exit';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';
import { FADE_SECONDS } from '../travel';

export type TransitionDirection = 'to-area' | 'to-map';

/** Fade to black, build or dispose the target while black, then fade in. */
export class TransitionScene implements Scene {
  readonly id = 'transition';
  private phase: 'out' | 'hold' | 'in' = 'out';
  private elapsed = 0;
  private held = false;
  private ready = false;
  private finished = false;

  constructor(
    private readonly host: GameHost,
    private readonly direction: TransitionDirection,
    private readonly exitPayload?: AreaExit,
  ) {}

  enter(): void {
    this.host.setMode('transition');
    this.host.setFade(0);
  }

  update(dt: number): void {
    if (this.finished) return;
    if (this.phase === 'out') {
      this.elapsed += dt;
      this.host.setFade(Math.min(1, this.elapsed / FADE_SECONDS));
      if (this.elapsed >= FADE_SECONDS) this.phase = 'hold';
      return;
    }
    if (this.phase === 'hold') {
      if (!this.held) {
        this.held = true;
        if (this.direction === 'to-area') {
          void this.host.buildArea().finally(() => {
            this.ready = true;
          });
        } else {
          this.host.leaveArea(this.exitPayload);
          this.ready = true;
        }
      }
      this.host.setFade(1);
      if (!this.ready) return;
      this.phase = 'in';
      this.elapsed = 0;
      return;
    }
    this.elapsed += dt;
    this.host.setFade(1 - Math.min(1, this.elapsed / FADE_SECONDS));
    if (this.elapsed >= FADE_SECONDS) {
      this.finished = true;
      this.host.setFade(0);
      this.host.enqueue(() => {
        void this.host.stack.pop();
        const next = this.host.stack.current();
        if (
          next &&
          (next.id === 'boot' || next.id === 'title' || next.id === 'map' || next.id === 'area')
        ) {
          this.host.setMode(next.id);
        }
      });
    }
  }

  render(_alpha: number): void {
    return;
  }

  exit(): void {
    this.host.setFade(0);
  }
}
