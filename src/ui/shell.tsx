import { CreatorScreen } from './creator';
import type { GameSettings } from '../core/state/settings';
import {
  bootError,
  bootMessage,
  canContinue,
  clockText,
  commands,
  hint,
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
      <p class="lede">Walk the map. Step through a town gate. The road keeps your place.</p>
      <div class="actions">
        <button type="button" class="action" onClick={() => commands.newGame()}>
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
      <div class="pill clock">{clockText.value}</div>
      <button type="button" class="pill save" onClick={() => commands.save()}>
        Save
      </button>
      <button type="button" class="pill avatar" onClick={() => commands.editAvatar()}>
        Avatar
      </button>
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
