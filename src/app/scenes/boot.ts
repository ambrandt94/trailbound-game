import { preloadForge } from '../../render/characters/forge';
import { bootError, bootMessage } from '../../ui/state';
import { bootRoute } from '../boot-route';
import type { GameHost } from '../host';
import { loadRoad } from '../load-road';
import type { Scene } from '../scene-stack';
import { DojoScene } from './dojo';
import { TitleScene } from './title';

export class BootScene implements Scene {
  readonly id = 'boot';

  constructor(private readonly host: GameHost) {}

  async enter(): Promise<void> {
    this.host.setMode('boot');
    bootMessage.value = 'Loading the road…';
    bootError.value = null;
    try {
      const search = globalThis.location?.search ?? '';
      if (bootRoute(search) === 'dojo') {
        bootMessage.value = 'Opening the dojo…';
        try {
          await preloadForge();
        } catch {
          // The room still opens. Bodies fall back to placeholder pawns.
        }
        await this.host.stack.replace(new DojoScene(this.host));
        return;
      }
      await Promise.all([loadRoad(this.host), preloadForge()]);
      const town = new URLSearchParams(search).get('town');
      if (town) {
        await this.host.enterTownNow(town);
        return;
      }
      await this.host.stack.replace(new TitleScene(this.host));
    } catch (error) {
      bootError.value = error instanceof Error ? error.message : 'Failed to boot';
      this.host.setMode('boot');
    }
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
