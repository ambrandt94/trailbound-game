import { CreatorScreen } from './creator';
import type { GameSettings } from '../core/state/settings';
import {
  bootError,
  bootMessage,
  canContinue,
  canEnter,
  clockRate,
  clockText,
  commands,
  generating,
  hint,
  placeKind,
  placeName,
  placeTier,
  savedFlash,
  screen,
  settings,
  settingsOpen,
} from './state';

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

function BootScreen() {
  return (
    <section class="screen">
      <p class="eyebrow">Trailbound</p>
      <h1>On the road</h1>
      <p class="lede">{bootError.value ?? bootMessage.value}</p>
    </section>
  );
}

function TitleScreen() {
  return (
    <section class="screen">
      <p class="eyebrow">A road game</p>
      <h1>Trailbound</h1>
      <p class="lede">
        {generating.value
          ? 'Charting the continent…'
          : 'Walk the map. Step through a town gate. The road keeps your place.'}
      </p>
      <div class="actions">
        <button
          type="button"
          class="action"
          disabled={generating.value}
          onClick={() => commands.newGame()}
        >
          New
        </button>
        <button
          type="button"
          class="action secondary"
          disabled={!canContinue.value}
          onClick={() => commands.continueGame()}
        >
          Continue
        </button>
        <button type="button" class="action secondary" onClick={() => commands.openSettings()}>
          Settings
        </button>
      </div>
    </section>
  );
}

function SettingsPanel() {
  const current = settings.value;
  const change = (partial: Partial<GameSettings>) => commands.changeSettings(partial);
  return (
    <section class="screen">
      <div class="card">
        <p class="eyebrow">Mix</p>
        <h2>Settings</h2>
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
              const mapSkin = target.value === 'classic' ? 'classic' : 'trailbound48';
              change({ mapSkin });
            }}
          >
            <option value="trailbound48">Trailbound 48</option>
            <option value="classic">Classic</option>
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
        <button type="button" class="action secondary" onClick={() => commands.editAvatar()}>
          Edit avatar
        </button>
        <button type="button" class="action" onClick={() => commands.closeSettings()}>
          Back
        </button>
      </div>
    </section>
  );
}

function Hud() {
  return (
    <div class="hud">
      <div class="pill clock">
        {clockText.value}
        {clockRate.value ? (
          <span class="rate" title="Game clock. Walk stays 5 km/h.">
            {clockRate.value}
          </span>
        ) : null}
      </div>
      <label class="pill skin">
        <span>Map</span>
        <select
          aria-label="Map skin"
          value={settings.value.mapSkin}
          onChange={(event) => {
            const target = event.currentTarget;
            if (!(target instanceof HTMLSelectElement)) return;
            commands.changeSettings({
              mapSkin: target.value === 'classic' ? 'classic' : 'trailbound48',
            });
          }}
        >
          <option value="trailbound48">Trailbound 48</option>
          <option value="classic">Classic</option>
        </select>
      </label>
      <button type="button" class="pill save" onClick={() => commands.save()}>
        Save
      </button>
      <button type="button" class="pill avatar" onClick={() => commands.editAvatar()}>
        Avatar
      </button>
      {placeName.value ? (
        <section class="place">
          <p class="eyebrow">{placeTier.value || placeKind.value}</p>
          <h2>{placeName.value}</h2>
          <button
            type="button"
            class="action"
            disabled={!canEnter.value}
            onClick={() => commands.enterPlace()}
          >
            Enter
          </button>
        </section>
      ) : null}
      <p class="hint">{hint.value}</p>
      {savedFlash.value ? <p class="flash">{savedFlash.value}</p> : null}
    </div>
  );
}

export function Shell() {
  if (settingsOpen.value && screen.value !== 'creator') return <SettingsPanel />;
  if (screen.value === 'boot') return <BootScreen />;
  if (screen.value === 'title') return <TitleScreen />;
  if (screen.value === 'creator') return <CreatorScreen />;
  return <Hud />;
}
