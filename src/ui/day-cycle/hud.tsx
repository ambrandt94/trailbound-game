import { useEffect, useRef, useState } from 'preact/hooks';
import { clockLabelFor, litUnits } from '../../core/sim/day-cycle';
import { dayCycle, dayCycleOptions, travelHud } from '../state';
import './day-cycle.css';
import { HUD_NATIVE_H, HUD_NATIVE_W, chooseHudScale } from './layout';
import { DayCycleRenderer } from './render';
import { loadHudSprites } from './sprites';

// Debug hook, like the other `__tb*` globals:
//   __tbDayCycle.options.value = { ...__tbDayCycle.options.value, season: 'winter', fogUnits: 15 }
//   __tbDayCycle.forceBiome('Desert')  // a biome name or recipe id; forceBiome(null) follows the party again
Object.assign(globalThis, {
  __tbDayCycle: {
    options: dayCycleOptions,
    view: dayCycle,
    forceBiome(biome: string | null): void {
      dayCycleOptions.value = { ...dayCycleOptions.value, biome };
    },
  },
});

function viewScale(): number {
  return chooseHudScale(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
}

/**
 * Serpentine day-cycle HUD. Draws at native size on a small canvas, shown at a
 * whole-pixel scale. The sprites come from `public/assets/ui/hud-day-cycle`.
 */
export function DayCycleHud() {
  const view = dayCycle.value;
  const options = dayCycleOptions.value;
  const travel = travelHud.value;
  const paused =
    view?.view === 'map' && travel !== null && travel.view === 'map' && travel.clockPaused;
  const canvas = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<(() => void) | null>(null);
  const [scale, setScale] = useState(viewScale);

  useEffect(() => {
    const onResize = () => setScale(viewScale());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load art once, then repaint on a short timer so the pulse animates.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    loadHudSprites(import.meta.env.BASE_URL)
      .then((art) => {
        if (!alive) return;
        const renderer = new DayCycleRenderer(art);
        const paint = () => {
          const el = canvas.current;
          const now = dayCycle.peek();
          const ctx = el?.getContext('2d');
          if (!el || !ctx || !now) return;
          renderer.draw(ctx, {
            tuRemaining: now.tuRemaining,
            day: now.day,
            season: dayCycleOptions.peek().season,
            fogUnits: dayCycleOptions.peek().fogUnits,
            biome: dayCycleOptions.peek().biome ?? now.biome,
            timeMs: performance.now(),
            reducedMotion: reduced,
          });
        };
        redraw.current = paint;
        paint();
        timer = window.setInterval(() => {
          if (!document.hidden) paint();
        }, 140);
      })
      .catch((error: unknown) => {
        console.warn(error);
      });
    return () => {
      alive = false;
      redraw.current = null;
      window.clearInterval(timer);
    };
  }, []);

  // Repaint straight away when the clock, season, or fog changes.
  const tu = view?.tuRemaining ?? 100;
  const day = view?.day ?? 1;
  const biome = options.biome ?? view?.biome ?? null;
  useEffect(() => {
    redraw.current?.();
  }, [tu, day, options.season, options.fogUnits, biome]);

  if (!view) return null;
  const dpr = window.devicePixelRatio || 1;
  const cssW = (HUD_NATIVE_W * scale) / dpr;
  const cssH = (HUD_NATIVE_H * scale) / dpr;
  const units = litUnits(tu);
  const label = `Day ${day}, ${units} of 100 time units left, ${clockLabelFor(units).long}${paused ? ', paused' : ''}`;
  return (
    <div
      class="dc-hud"
      role="img"
      aria-label={label}
      data-tu={units}
      data-clock={clockLabelFor(units).long}
      data-day={day}
      data-scale={scale}
      data-biome={biome ?? ''}
      style={{ width: `${cssW}px`, height: `${cssH}px` }}
    >
      <canvas
        ref={canvas}
        class="dc-canvas"
        width={HUD_NATIVE_W}
        height={HUD_NATIVE_H}
        style={{ width: `${cssW}px`, height: `${cssH}px` }}
      />
      {paused ? (
        <span class="dc-paused" title="The clock only runs while you or the caravan travel">
          Paused, not moving
        </span>
      ) : null}
    </div>
  );
}
