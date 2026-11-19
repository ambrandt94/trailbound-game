import { render } from 'preact';
import { createFetchContentSource } from '../platform/content-source';
import { createBrowserSettings } from '../platform/settings';
import { createIdbSaveBackend } from '../platform/storage/idb';
import { Shell } from '../ui/shell';
import { commands, settings } from '../ui/state';
import '../ui/styles.css';
import '../ui/theme/pixel-skin.css';
import '../ui/hud.css';
import { systemClock } from './fixed-step';
import { Game } from './game';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app');

const mapCanvas = document.createElement('canvas');
mapCanvas.id = 'map';
mapCanvas.className = 'view';

const areaCanvas = document.createElement('canvas');
areaCanvas.id = 'area';
areaCanvas.className = 'view';
areaCanvas.style.visibility = 'hidden';

const ui = document.createElement('div');
ui.id = 'ui';

const fade = document.createElement('div');
fade.id = 'fade';

root.append(mapCanvas, areaCanvas, ui, fade);

const game = new Game({
  clock: systemClock(),
  root,
  mapCanvas,
  areaCanvas,
  fade,
  baseUrl: import.meta.env.BASE_URL,
  content: createFetchContentSource(import.meta.env.BASE_URL),
  saves: createIdbSaveBackend(),
  settings: createBrowserSettings(globalThis.localStorage ?? null),
});

render(<Shell />, ui);
Object.assign(globalThis, { __TRAILBOUND__: game });
// Debug hook, like the other `__tb*` globals: `__tbPace.set({ mapSpeed: 8, timeOnlyWhenMoving: false })`.
Object.assign(globalThis, {
  __tbPace: {
    get: () => ({
      mapSpeed: settings.value.mapSpeed,
      timeOnlyWhenMoving: settings.value.timeOnlyWhenMoving,
    }),
    set: (partial: { mapSpeed?: number; timeOnlyWhenMoving?: boolean }) => {
      commands.changeSettings(partial as Parameters<typeof commands.changeSettings>[0]);
    },
  },
});
void game.start();
