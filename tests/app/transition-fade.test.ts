import { expect, test } from 'vitest';
import { TransitionScene } from '../../src/app/scenes/transition';
import { FADE_SECONDS } from '../../src/app/travel';
import type { GameHost } from '../../src/app/host';

test('leaving an area fades back in and does not stay black', () => {
  const fades: number[] = [];
  let view: 'map' | 'area' = 'area';
  let left = false;
  const host = {
    setMode() {
      return;
    },
    setFade(opacity: number) {
      fades.push(opacity);
    },
    leaveArea() {
      left = true;
      view = 'map';
    },
    enqueue(job: () => void) {
      job();
    },
    stack: {
      current: () => ({ id: 'map' }),
      pop: async () => {
        return;
      },
    },
  } as unknown as GameHost;
  const scene = new TransitionScene(host, 'to-map', { side: 'east', pos: 0.5, yaw: 0 });
  scene.enter();
  const dt = FADE_SECONDS / 2;
  scene.update(dt);
  scene.update(dt);
  scene.update(dt);
  expect(left).toBe(true);
  expect(view).toBe('map');
  scene.update(dt);
  scene.update(dt);
  expect(fades.at(-1)).toBe(0);
  expect(fades.some((value) => value === 1)).toBe(true);
});
