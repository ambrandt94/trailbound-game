import { caravanStatus } from '../core/sim/map-pace';
import { CreatorScreen } from './creator';
import { skinText } from './glyphs';
import { SettingsPanel } from './area-settings';
import { DayCycleHud } from './day-cycle/hud';
import {
  bootError,
  bootMessage,
  canContinue,
  canEnter,
  clockRate,
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
  travelHud,
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

/** The party readout without its leading "TU n": the day-cycle HUD owns the time. */
function supplyLine(readout: string): string {
  return readout.replace(/^TU \d+\s+/, '');
}

function Hud() {
  return (
    <div class="hud">
      <div class="night-veil" style={{ opacity: String(mapNight.value) }} />
      <div class="hud-bar">
        <div class="pill clock">
          {partyHud.value ? (
            <span class="party">{skinText(supplyLine(partyHud.value))}</span>
          ) : null}
          {clockRate.value ? (
            <span class="rate" title="Game clock. Walk stays 5 km/h.">
              {skinText(`Clock ${clockRate.value}`)}
            </span>
          ) : null}
        </div>
        <DayCycleHud />
        <div class="hud-right">
          <div class="hud-actions">
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
          <TravelPanel />
        </div>
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

function TravelPanel() {
  const t = travelHud.value;
  if (!t) return null;
  const pct = Math.max(0, Math.min(100, (t.todayUnits / Math.max(1, t.goalUnits)) * 100));
  const roleLabel = t.role === 'passenger' ? 'Passenger' : t.role === 'solo' ? 'Solo' : 'Leader';
  const status = caravanStatus(t);
  const inArea = t.view === 'area';
  const convoy = t.convoy;
  return (
    <section class={inArea ? 'travel-panel in-area' : 'travel-panel'} aria-label="Caravan">
      <p class="eyebrow">
        {skinText(`Caravan · ${roleLabel}`)} <span class="travel-status">{skinText(status)}</span>
      </p>
      <p class="travel-line">{skinText(`Pace ×${t.speed.toFixed(2)}`)}</p>
      <div class="travel-goal" title="Distance today against the day goal">
        <span>{skinText(`Today ${Math.floor(t.todayUnits)} / ${t.goalUnits}`)}</span>
        <div class="travel-bar">
          <div class="travel-fill" style={{ width: `${pct.toFixed(1)}%` }} />
        </div>
      </div>
      {t.hasRoute ? (
        <p class="travel-line travel-dest">
          {skinText(
            `To ${t.destName}${t.waypoints > 0 ? ` (+${t.waypoints} stop${t.waypoints > 1 ? 's' : ''})` : ''} · ${Math.ceil(t.remainingUnits)} left`,
          )}
        </p>
      ) : (
        <p class="travel-line travel-help">
          {skinText(
            t.editable
              ? 'Click a town, site, or land to route. Shift+click adds a stop.'
              : 'The leader sets the route.',
          )}
        </p>
      )}
      {t.eta && !inArea ? <p class="travel-line travel-eta">{skinText(`ETA ${t.eta}`)}</p> : null}
      {!t.aboard && !inArea ? (
        <p class="travel-line travel-scout">{skinText('Scouting on foot')}</p>
      ) : null}
      {convoy ? (
        <p class="travel-line travel-mode">
          {skinText(
            convoy.mode === 'bench'
              ? 'Riding the bench · B to step down'
              : convoy.mode === 'walk'
                ? 'Walking beside the wagon · B to ride'
                : `On foot · ${Math.round(convoy.dist)} m from the wagon`,
          )}
        </p>
      ) : null}
      {convoy && convoy.leash !== 'ok' ? (
        <div class="travel-leash" role="status">
          <span>
            {skinText(
              convoy.leash === 'pull' ? 'Falling behind, heading back' : 'Falling behind, rejoin?',
            )}
          </span>
          {convoy.leash === 'hint' ? (
            <button
              type="button"
              class="action travel-btn rejoin-wagon"
              onClick={() => commands.rejoinWagon()}
            >
              Rejoin (G)
            </button>
          ) : null}
        </div>
      ) : null}
      <div class="travel-actions">
        {t.editable && t.hasRoute ? (
          <button
            type="button"
            class="action secondary travel-btn halt"
            onClick={() => commands.toggleHalt()}
          >
            {t.halted ? 'Resume' : 'Halt'}
            {inArea ? ' (H)' : ''}
          </button>
        ) : null}
        {t.editable && t.hasRoute && !inArea ? (
          <button
            type="button"
            class="action secondary travel-btn clear-route"
            onClick={() => commands.clearRoute()}
          >
            Clear route
          </button>
        ) : null}
        {t.hasRoute && !inArea ? (
          <button
            type="button"
            class="action secondary travel-btn fit-route"
            onClick={() => commands.fitRoute()}
          >
            Show route
          </button>
        ) : null}
        {!t.aboard && !inArea ? (
          <button
            type="button"
            class="action travel-btn rejoin"
            onClick={() => commands.rejoinCaravan()}
          >
            Rejoin caravan
          </button>
        ) : null}
        {convoy ? (
          <button
            type="button"
            class="action secondary travel-btn bench"
            onClick={() => commands.toggleBench()}
          >
            {convoy.mode === 'bench' ? 'Walk (B)' : 'Ride bench (B)'}
          </button>
        ) : null}
        <button
          type="button"
          class="action secondary travel-btn wagon"
          onClick={() => commands.openWagon()}
        >
          Wagon
        </button>
      </div>
    </section>
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
            disabled={row.disabled === true}
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
