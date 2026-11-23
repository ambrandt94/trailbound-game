import { useEffect, useState } from 'preact/hooks';
import {
  caravanStatus,
  haltLabel,
  mapWaitsForHero,
  showTimeOnlyToggle,
  timeOnlyWhenMovingLabel,
  timeOnlyWhenMovingTitle,
} from '../core/sim/map-pace';
import type { HudPrefs } from '../core/state/settings';
import { CreatorScreen } from './creator';
import { WorldGenScreen } from './worldgen';
import { skinText } from './glyphs';
import { SettingsPanel } from './area-settings';
import { DayCycleHud } from './day-cycle/hud';
import { HudIcon, type HudIconName } from './hud-icons';
import {
  bootError,
  bootMessage,
  canContinue,
  canEnter,
  clockRate,
  commands,
  generating,
  hint,
  hudHidden,
  hudMenuOpen,
  mapNight,
  nearestLine,
  notice,
  partyHud,
  placeKind,
  placeName,
  placeTier,
  prompt,
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

/** Views whose controls cheat-sheet has already flashed once this session. */
const helpSeen = new Set<string>();

/** A value that clears itself `ms` after it last changed, so a toast does not linger. */
function useTransient(value: string, ms: number): string {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    setShown(value);
    if (!value) return undefined;
    const timer = window.setTimeout(() => setShown(''), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return value ? shown : '';
}

function setHudPref(key: keyof HudPrefs, value: boolean): void {
  commands.changeSettings({ hud: { ...settings.value.hud, [key]: value } });
}

function toggleSettings(): void {
  if (settingsOpen.value) commands.closeSettings();
  else commands.openSettings();
}

function ToolButton(props: {
  icon: HudIconName;
  label: string;
  title: string;
  pressed?: boolean;
  /** Short visible caption next to the icon (the time-waits toggle). */
  caption?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={props.caption ? 'tool-btn tool-btn-labeled' : 'tool-btn'}
      aria-label={props.label}
      title={props.title}
      aria-pressed={props.pressed === undefined ? undefined : props.pressed}
      onClick={props.onClick}
    >
      <HudIcon name={props.icon} />
      {props.caption ? <span class="tool-caption">{skinText(props.caption)}</span> : null}
    </button>
  );
}

function Toolbar() {
  const t = travelHud.value;
  const canHalt = t !== null && t.editable && t.hasRoute;
  return (
    <div class="hud-box hud-tools" role="toolbar" aria-label="Game menu">
      {canHalt ? (
        <ToolButton
          icon={t.halted ? 'play' : 'pause'}
          label={haltLabel(t.halted)}
          title={t.halted ? 'Roll out the caravan (H)' : 'Halt the caravan (H)'}
          onClick={() => commands.toggleHalt()}
        />
      ) : null}
      {showTimeOnlyToggle(t?.view) ? (
        <ToolButton
          icon="clock"
          label={timeOnlyWhenMovingLabel(settings.value.timeOnlyWhenMoving)}
          title={timeOnlyWhenMovingTitle(settings.value.timeOnlyWhenMoving)}
          caption={timeOnlyWhenMovingLabel(settings.value.timeOnlyWhenMoving)}
          pressed={settings.value.timeOnlyWhenMoving}
          onClick={() =>
            commands.changeSettings({
              timeOnlyWhenMoving: !settings.value.timeOnlyWhenMoving,
            })
          }
        />
      ) : null}
      <ToolButton
        icon="info"
        label="Caravan"
        title="Caravan details (I)"
        pressed={settings.value.hud.caravan}
        onClick={() => setHudPref('caravan', !settings.value.hud.caravan)}
      />
      <ToolButton
        icon="wagon"
        label="Wagon"
        title="Wagon and camp"
        pressed={wagonOpen.value}
        onClick={() => commands.openWagon()}
      />
      <ToolButton icon="save" label="Save" title="Save" onClick={() => commands.save()} />
      <ToolButton
        icon="gear"
        label="Settings"
        title="Settings (O)"
        pressed={settingsOpen.value}
        onClick={toggleSettings}
      />
      <ToolButton
        icon="more"
        label="More"
        title="Avatar, map style, controls, hide HUD"
        pressed={hudMenuOpen.value}
        onClick={() => {
          hudMenuOpen.value = !hudMenuOpen.value;
        }}
      />
    </div>
  );
}

function MoreMenu() {
  if (!hudMenuOpen.value) return null;
  return (
    <section class="hud-box hud-panel hud-more" aria-label="More">
      <button
        type="button"
        class="menu-item"
        onClick={() => {
          hudMenuOpen.value = false;
          commands.editAvatar();
        }}
      >
        <HudIcon name="person" />
        Avatar
      </button>
      <button
        type="button"
        class="menu-item"
        onClick={() => {
          hudMenuOpen.value = false;
          commands.openWorldGen();
        }}
      >
        <HudIcon name="globe" />
        World Gen
      </button>
      <label class="menu-item skin">
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
      <button
        type="button"
        class="menu-item"
        aria-pressed={settings.value.hud.help}
        onClick={() => setHudPref('help', !settings.value.hud.help)}
      >
        <HudIcon name="help" />
        Controls (K)
      </button>
      <button
        type="button"
        class="menu-item"
        onClick={() => {
          hudMenuOpen.value = false;
          hudHidden.value = true;
        }}
      >
        <HudIcon name="eye" />
        Hide HUD (U)
      </button>
    </section>
  );
}

/** The one small always-on status: caravan state, today's progress, supplies. */
function StatusChip() {
  const t = travelHud.value;
  const supplies = partyHud.value ? supplyLine(partyHud.value) : '';
  if (!t && !supplies) return null;
  const pct = t ? Math.max(0, Math.min(100, (t.todayUnits / Math.max(1, t.goalUnits)) * 100)) : 0;
  const open = settings.value.hud.caravan;
  return (
    <div class="hud-status">
      <button
        type="button"
        class="hud-box hud-chip"
        aria-expanded={open}
        title="Caravan details (I)"
        onClick={() => setHudPref('caravan', !open)}
      >
        {t ? (
          <>
            <span class="chip-row">
              <span class="chip-state">{skinText(caravanStatus(t))}</span>
              <span>{skinText(`${Math.floor(t.todayUnits)}/${t.goalUnits}`)}</span>
            </span>
            <span class="chip-bar">
              <span class="chip-fill" style={{ width: `${pct.toFixed(1)}%` }} />
            </span>
          </>
        ) : null}
        {t && mapWaitsForHero(t) ? (
          <span
            class="chip-sub chip-action"
            role="button"
            tabIndex={0}
            title="Time waits until you walk. Click or press T to let a rolling caravan run the clock."
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              commands.changeSettings({ timeOnlyWhenMoving: false });
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              commands.changeSettings({ timeOnlyWhenMoving: false });
            }}
          >
            {skinText('Time waits for you')}
          </span>
        ) : null}
        {supplies ? <span class="chip-sub">{skinText(supplies)}</span> : null}
        {clockRate.value ? (
          <span class="chip-sub" title="Game clock. Walk stays 5 km/h.">
            {skinText(`Clock ${clockRate.value}`)}
          </span>
        ) : null}
      </button>
      {t && !t.aboard && t.view !== 'area' ? (
        <button
          type="button"
          class="hud-box hud-chip-btn rejoin"
          onClick={() => commands.rejoinCaravan()}
        >
          {skinText('Scouting on foot · Rejoin')}
        </button>
      ) : null}
    </div>
  );
}

