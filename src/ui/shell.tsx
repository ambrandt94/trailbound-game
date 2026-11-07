import { CreatorScreen } from './creator';
import { skinText } from './glyphs';
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
    <section class="screen tb-screen">
      <header class="tb-titlebar">
        <h1>On the road</h1>
      </header>
      <div class="tb-body">
        <p class="eyebrow tb-kicker">Trailbound</p>
        <p class="lede">{skinText(bootError.value ?? bootMessage.value)}</p>
      </div>
    </section>
  );
}

function TitleScreen() {
  return (
    <section class="screen tb-screen">
      <header class="tb-titlebar">
        <h1>Trailbound</h1>
      </header>
      <div class="tb-body">
        <p class="eyebrow tb-kicker">A road game</p>
        <p class="lede">
          {skinText(
            generating.value
              ? 'Charting the continent…'
              : 'Walk the map. Step through a town gate. The road keeps your place.',
          )}
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
          <p>{skinText('Keep zooming')}</p>
        </div>
      ) : null}
      <div class="hud-bar">
        <div class="pill clock">
          {skinText(clockText.value)}
          {clockRate.value ? (
            <span class="rate" title="Game clock. Walk stays 5 km/h.">
              {skinText(clockRate.value)}
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
            <option value="classic">Pixel Kingdom</option>
            <option value="trailbound48">Trailbound 48</option>
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
      </div>
      <div class="hud-foot">
        {placeName.value ? (
          <section class="place">
            <p class="eyebrow">{skinText(placeTier.value || placeKind.value)}</p>
            <h2>{skinText(placeName.value)}</h2>
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
        {hint.value ? <p class="hint">{skinText(hint.value)}</p> : null}
        {savedFlash.value ? (
          <p class={savedFlash.value === 'Saved' ? 'flash ok' : 'flash bad'}>
            {skinText(savedFlash.value)}
          </p>
        ) : null}
      </div>
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
