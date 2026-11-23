/**
 * Every biome the generator can produce, with its colour swatch and name.
 * Hover (or keyboard focus) highlights a biome on the map; a tap pins it.
 */
import { biomeLegend } from '../core/planet';
import { biomeFocus, biomeHover, biomePinned, toggleBiomePin } from './biome-overlay-state';

export function BiomeLegend(props: { class?: string }) {
  const focus = biomeFocus.value;
  const pinned = biomePinned.value;
  return (
    <section
      class={`hud-box biome-legend${props.class ? ` ${props.class}` : ''}`}
      aria-label="Biome legend"
      data-focus={focus ?? ''}
    >
      <h4>Biomes</h4>
      <ul>
        {biomeLegend().map((e) => (
          <li key={e.id}>
            <button
              type="button"
              class={`biome-key${focus === e.id ? ' on' : ''}`}
              aria-pressed={pinned === e.id}
              data-biome={e.id}
              onPointerEnter={(ev) => {
                // Touch taps pin instead; a touch "hover" would stick.
                if (ev.pointerType === 'mouse') biomeHover.value = e.id;
              }}
              onPointerLeave={() => {
                biomeHover.value = null;
              }}
              onClick={() => toggleBiomePin(e.id)}
            >
              <span
                class="biome-swatch"
                aria-hidden="true"
                style={{ background: `rgb(${e.rgb[0]}, ${e.rgb[1]}, ${e.rgb[2]})` }}
              />
              <span class="biome-name">{e.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
