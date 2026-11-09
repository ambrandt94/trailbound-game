import { skinText } from './glyphs';
import { creatorCommands, type CreatorView } from './creator-state';

function label(id: string): string {
  return id.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const REGIONS = [
  { id: 'full', label: 'All' },
  { id: 'upper', label: 'Upper' },
  { id: 'lower', label: 'Lower' },
] as const;

export function WardrobeScreen(props: { view: CreatorView; busy: boolean; confirmLabel: string }) {
  const view = props.view;
  const wornHere = view.garment.length > 0;
  return (
    <section class="creator tb-wardrobe" data-surface="paperdoll" data-region={view.focus}>
      <div class="tb-wardrobe-head">
        <p class="eyebrow tb-kicker">Character</p>
        <h2 class="tb-heading">Wardrobe</h2>
        <div class="preview-tools" role="group" aria-label="Region">
          {REGIONS.map((region) => {
            const waiting = region.id !== 'full' && !view.regionsReady;
            return (
              <button
                key={region.id}
                type="button"
                class={view.focus === region.id ? 'chip on' : 'chip'}
                aria-pressed={view.focus === region.id}
                disabled={waiting}
                onClick={() => creatorCommands.setFocus(region.id)}
              >
                {region.label}
              </button>
            );
          })}
          <button
            type="button"
            class={view.turntable ? 'chip on' : 'chip'}
            aria-pressed={view.turntable}
            onClick={() => creatorCommands.setTurntable(!view.turntable)}
          >
            Turn
          </button>
          {props.busy ? <span class="spinner" role="status" aria-label="Building avatar" /> : null}
        </div>
        <p class="tb-heading" data-selected-slot={view.slot}>
          {label(view.slot)}
          {wornHere ? ` · ${label(view.garment)}` : ' · Empty'}
        </p>
        {view.homes.length > 1 ? (
          <p class="note">Occupies {view.homes.map(label).join(', ')}.</p>
        ) : null}
      </div>
      <div class="tb-wardrobe-columns">
        <div class="tb-wardrobe-layers tb-scroll" role="listbox" aria-label="Layers">
          {view.slots.map((slot) => (
            <button
              key={slot}
              type="button"
              class={slot === view.slot ? 'action' : 'action secondary'}
              aria-pressed={slot === view.slot}
              onClick={() => creatorCommands.setSlot(slot)}
            >
              <span>{label(slot)}</span>
              <span>{view.worn[slot] ? label(view.worn[slot]) : 'empty'}</span>
            </button>
          ))}
        </div>
        <div class="tb-wardrobe-detail tb-scroll">
          {view.states.map((state) => (
            <label class="field" key={state.name}>
              <span>{label(state.name)}</span>
              <select
                aria-label={label(state.name)}
                value={state.value}
                onChange={(event) => {
                  const target = event.currentTarget;
                  if (target instanceof HTMLSelectElement) {
                    creatorCommands.setGarmentState(state.name, target.value);
                  }
                }}
              >
                {state.options.map((option) => (
                  <option key={option} value={option}>
                    {label(option)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <div class="tb-wardrobe-catalog" role="listbox" aria-label="Garments">
            {view.garments.map((id) => (
              <button
                key={id}
                type="button"
                class={id === view.garment ? 'chip on' : 'chip'}
                aria-pressed={id === view.garment}
                onClick={() => creatorCommands.setGarment(id)}
              >
                {label(id)}
              </button>
            ))}
          </div>
          {view.dyes.map((dye) => (
            <div class="field" key={dye.region}>
              <span>{label(dye.region)}</span>
              <div class="swatches" aria-label={label(dye.region)}>
                {dye.swatches.map((channels, index) => (
                  <button
                    key={`${dye.region}-${index}`}
                    type="button"
                    class="swatch"
                    style={{ background: `rgb(${channels.join(',')})` }}
                    aria-label={`${label(dye.region)} ${channels.join(' ')}`}
                    onClick={() => creatorCommands.setDye(dye.region, channels)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div class="actions">
            <button
              type="button"
              class="action secondary"
              disabled={!wornHere}
              onClick={() => creatorCommands.setGarment('')}
            >
              Unequip
            </button>
          </div>
          {view.notice ? <p class="note">{skinText(view.notice)}</p> : null}
          {view.warnings.map((warning) => (
            <p class="note" key={warning}>
              {skinText(warning)}
            </p>
          ))}
          {view.errors.map((error) => (
            <p class="note warn" key={error}>
              {skinText(error)}
            </p>
          ))}
        </div>
      </div>
      <div class="actions tb-wardrobe-foot">
        <button
          type="button"
          class="action secondary"
          disabled={!view.canUndo}
          onClick={() => creatorCommands.undo()}
        >
          Undo
        </button>
        <button
          type="button"
          class="action secondary"
          disabled={!view.canRedo}
          onClick={() => creatorCommands.redo()}
        >
          Redo
        </button>
        <button
          type="button"
          class="action secondary"
          onClick={() => creatorCommands.closePaperdoll()}
        >
          Body
        </button>
        <button type="button" class="action" onClick={() => creatorCommands.confirm()}>
          {props.confirmLabel}
        </button>
        <button type="button" class="action secondary" onClick={() => creatorCommands.cancel()}>
          Back
        </button>
      </div>
    </section>
  );
}
