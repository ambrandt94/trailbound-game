import type { GameSettings, MapSkinId } from '../core/state/settings';
import {
  cycleZoom,
  matchView,
  toggleCameraMode,
  viewName,
  viewPreset,
} from '../core/state/area-camera';
import {
  applyFeelPreset,
  DEFAULT_AREA_LOOK,
  FEEL_PRESET_NAMES,
  fieldsInGroup,
  hourLabel,
  LOOK_GROUPS,
  type AreaLook,
  type LookField,
} from '../core/state/area-look';
import { skinText } from './glyphs';
import { commands, settings } from './state';

function trim(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
  return String(Math.round(value * 1000) / 1000);
}

function Slider(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label class="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={props.value}
        aria-label={props.label}
        onInput={(event) => {
          const target = event.currentTarget;
          if (target instanceof HTMLInputElement) props.onChange(Number(target.value));
        }}
      />
      <span class="value">{props.value}</span>
    </label>
  );
}

function LookControl(props: {
  field: LookField;
  look: AreaLook;
  onChange: (patch: Partial<AreaLook>) => void;
}) {
  const { field, look } = props;
  const raw = look[field.key];
  if (field.kind === 'bool') {
    const checked = raw === true;
    return (
      <label class="check">
        <input
          type="checkbox"
          checked={checked}
          aria-label={field.label}
          onChange={(event) => {
            const target = event.currentTarget;
            if (target instanceof HTMLInputElement) {
              props.onChange({ [field.key]: target.checked } as Partial<AreaLook>);
            }
          }}
        />
        {skinText(field.label)}
      </label>
    );
  }
  if (field.kind === 'color') {
    const color = typeof raw === 'string' ? raw : field.fallback;
    return (
      <label class="slider">
        <span>{skinText(field.label)}</span>
        <input
          type="color"
          value={color}
          aria-label={field.label}
          onInput={(event) => {
            const target = event.currentTarget;
            if (target instanceof HTMLInputElement) {
              props.onChange({ [field.key]: target.value } as Partial<AreaLook>);
            }
          }}
        />
        <span class="value">{color}</span>
      </label>
    );
  }
  if (field.kind === 'choice') {
    const selected = typeof raw === 'number' ? raw : field.fallback;
    return (
      <label class="field">
        {skinText(field.label)}
        <select
          aria-label={field.label}
          value={String(selected)}
          onChange={(event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLSelectElement)) return;
            props.onChange({ [field.key]: Number(target.value) } as Partial<AreaLook>);
          }}
        >
          {field.choices.map((pair) => (
            <option key={pair[0]} value={String(pair[0])}>
              {skinText(pair[1])}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const value = typeof raw === 'number' ? raw : field.fallback;
  const shown = field.key === 'sunHour' ? hourLabel(value) : trim(value);
  return (
    <label class="slider">
      <span>{skinText(field.label)}</span>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        aria-label={field.label}
        onInput={(event) => {
          const target = event.currentTarget;
          if (!(target instanceof HTMLInputElement)) return;
          const next = field.integer ? Math.round(Number(target.value)) : Number(target.value);
          const patch = { [field.key]: next } as Partial<AreaLook>;
          if (field.group === 'Controller') patch.feelPreset = 'Custom';
          props.onChange(patch);
        }}
      />
      <span class="value">{shown}</span>
    </label>
  );
}

export function SettingsPanel(props: { dock?: boolean }) {
  const current = settings.value;
  const look = current.look;
  const change = (partial: Partial<GameSettings>) => commands.changeSettings(partial);
  const changeLook = (patch: Partial<AreaLook>) => change({ look: { ...look, ...patch } });
  const viewIndex = matchView(look.camPitch, look.camDist, look.camFov);
  const copyLook = () => {
    const text = JSON.stringify(look, null, 2);
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) return;
    void clipboard.writeText(text);
  };
  return (
    <section class={props.dock ? 'settings-dock' : 'screen tb-screen'}>
      <div
        class={
          props.dock ? 'settings-card tb-window tb-scroll' : 'card settings-card tb-panel tb-scroll'
        }
      >
        <p class="eyebrow tb-kicker">Mix</p>
        <h2 class="tb-heading">Settings</h2>
        <Slider label="Master" value={current.master} onChange={(master) => change({ master })} />
        <Slider label="Music" value={current.music} onChange={(music) => change({ music })} />
        <Slider
          label="Effects"
          value={current.effects}
          onChange={(effects) => change({ effects })}
        />
        <Slider label="Voices" value={current.voices} onChange={(voices) => change({ voices })} />
        <label class="field">
          Map
          <select
            aria-label="Map"
            value={current.mapSkin}
            onChange={(event) => {
              const target = event.currentTarget;
              if (!(target instanceof HTMLSelectElement)) return;
              const mapSkin: MapSkinId = target.value === 'classic' ? 'classic' : 'trailbound48';
              change({ mapSkin });
            }}
          >
            <option value="classic">Pixel Kingdom</option>
            <option value="trailbound48">Trailbound 48</option>
          </select>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={current.muteVoices}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLInputElement) change({ muteVoices: target.checked });
            }}
          />
          Mute voices
        </label>
        <p class="lede tight">
          {skinText(
            'The 3D view uses the same look, camera, and feel as the controller demo. Fog density also sets how far the town draws. Changes apply immediately.',
          )}
        </p>
        {LOOK_GROUPS.map((group) => (
          <details
            class="look-group"
            key={group}
            open={group === 'Camera' || group === 'Pixelation'}
          >
            <summary>{group}</summary>
            {group === 'Controller' ? (
              <label class="field">
                Feel preset
                <select
                  aria-label="Feel preset"
                  value={look.feelPreset}
                  onChange={(event) => {
                    const target = event.currentTarget;
                    if (!(target instanceof HTMLSelectElement)) return;
                    const name = FEEL_PRESET_NAMES.find((preset) => preset === target.value);
                    if (!name || name === 'Custom') return;
                    change({ look: applyFeelPreset(look, name) });
                  }}
                >
                  {FEEL_PRESET_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {group === 'Camera' ? (
              <div class="look-actions">
                <p class="look-view">{viewName(viewIndex)}</p>
                <button
                  type="button"
                  class="lock"
                  onClick={() => {
                    const preset = viewPreset(cycleZoom(viewIndex));
                    if (!preset) return;
                    changeLook({
                      camPitch: preset.camPitch,
                      camDist: preset.camDist,
                      camFov: preset.camFov,
                      camLag: preset.camLag,
                    });
                  }}
                >
                  Next zoom
                </button>
                <button
                  type="button"
                  class="lock"
                  onClick={() => {
                    const preset = viewPreset(toggleCameraMode(viewIndex));
                    if (!preset) return;
                    changeLook({
                      camPitch: preset.camPitch,
                      camDist: preset.camDist,
                      camFov: preset.camFov,
                      camLag: preset.camLag,
                    });
                  }}
                >
                  Overhead / 3rd
                </button>
              </div>
            ) : null}
            {fieldsInGroup(group).map((field) => (
              <LookControl key={field.key} field={field} look={look} onChange={changeLook} />
            ))}
          </details>
        ))}
        <div class="actions">
          <button type="button" class="action secondary" onClick={() => commands.editAvatar()}>
            Edit avatar
          </button>
          <button
            type="button"
            class="action secondary"
            onClick={() => change({ look: DEFAULT_AREA_LOOK })}
          >
            Reset look
          </button>
          <button type="button" class="action secondary" onClick={copyLook}>
            Copy look JSON
          </button>
          <button type="button" class="action" onClick={() => commands.closeSettings()}>
            Back
          </button>
        </div>
      </div>
    </section>
  );
}
