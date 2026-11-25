/**
 * World Gen debug overlay for synthetic city plans. Hidden until City plans is on.
 */
import { cityPlan, SETTLEMENT_CLASSES } from '../core/world/city-plan';
import { paintCityPlan } from './city-plan-paint';
import { cityPlanClass, cityPlanSeed, cityPlansOn } from './city-plan-state';

export function CityPlanToggle() {
  const on = cityPlansOn.value;
  return (
    <label class="wg-check">
      <input
        type="checkbox"
        checked={on}
        aria-label="City plans"
        onChange={(event) => {
          const target = event.currentTarget;
          if (target instanceof HTMLInputElement) cityPlansOn.value = target.checked;
        }}
      />
      City plans
    </label>
  );
}

export function CityPlanPanel() {
  if (!cityPlansOn.value) return null;
  const settlementClass = cityPlanClass.value;
  const seed = cityPlanSeed.value;
  const plan = cityPlan(Number.isFinite(seed) ? seed : 1, settlementClass);
  const paint = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const image = paintCityPlan(plan);
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const copy = new Uint8ClampedArray(image.rgba);
    ctx.putImageData(new ImageData(copy, image.width, image.height), 0, 0);
  };
  return (
    <aside class="wg-city-panel tb-scroll" aria-label="City plans">
      <h3>City plans</h3>
      <p class="note">Synthetic only. The map and saves stay on settlement generation 1.</p>
      <label class="field">
        <span>Class</span>
        <select
          aria-label="Settlement class"
          value={settlementClass}
          onChange={(event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLSelectElement)) return;
            const next = SETTLEMENT_CLASSES.find((item) => item === target.value);
            if (next) cityPlanClass.value = next;
          }}
        >
          {SETTLEMENT_CLASSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        <span>Seed</span>
        <input
          type="number"
          aria-label="City seed"
          value={seed}
          onChange={(event) => {
            const target = event.currentTarget;
            if (target instanceof HTMLInputElement) cityPlanSeed.value = Number(target.value);
          }}
        />
      </label>
      <canvas ref={paint} class="wg-city-canvas" aria-label="City plan overlay" />
      <p class="note">
        {plan.wards.length} wards · passes {plan.passes}
        {plan.fallback ? ' · grid fallback' : ''} · {plan.warnings.length} warnings
      </p>
    </aside>
  );
}
