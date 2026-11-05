import type { SlotMode } from '../core/people/avatar';
import { creatorBusy, creatorCommands, creatorSource, creatorView } from './creator-state';

function pretty(id: string): string {
  const bare = id.replace(/^(look|arche):/, '').replaceAll('_', ' ');
  return bare.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function LockButton(props: {
  field: 'race' | 'gender' | 'style' | 'richness' | 'slots';
  locked: boolean;
}) {
  return (
    <button
      type="button"
      class={props.locked ? 'lock on' : 'lock'}
      aria-pressed={props.locked}
      aria-label={`Lock ${props.field}`}
      onClick={() => creatorCommands.toggleLock(props.field)}
    >
      {props.locked ? 'Locked' : 'Lock'}
    </button>
  );
}

export function CreatorScreen() {
  const view = creatorView.value;
  const busy = creatorBusy.value;
  const source = creatorSource.value;
  const confirmLabel = view.intent === 'edit' ? 'Save avatar' : 'Take the road';
  return (
    <section class="creator">
      <div class="creator-copy">
        <p class="eyebrow">Character</p>
        <h2>{view.intent === 'edit' ? 'Edit avatar' : 'Who walks this road?'}</h2>
        <p class="lede tight">
          Adult travellers only. Drag the view to turn them, or use the arrow keys.
        </p>
      </div>

      <div class="preview-tools">
        <button
          type="button"
          class={view.clip === 'Idle' ? 'chip on' : 'chip'}
          aria-pressed={view.clip === 'Idle'}
          onClick={() => creatorCommands.setClip('Idle')}
        >
          Idle
        </button>
        <button
          type="button"
          class={view.clip === 'Walk' ? 'chip on' : 'chip'}
          aria-pressed={view.clip === 'Walk'}
          onClick={() => creatorCommands.setClip('Walk')}
        >
          Walk
        </button>
        <button
          type="button"
          class={view.turntable ? 'chip on' : 'chip'}
          aria-pressed={view.turntable}
          onClick={() => creatorCommands.setTurntable(!view.turntable)}
        >
          Turntable
        </button>
        <button type="button" class="chip" onClick={() => creatorCommands.frame('face')}>
          Zoom to face
        </button>
        <button type="button" class="chip" onClick={() => creatorCommands.frame('body')}>
          Full body
        </button>
        {busy ? <span class="spinner" role="status" aria-label="Building avatar" /> : null}
        {source === 'placeholder' ? <span class="tag">Stand-in</span> : null}
      </div>

      <label class="field">
        <span>Name</span>
        <input
          type="text"
          maxLength={32}
          value={view.name}
          aria-label="Name"
          onInput={(event) => {
            const target = event.currentTarget;
            if (target instanceof HTMLInputElement) creatorCommands.setName(target.value);
          }}
          onBlur={() => creatorCommands.commitName()}
        />
      </label>

      <div class="field-row">
        <label class="field grow">
          <span>Race</span>
          <select
            aria-label="Race"
            value={view.race}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLSelectElement) creatorCommands.setRace(target.value);
            }}
          >
            {view.races.map((race) => (
              <option key={race} value={race}>
                {pretty(race)}
              </option>
            ))}
          </select>
        </label>
        <LockButton field="race" locked={view.locks.race} />
      </div>
      {view.pixieNote ? <p class="note">{view.pixieNote}</p> : null}

      <div class="field-row">
        <label class="field grow">
          <span>Gender</span>
          <select
            aria-label="Gender"
            value={view.gender}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLSelectElement) {
                creatorCommands.setGender(target.value === 'f' ? 'f' : 'm');
              }
            }}
          >
            <option value="f">Female</option>
            <option value="m">Male</option>
          </select>
        </label>
        <LockButton field="gender" locked={view.locks.gender} />
      </div>

      <div class="field-row">
        <label class="field grow">
          <span>Style</span>
          <select
            aria-label="Style"
            value={view.style}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLSelectElement) creatorCommands.setStyle(target.value);
            }}
          >
            {view.styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
        <LockButton field="style" locked={view.locks.style} />
      </div>

      <div class="field-row">
        <label class="field grow">
          <span>Richness {view.richness.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={view.richness}
            aria-label="Richness"
            onPointerDown={() => creatorCommands.beginGesture()}
            onInput={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLInputElement)
                creatorCommands.setRichness(Number(target.value));
            }}
            onPointerUp={() => creatorCommands.endGesture()}
            onBlur={() => creatorCommands.endGesture()}
          />
        </label>
        <LockButton field="richness" locked={view.locks.richness} />
      </div>
      {view.regaliaWarning ? <p class="note warn">{view.regaliaWarning}</p> : null}

      <p class="age">Age: adult</p>

      <div class="slot-block">
        <div class="field-row">
          <p class="slot-title">Garments</p>
          <LockButton field="slots" locked={view.locks.slots} />
        </div>
        <div class="slot-grid">
          <label class="field">
            <span>Slot</span>
            <select
              aria-label="Garment slot"
              value={view.slot}
              onChange={(event) => {
                const target = event.currentTarget;
                if (target instanceof HTMLSelectElement) creatorCommands.setSlot(target.value);
              }}
            >
              {view.slots.map((slot) => (
                <option key={slot} value={slot}>
                  {pretty(slot)}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Garment</span>
            <select
              aria-label="Garment"
              value={view.garment}
              onChange={(event) => {
                const target = event.currentTarget;
                if (target instanceof HTMLSelectElement) creatorCommands.setGarment(target.value);
              }}
            >
              {view.garments.map((garment) => (
                <option key={garment} value={garment}>
                  {pretty(garment)}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Rule</span>
            <select
              aria-label="Slot rule"
              value={view.slotMode}
              onChange={(event) => {
                const target = event.currentTarget;
                if (target instanceof HTMLSelectElement) {
                  const mode = target.value;
                  const next: 'any' | SlotMode =
                    mode === 'include' || mode === 'exclude' ? mode : 'any';
                  creatorCommands.setSlotMode(next);
                }
              }}
            >
              <option value="any">Any</option>
              <option value="include">Include only</option>
              <option value="exclude">Exclude</option>
            </select>
          </label>
        </div>
        <button type="button" class="chip" onClick={() => creatorCommands.applySlot()}>
          Apply slot
        </button>
        {view.chips.length > 0 ? (
          <ul class="chips">
            {view.chips.map((chip) => (
              <li key={chip.slot}>
                <button
                  type="button"
                  class="chip"
                  onClick={() => creatorCommands.clearSlot(chip.slot)}
                  aria-label={`Clear ${chip.label}`}
                >
                  {chip.label}: {chip.mode} {pretty(chip.garment)} ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p class="note">No slot is pinned. Forge picks the clothes.</p>
        )}
      </div>

      <div class="actions">
        <button type="button" class="action secondary" onClick={() => creatorCommands.randomize()}>
          Randomize look
        </button>
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
      </div>

      {view.note ? <p class="note">{view.note}</p> : null}
      {view.hash ? <p class="hash">Look {view.hash.slice(0, 8)}</p> : null}

      <div class="actions">
        <button type="button" class="action" onClick={() => creatorCommands.confirm()}>
          {confirmLabel}
        </button>
        <button type="button" class="action secondary" onClick={() => creatorCommands.cancel()}>
          Back
        </button>
      </div>
    </section>
  );
}
