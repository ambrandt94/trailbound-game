import type { AvatarGender } from '../core/people/avatar';
import {
  creatorBusy,
  creatorCommands,
  creatorSource,
  creatorView,
  type PartView,
  type SliderView,
  type SwatchView,
} from './creator-state';
import { skinText } from './glyphs';
import { WardrobeScreen } from './wardrobe';

function pretty(id: string): string {
  const bare = id
    .replace(/^(look|arche):/, '')
    .replaceAll('_', ' ')
    .replace(/^face /, '');
  return bare.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rgb(channels: number[]): string {
  const [r = 0, g = 0, b = 0] = channels;
  return `rgb(${r}, ${g}, ${b})`;
}

function Swatches(props: {
  label: string;
  items: SwatchView[];
  selected: string;
  onPick: (id: string) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <div class="field">
      <span>{props.label}</span>
      <div class="swatches" role="listbox" aria-label={props.label}>
        {props.items.map((item) => (
          <button
            key={item.id}
            type="button"
            class={item.id === props.selected ? 'swatch on' : 'swatch'}
            style={{ background: rgb(item.rgb) }}
            aria-label={`${props.label} ${item.label}`}
            aria-pressed={item.id === props.selected}
            title={item.label}
            onClick={() => props.onPick(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SliderRow(props: { slider: SliderView; onChange: (id: string, value: number) => void }) {
  return (
    <label class="field">
      <span>
        {props.slider.label} {props.slider.value.toFixed(2)}
      </span>
      <input
        type="range"
        min={props.slider.min}
        max={props.slider.max}
        step={props.slider.step}
        value={props.slider.value}
        aria-label={props.slider.label}
        onPointerDown={() => creatorCommands.beginGesture()}
        onInput={(event) => {
          const target = event.currentTarget;
          if (target instanceof HTMLInputElement)
            props.onChange(props.slider.id, Number(target.value));
        }}
        onPointerUp={() => creatorCommands.endGesture()}
        onBlur={() => creatorCommands.endGesture()}
      />
    </label>
  );
}

function PartSelect(props: { part: PartView }) {
  if (props.part.options.length < 2) return null;
  return (
    <label class="field">
      <span>{props.part.label}</span>
      <select
        aria-label={props.part.label}
        value={props.part.value}
        onChange={(event) => {
          const target = event.currentTarget;
          if (target instanceof HTMLSelectElement) {
            creatorCommands.setFacePart(props.part.key, target.value);
          }
        }}
      >
        {props.part.options.map((option) => (
          <option key={option} value={option}>
            {pretty(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CreatorScreen() {
  const view = creatorView.value;
  const busy = creatorBusy.value;
  const source = creatorSource.value;
  const confirmLabel = view.intent === 'edit' ? 'Save avatar' : 'Take the road';
  if (view.paperdoll) {
    return <WardrobeScreen view={view} busy={busy} confirmLabel={confirmLabel} />;
  }
  return (
    <section class="creator tb-scroll">
      <div class="creator-copy">
        <p class="eyebrow tb-kicker">Character</p>
        <h2 class="tb-heading">
          {view.intent === 'edit' ? 'Edit avatar' : 'Who walks this road?'}
        </h2>
        <p class="lede tight">Adult travellers only. Drag the view, or use the arrow keys.</p>
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

      <label class="field">
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
      {view.pixieNote ? <p class="note">{skinText(view.pixieNote)}</p> : null}

      <label class="field">
        <span>Gender</span>
        <select
          aria-label="Gender"
          value={view.gender}
          onChange={(event) => {
            const target = event.currentTarget;
            if (target instanceof HTMLSelectElement) {
              const gender: AvatarGender = target.value === 'f' ? 'f' : 'm';
              creatorCommands.setGender(gender);
            }
          }}
        >
          <option value="f">Female</option>
          <option value="m">Male</option>
        </select>
      </label>

      <div class="actions">
        <button type="button" class="action secondary" onClick={() => creatorCommands.randomize()}>
          Randomize
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

      <p class="age">Age: adult</p>
      {view.errors.map((error) => (
        <p class="note warn" key={error}>
          {skinText(error)}
        </p>
      ))}
      {view.warnings.map((warning) => (
        <p class="note" key={warning}>
          {skinText(warning)}
        </p>
      ))}

      <Swatches
        label="Skin"
        items={view.skins}
        selected={view.skin}
        onPick={(id) => creatorCommands.setSkin(id)}
      />
      {view.showHairColor ? (
        <Swatches
          label="Hair"
          items={view.hairColors}
          selected={view.hairColor}
          onPick={(id) => creatorCommands.setHairColor(id)}
        />
      ) : null}
      <Swatches
        label="Eyes"
        items={view.iris}
        selected={view.eyeColor}
        onPick={(id) => creatorCommands.setEye(id)}
      />
      <Swatches
        label="Sclera"
        items={view.scleras}
        selected={view.sclera}
        onPick={(id) => creatorCommands.setSclera(id)}
      />

      {view.showHairStyle ? (
        <label class="field">
          <span>Hair style</span>
          <select
            aria-label="Hair style"
            value={view.hairStyle}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLSelectElement) creatorCommands.setHairStyle(target.value);
            }}
          >
            {view.styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {view.hatNote ? <p class="note">{skinText(view.hatNote)}</p> : null}

      {view.showFacial ? (
        <label class="field">
          <span>Facial hair</span>
          <select
            aria-label="Facial hair"
            value={view.facial}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLSelectElement) creatorCommands.setFacialHair(target.value);
            }}
          >
            <option value="">None</option>
            {view.facialHair.map((style) => (
              <option key={style.id} value={style.id}>
                {style.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {view.showStubble ? (
        <label class="field">
          <span>Stubble {view.stubble.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={view.stubble}
            aria-label="Stubble"
            onPointerDown={() => creatorCommands.beginGesture()}
            onInput={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLInputElement)
                creatorCommands.setStubble(Number(target.value));
            }}
            onPointerUp={() => creatorCommands.endGesture()}
            onBlur={() => creatorCommands.endGesture()}
          />
        </label>
      ) : null}

      {view.lengths.map((slider) => (
        <SliderRow
          key={slider.id}
          slider={slider}
          onChange={(id, value) => creatorCommands.setLength(id, value)}
        />
      ))}
      {view.heightSliders.map((slider) => (
        <SliderRow
          key={slider.id}
          slider={slider}
          onChange={(id, value) => creatorCommands.setSlider(id, value)}
        />
      ))}
      {view.buildSliders.map((slider) => (
        <SliderRow
          key={slider.id}
          slider={slider}
          onChange={(id, value) => creatorCommands.setSlider(id, value)}
        />
      ))}
      {view.shapeSliders.length > 0 ? (
        <details class="shape-details">
          <summary class="tb-heading">More build</summary>
          {view.shapeSliders.map((slider) => (
            <SliderRow
              key={slider.id}
              slider={slider}
              onChange={(id, value) => creatorCommands.setSlider(id, value)}
            />
          ))}
        </details>
      ) : null}

      {view.facePresets.length > 0 ? (
        <label class="field">
          <span>Face</span>
          <select
            aria-label="Face preset"
            value={view.facePreset}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLSelectElement) creatorCommands.setFacePreset(target.value);
            }}
          >
            {view.facePresets.map((preset) => (
              <option key={preset} value={preset}>
                {preset === 'race' ? 'Race face' : preset.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {view.faceParts.map((part) => (
        <PartSelect key={part.key} part={part} />
      ))}
      {view.faceParams.map((slider) => (
        <SliderRow
          key={slider.id}
          slider={slider}
          onChange={(id, value) => creatorCommands.setFaceParam(id, value)}
        />
      ))}

      <div class="actions">
        <button type="button" class="action" onClick={() => creatorCommands.openPaperdoll()}>
          Wardrobe
        </button>
      </div>

      {view.note ? <p class="note">{skinText(view.note)}</p> : null}
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
