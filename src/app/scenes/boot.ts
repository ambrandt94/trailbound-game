import { parsePlace } from '../../core/content/parse';
import { createWorld } from '../../core/state/world-state';
import { bootError, bootMessage, canContinue } from '../../ui/state';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';
import { TitleScene } from './title';

export class BootScene implements Scene {
  readonly id = 'boot';

  constructor(private readonly host: GameHost) {}

  async enter(): Promise<void> {
    this.host.setMode('boot');
    bootMessage.value = 'Loading the road…';
    bootError.value = null;
    try {
      const index = await this.host.content.loadIndex();
      if (!index.entries.some((entry) => entry.id === 'places/waystead')) {
        throw new Error('content index is missing places/waystead');
      }
      const place = parsePlace(await this.host.content.load('places/waystead'));
      this.host.place = place;
      this.host.world = createWorld({
        id: place.id,
        name: place.name,
        x: place.map.x,
        y: place.map.y,
      });
      const slots = await this.host.saves.listSlots();
      canContinue.value = slots.some((slot) => slot.manifest.schema > 0);
      const town = new URLSearchParams(globalThis.location?.search ?? '').get('town');
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