/** Route, pace, and caravan buttons. Closed until asked for (I). */
function CaravanCard() {
  const t = travelHud.value;
  if (!t) return null;
  const roleLabel = t.role === 'passenger' ? 'Passenger' : t.role === 'solo' ? 'Solo' : 'Leader';
  const inArea = t.view === 'area';
  const convoy = t.convoy;
  return (
    <section class="hud-box hud-panel travel-panel" aria-label="Caravan">
      <p class="card-head">
        <span>{skinText(`Caravan · ${roleLabel}`)}</span>
        <button
          type="button"
          class="card-x"
          aria-label="Close caravan details"
          onClick={() => setHudPref('caravan', false)}
        >
          <HudIcon name="close" />
        </button>
      </p>
      <p class="travel-line">{skinText(`${caravanStatus(t)} · Pace x${t.speed.toFixed(2)}`)}</p>
      {mapWaitsForHero(t) ? (
        <p class="travel-line travel-wait">
          <span
            class="chip-action"
            role="button"
            tabIndex={0}
            title="Click or press T to let a rolling caravan run the clock."
            onClick={() => commands.changeSettings({ timeOnlyWhenMoving: false })}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              commands.changeSettings({ timeOnlyWhenMoving: false });
            }}
          >
            {skinText('Time waits until you walk (toolbar or T to let it run)')}
          </span>
        </p>
      ) : null}
      <p class="travel-line" title="Distance today against the day goal">
        {skinText(`Today ${Math.floor(t.todayUnits)} / ${t.goalUnits}`)}
      </p>
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
            convoy.away
              ? 'The caravan is elsewhere on the road · return to the map to catch up'
              : convoy.gone
                ? 'The wagon rolled on · follow it or return to the map'
                : convoy.mode === 'bench'
                  ? 'Riding the bench · B to step down'
                  : convoy.mode === 'walk'
                    ? 'Walking beside the wagon · B to ride'
                    : `On foot · ${Math.round(convoy.dist)} m from the wagon`,
          )}
        </p>
      ) : null}
      <div class="travel-actions">
        {t.editable && t.hasRoute ? (
          <button
            type="button"
            class="action secondary travel-btn halt"
            onClick={() => commands.toggleHalt()}
          >
            {`${haltLabel(t.halted)} (H)`}
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
        {convoy && !convoy.gone ? (
          <button
            type="button"
            class="action secondary travel-btn bench"
            onClick={() => commands.toggleBench()}
          >
            {convoy.mode === 'bench' ? 'Walk (B)' : 'Ride bench (B)'}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function LeashWarning() {
  const convoy = travelHud.value?.convoy;
  if (!convoy || convoy.leash === 'ok') return null;
  return (
    <div class="hud-box hud-warn travel-leash" role="status">
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
  );
}

function Hud() {
  const view = travelHud.value?.view ?? '';
  const [pulse, setPulse] = useState(false);
  // Flash the controls once per view per session, then they wait behind the K key.
  useEffect(() => {
    if (!view || helpSeen.has(view)) return undefined;
    helpSeen.add(view);
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 7000);
    return () => window.clearTimeout(timer);
  }, [view]);

  const flash = useTransient(savedFlash.value, 2500);
  const helpOpen = settings.value.hud.help || pulse;
  const rightPanel =
    settingsOpen.value || wagonOpen.value || hudMenuOpen.value ? null : settings.value.hud
        .caravan ? (
      <CaravanCard />
    ) : null;
  return (
    <div class="hud">
      <div class="night-veil" style={{ opacity: String(mapNight.value) }} />
      {hudHidden.value ? (
        <button
          type="button"
          class="hud-ghost"
          aria-label="Show HUD"
          title="Show HUD (U)"
          onClick={() => {
            hudHidden.value = false;
          }}
        >
          <HudIcon name="eye" />
        </button>
      ) : (
        <>
          <div class="hud-top">
            <StatusChip />
            <DayCycleHud />
            <div class="hud-right">
              <Toolbar />
              <MoreMenu />
              {rightPanel}
            </div>
          </div>
          <div class="hud-foot">
            <LeashWarning />
            {flash ? (
              <p
                class={
                  savedFlash.value === 'Saved'
                    ? 'hud-box hud-toast flash ok'
                    : 'hud-box hud-toast flash bad'
                }
              >
                {skinText(flash)}
              </p>
            ) : null}
            {notice.value ? <p class="hud-box hud-toast notice">{skinText(notice.value)}</p> : null}
            {helpOpen && hint.value ? (
              <section class="hud-box hud-help hint" aria-label="Controls">
                <p>{skinText(hint.value)}</p>
                <button
                  type="button"
                  class="card-x"
                  aria-label="Close controls"
                  onClick={() => {
                    setPulse(false);
                    setHudPref('help', false);
                  }}
                >
                  <HudIcon name="close" />
                </button>
              </section>
            ) : null}
            {prompt.value ? (
              <p class="hud-box hud-prompt" title={prompt.value}>
                {skinText(prompt.value)}
              </p>
            ) : null}
            {placeName.value ? (
              <section
                class="hud-box place-chip"
                aria-label="Where you stand"
                title={[standLine.value, nearestLine.value].filter(Boolean).join(' · ')}
              >
                <span class="place-text">
                  <span class="place-name">{skinText(placeName.value)}</span>
                  <span class="place-tier">{skinText(placeTier.value || placeKind.value)}</span>
                </span>
                <button
                  type="button"
                  class="action enter-place"
                  disabled={!canEnter.value}
                  title="Walk this ground in 3D (Enter)"
                  onClick={() => commands.enterPlace()}
                >
                  Enter
                </button>
              </section>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function WagonMenu() {
  if (!wagonOpen.value) return null;
  return (
    <section class="hud-box hud-panel wagon-menu" role="dialog" aria-label="Wagon">
      <p class="card-head">
        <span>Camp · Wagon</span>
        <button
          type="button"
          class="card-x"
          aria-label="Close"
          onClick={() => commands.closeWagon()}
        >
          <HudIcon name="close" />
        </button>
      </p>
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
    </section>
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    return true;
  }
  // A focused checkbox, slider, or colour well is not typing; the HUD keys still work.
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'range', 'color', 'button'].includes(target.type);
  }
  return false;
}

/**
 * HUD shortcuts while playing: U hides or shows every HUD element, I the caravan
 * card, O settings, K the controls, T the overworld "time waits / time runs"
 * toggle. H is the caravan's Halt / Roll out, on the map and in 3D.
 */
function useHudKeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (screen.value !== 'play' || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('#mg.open')) return;
      switch (event.code) {
        case 'KeyU':
          hudHidden.value = !hudHidden.value;
          hudMenuOpen.value = false;
          break;
        case 'KeyI':
          hudHidden.value = false;
          setHudPref('caravan', !settings.value.hud.caravan);
          break;
        case 'KeyO':
          toggleSettings();
          break;
        case 'KeyK':
          hudHidden.value = false;
          setHudPref('help', !settings.value.hud.help);
          break;
        case 'KeyT':
          // Map only: 3D ignores the setting, so the shortcut stays off there too.
          if (travelHud.value?.view === 'area') return;
          commands.changeSettings({
            timeOnlyWhenMoving: !settings.value.timeOnlyWhenMoving,
          });
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function Shell() {
  useHudKeys();
  if (screen.value === 'boot') return <BootScreen />;
  if (screen.value === 'creator') return <CreatorScreen />;
  if (screen.value === 'worldgen') return <WorldGenScreen />;
  if (settingsOpen.value && screen.value !== 'play') return <SettingsPanel />;
  return (
    <>
      {screen.value === 'title' ? <TitleScreen /> : <Hud />}
      {screen.value === 'play' ? <WagonMenu /> : null}
      {settingsOpen.value ? <SettingsPanel dock /> : null}
    </>
  );
}
