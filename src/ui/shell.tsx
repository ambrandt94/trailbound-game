import { CreatorScreen } from './creator';
import { SettingsPanel } from './area-settings';
import {
  bootError,
  bootMessage,
  canContinue,
  canEnter,
  clockRate,
  clockText,
  diveCue,
  diveIntent,
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

function Hud() {
  return (
    <div class="hud">
      <div class="vignette" style={{ opacity: String(diveCue.value) }} />
      {diveIntent.value > 0.02 ? (
        <div class="dive-cue" aria-hidden="true">
          <div
            class="dive-ring"
            style={{
              background: `conic-gradient(#f6f1e6 ${Math.round(diveIntent.value * 360)}deg, rgba(246, 241, 230, 0.28) 0)`,
            }}
          />
          <p>Keep zooming</p>
        </div>
      ) : null}
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
      <button type="button" class="pill look" onClick={() => commands.openSettings()}>
        Settings
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
  if (screen.value === 'boot') return <BootScreen />;
  if (screen.value === 'creator') return <CreatorScreen />;
  if (settingsOpen.value && screen.value !== 'play') return <SettingsPanel />;
  return (
    <>
      {screen.value === 'title' ? <TitleScreen /> : <Hud />}
      {settingsOpen.value ? <SettingsPanel dock /> : null}
    </>
  );
}
