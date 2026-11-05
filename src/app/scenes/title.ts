import { settingsOpen } from '../../ui/state';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';

export class TitleScene implements Scene {
  readonly id = 'title';

  constructor(private readonly host: GameHost) {}

  enter(): void {
    this.host.setMode('title');
    settingsOpen.value = false;
    this.host.keyboard.clearPresses();
  }

  update(_dt: number): void {
    return;
  }

  render(_alpha: number): void {
    return;
  }

  exit(): void {
    return;
  }
}
