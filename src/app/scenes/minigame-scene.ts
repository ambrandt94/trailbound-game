import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';

const FADE = 0.35;

/**
 * Instance minigames pause the area by sitting on top of the scene stack.
 * The fade covers the town, the game plays, then the fade returns.
 */
export class MinigameScene implements Scene {
  readonly id = 'minigame';
  private phase: 'in' | 'play' | 'out' = 'in';
  private fade = 0;
  private popped = false;

  constructor(private readonly host: GameHost) {}

  enter(): void {
    this.host.minigames.setCover(0);
  }

  update(dt: number): void {
    const step = Math.min(0.05, Math.max(0, dt));
    if (this.phase === 'in') {
      this.fade = Math.min(1, this.fade + step / FADE);
      this.host.minigames.setCover(this.fade);
      if (this.fade >= 1) {
        this.phase = 'play';
        this.host.minigames.beginPlay();
      }
      return;
    }
    if (this.phase === 'play') {
      this.host.minigames.tick(step);
      this.fade = Math.max(0, this.fade - step / FADE);
      this.host.minigames.setCover(this.fade);
      if (this.host.minigames.wantsExit) {
        this.phase = 'out';
        this.fade = 0;
      }
      return;
    }
    this.fade = Math.min(1, this.fade + step / FADE);
    this.host.minigames.setCover(this.fade);
    if (this.fade >= 1 && !this.popped) {
      this.popped = true;
      this.host.minigames.finishExit();
      this.host.enqueue(() => {
        void this.host.stack.pop();
      });
    }
  }

  render(_alpha: number): void {
    this.host.minigames.render3d();
  }

  exit(): void {
    this.host.minigames.setCover(0);
    if (this.host.minigames.isOpen()) this.host.minigames.finishExit();
  }
}
