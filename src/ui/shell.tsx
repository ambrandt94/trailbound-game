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
  commands,
  generating,
  hint,
  mapNight,
  nearestLine,
  notice,
  partyHud,
  placeKind,
  placeName,
  placeTier,
  savedFlash,
  screen,
  settings,
  settingsOpen,
  standLine,
  wagonOpen,
  wagonRows,
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
      <div class="night-veil" style={{ opacity: String(mapNight.value) }} />
      <div class="hud-bar">
        <div class="pill clock">
          {skinText(clockText.value)}
          {clockRate.value ? (
            <span class="rate" title="Game clock. Walk stays 5 km/h.">
              {skinText(clockRate.value)}
            </span>
          ) : null}
          {partyHud.value ? <span class="party">{skinText(partyHud.value)}</span> : null}
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
            {standLine.value ? <p class="stand">{skinText(standLine.value)}</p> : null}
            {nearestLine.value ? <p class="nearest">{skinText(nearestLine.value)}</p> : null}
            <button
              type="button"
              class="action enter-place"
              disabled={!canEnter.value}
              onClick={() => commands.enterPlace()}
            >
              Enter
            </button>
          </section>
        ) : null}
        {notice.value ? <p class="notice">{skinText(notice.value)}</p> : null}
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

function WagonMenu() {
  if (!wagonOpen.value) return null;
  return (
    <section class="wagon-menu" role="dialog" aria-label="Wagon">
      <p class="eyebrow">Camp</p>
      <h2>Wagon</h2>
      <div class="wagon-rows">
        {wagonRows.value.map((row) => (
          <button
            key={row.id}
            type="button"
            class="action wagon-row"
            onClick={() => commands.wagonAct(row.id)}
          >
            <span>{skinText(row.label)}</span>
            <small>{skinText(row.detail)}</small>
          </button>
        ))}
      </div>
      <button type="button" class="action secondary" onClick={() => commands.closeWagon()}>
        Close
      </button>
    </section>
  );
}

export function Shell() {
  if (screen.value === 'boot') return <BootScreen />;
  if (screen.value === 'creator') return <CreatorScreen />;
  if (settingsOpen.value && screen.value !== 'play') return <SettingsPanel />;
  return (
    <>
      {screen.value === 'title' ? <TitleScreen /> : <Hud />}
      {screen.value === 'play' ? <WagonMenu /> : null}
      {settingsOpen.value ? <SettingsPanel dock /> : null}
    </>
  );
}
