/**
 * Regions debug panel (R1), separate from the World Gen panel: fake how much
 * has been explored, override the knowledge scale and bend, toggle fog and
 * clouds, add rumours and try "Show me" / "Arrive here", preview fading with a
 * time skip, and read the numbers (frame time included).
 */
import type { ComponentChildren } from 'preact';
import {
  regionsCommands,
  regionsDebug,
  regionsJourney,
  regionsNote,
  regionsReadout,
  regionsRumors,
  regionsSelected,
  type RegionsDebug,
  type RegionsReadout,
  type RegionsTool,
} from './regions-state';

const set = (patch: Partial<RegionsDebug>) => regionsCommands.setDebug(patch);

function Range(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  readout?: string;
  disabled?: boolean;
  onInput: (v: number) => void;
  extra?: ComponentChildren;
  /** One plain line under the label: what the control does. */
  hint?: string;
}) {
  return (
    <label class="rg-row">
      <span class="rg-label">
        {props.label} <em class="wg-readout">{props.readout ?? props.value}</em>
        {props.extra}
      </span>
      {props.hint ? <small class="rg-hint">{props.hint}</small> : null}
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        aria-label={props.label}
        onInput={(e) => {
          const t = e.currentTarget;
          if (t instanceof HTMLInputElement) props.onInput(Number(t.value));
        }}
      />
    </label>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="wg-check">
      <input
        type="checkbox"
        checked={props.checked}
        aria-label={props.label}
        onChange={(e) => {
          const t = e.currentTarget;
          if (t instanceof HTMLInputElement) props.onChange(t.checked);
        }}
      />
      {props.label}
    </label>
  );
}

function Auto(props: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      class={`rg-auto${props.on ? ' on' : ''}`}
      aria-pressed={props.on}
      aria-label={`${props.label} auto`}
      onClick={(e) => {
        e.preventDefault();
        props.onChange(!props.on);
      }}
    >
      auto
    </button>
  );
}

const TOOLS: Array<{ id: RegionsTool; label: string; title: string }> = [
  { id: 'visit', label: 'Visit', title: 'Click a chunk to mark it visited (or forget it)' },
  { id: 'rumor', label: 'Rumour', title: 'Click to add a rumoured place' },
  { id: 'waypoint', label: 'Waypoint', title: 'Click to add journey waypoints' },
  { id: 'centre', label: 'Centre', title: 'Click to move the home / centre chunk' },
];

/** The view's state in plain words. */
export function plainSummary(r: RegionsReadout, d: RegionsDebug): string {
  const across = Math.max(1, Math.round(r.knownSpan));
  const chunks = r.known === 1 ? '1 chunk' : `${r.known} chunks`;
  const showing = r.step <= 1 ? 'showing your chunk' : `showing ${r.step}×${r.step}`;
  const next =
    r.step <= 1
      ? `widens after ${r.nextAt} visited`
      : `${r.step + 1}×${r.step + 1} after ${r.nextAt} visited`;
  let shape: string;
  if (r.bend < 0.01) shape = `flat map, curving starts at ${d.bendStart} across`;
  else if (r.bend < 0.99)
    shape = `curving (${Math.round(r.bend * 100)}%), whole globe at ${d.spanFull} across`;
  else shape = 'the whole globe';
  return `You know ${chunks}, spanning ${across} across; ${showing} (${next}); ${shape}.`;
}

function Readout() {
  const r = regionsReadout.value;
  if (!r) return <p class="note">Waiting for the first frame…</p>;
  return (
    <>
      <p class="rg-summary" aria-live="polite">
        {plainSummary(r, regionsDebug.value)}
      </p>
      <dl class="rg-readout" aria-label="Regions readout">
        <dt>Known</dt>
        <dd>
          {r.known} visited · {r.glimpsed} glimpsed
        </dd>
        <dt>Span</dt>
        <dd>
          {r.knownSpan.toFixed(1)} known · {r.span.toFixed(1)} shown ·{' '}
          {Math.round(r.km).toLocaleString('en-US')} km
        </dd>
        <dt>k / bend</dt>
        <dd>
          {r.k.toFixed(2)} / {r.bend.toFixed(2)} · view ±{r.visibleDeg.toFixed(1)}°
        </dd>
        <dt>Chunk</dt>
        <dd>
          {Math.round(r.chunkPx)} px · clouds ×{r.pixel}
        </dd>
        <dt>Day</dt>
        <dd>{r.today}</dd>
        <dt>Frame</dt>
        <dd>
          {r.frameMs.toFixed(1)} ms avg · {r.frameMax.toFixed(1)} max · GL {r.drawMs.toFixed(1)} ·
          2D {r.overlayMs.toFixed(1)} ({r.stamps} stamps)
        </dd>
        <dt>Detail</dt>
        <dd>
          {r.detailReady} chunk maps{r.detailQueued ? ' · generating…' : ''}
        </dd>
        <dt>Clouds</dt>
        <dd>
          {r.atlas === 'loaded'
            ? 'pixel art'
            : r.atlas === 'failed'
              ? 'procedural (atlas failed)'
              : 'loading…'}
        </dd>
      </dl>
    </>
  );
}

function Rumors() {
  const list = regionsRumors.value;
  const sel = regionsSelected.value;
  const view = regionsReadout.value?.view ?? 'you';
  return (
    <div class="rg-rumors">
      {list.length === 0 ? (
        <p class="note">Pick the Rumour tool and click the map to add one.</p>
      ) : null}
      {list.map((r) => (
        <div key={r.id} class={`rg-rumor${sel === r.id ? ' on' : ''}`}>
          <button type="button" class="rg-rumor-name" onClick={() => regionsCommands.select(r.id)}>
            {r.arrived ? '✓ ' : ''}
            {r.believed.name}
          </button>
          <span class="rg-rumor-meta">
            {r.source} · {Math.round(r.confidence * 100)}% ·{' '}
            {r.directionKnown ? 'direction known' : 'no direction'}
          </span>
          {sel === r.id ? (
            <span class="rg-rumor-actions">
              <button
                type="button"
                class="action secondary"
                onClick={() => regionsCommands.showMe(r.id)}
              >
                Show me
              </button>
              <button
                type="button"
                class="action secondary"
                disabled={r.arrived}
                onClick={() => regionsCommands.arrive(r.id)}
              >
                Arrive here
              </button>
              <button
                type="button"
                class="action secondary"
                onClick={() => regionsCommands.forget(r.id)}
              >
                Forget
              </button>
            </span>
          ) : null}
        </div>
      ))}
      {view !== 'you' ? (
        <button type="button" class="action rg-back" onClick={() => regionsCommands.backToMe()}>
          Back to me
        </button>
      ) : null}
    </div>
  );
}

export function RegionsPanel() {
  const d = regionsDebug.value;
  const j = regionsJourney.value;
  const note = regionsNote.value;
  return (
    <section
      class={`wg-regions-panel tb-scroll${d.collapsed ? ' collapsed' : ''}`}
      aria-label="Regions debug"
    >
      <header class="rg-head">
        <strong>Regions debug</strong>
        <button
          type="button"
          class="rg-collapse"
          aria-expanded={!d.collapsed}
          onClick={() => set({ collapsed: !d.collapsed })}
        >
          {d.collapsed ? 'Show' : 'Hide'}
        </button>
      </header>
      {d.collapsed ? null : (
        <>
          <Readout />
          <h4>Click tool</h4>
          <div class="rg-tools" role="group" aria-label="Click tool">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.title}
                class={`rg-tool${d.tool === t.id ? ' on' : ''}`}
                aria-pressed={d.tool === t.id}
                onClick={() => set({ tool: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>

          <h4>Explored (simulated)</h4>
          <div class="rg-tools" role="group" aria-label="Exploration">
            {(['count', 'block', 'walk', 'journey'] as const).map((e) => (
              <button
                key={e}
                type="button"
                class={`rg-tool${d.explore === e ? ' on' : ''}`}
                aria-pressed={d.explore === e}
                onClick={() => set({ explore: e })}
              >
                {e === 'count'
                  ? 'Visited'
                  : e === 'block'
                    ? 'Radius'
                    : e === 'walk'
                      ? 'Random walk'
                      : 'Journey'}
              </button>
            ))}
          </div>
          {d.explore === 'count' ? (
            <Range
              label="Visited chunks"
              value={d.visitCount}
              min={1}
              max={400}
              step={1}
              hint="A compact patch this big, nearest your centre chunk first."
              onInput={(v) => set({ visitCount: v })}
            />
          ) : null}
          {d.explore === 'block' ? (
            <Range
              label="Known block"
              value={d.block}
              min={1}
              max={30}
              step={1}
              readout={`${d.block}×${d.block}`}
              onInput={(v) => set({ block: v })}
            />
          ) : null}
          {d.explore === 'walk' ? (
            <>
              <Range
                label="Walk steps"
                value={d.walkSteps}
                min={2}
                max={400}
                step={1}
                onInput={(v) => set({ walkSteps: v })}
              />
              <button
                type="button"
                class="action secondary"
                onClick={() => regionsCommands.newWalk()}
              >
                New walk (seed {d.walkSeed})
              </button>
            </>
          ) : null}
          {d.explore === 'journey' ? (
            <>
              <p class="note">
                {j.waypoints} waypoints · {j.length} chunks · {Math.round(j.progress * 100)}%
              </p>
              <div class="rg-tools">
                <button
                  type="button"
                  class="action secondary"
                  onClick={() =>
                    j.playing ? regionsCommands.pauseJourney() : regionsCommands.playJourney()
                  }
                >
                  {j.playing ? 'Pause' : 'Play journey'}
                </button>
                <button
                  type="button"
                  class="action secondary"
                  onClick={() => regionsCommands.rewindJourney()}
                >
                  Rewind
                </button>
                <button
                  type="button"
                  class="action secondary"
                  onClick={() => regionsCommands.clearWaypoints()}
                >
                  Clear
                </button>
              </div>
              <Range
                label="Speed"
                value={d.playSpeed}
                min={0.5}
                max={20}
                step={0.5}
                readout={`${d.playSpeed} chunks/s`}
                onInput={(v) => set({ playSpeed: v })}
              />
            </>
          ) : null}
          <div class="rg-tools">
            <button
              type="button"
              class="action secondary"
              onClick={() => regionsCommands.clearVisits()}
            >
              Clear clicked visits
            </button>
            <button
              type="button"
              class="action secondary"
              onClick={() => regionsCommands.recentre()}
            >
              Recentre
            </button>
          </div>

          <h4>How the view grows</h4>
          <Range
            label="Visited chunks before the view widens"
            value={d.widenAfter}
            min={1}
            max={12}
            step={1}
            readout={`${d.widenAfter}`}
            hint="Until then the view stays on the chunk you're in."
            onInput={(v) => set({ widenAfter: v })}
          />
          <Range
            label="How full a step must be"
            value={d.stepFill}
            min={0.3}
            max={1.5}
            step={0.05}
            readout={`${Math.round(d.stepFill * 100)}%`}
            hint={`The view frames N×N once N² × this many chunks are visited (3×3 needs ${Math.ceil(9 * d.stepFill - 1e-9)}).`}
            onInput={(v) => set({ stepFill: v })}
          />
          <Range
            label="Start curving at"
            value={d.bendStart}
            min={2}
            max={30}
            step={1}
            readout={`${d.bendStart} chunks across`}
            hint="Below this the map is flat."
            onInput={(v) => set({ bendStart: v, spanFull: Math.max(d.spanFull, v + 1) })}
          />
          <Range
            label="Full globe at"
            value={d.spanFull}
            min={Math.max(4, d.bendStart + 1)}
            max={80}
            step={1}
            readout={`${d.spanFull} chunks across`}
            hint="The view has become the whole planet by here."
            onInput={(v) => set({ spanFull: v })}
          />
          <Range
            label="Reveal speed"
            value={d.revealSeconds}
            min={0}
            max={12}
            step={0.5}
            readout={`${d.revealSeconds} s`}
            hint="How long the view takes to ease out when you learn a new chunk."
            onInput={(v) => set({ revealSeconds: v })}
          />
          <Range
            label="Haze around visited chunks"
            value={d.hazeRings}
            min={0}
            max={3}
            step={1}
            readout={d.hazeRings === 1 ? '1 ring' : `${d.hazeRings} rings`}
            hint="Chunks this close to where you've been show through a light haze."
            onInput={(v) => set({ hazeRings: v })}
          />
          <details
            class="rg-advanced"
            open={d.advanced}
            onToggle={(e) => {
              const t = e.currentTarget;
              if (t instanceof HTMLDetailsElement && t.open !== d.advanced)
                set({ advanced: t.open });
            }}
          >
            <summary>Advanced (raw k / bend)</summary>
            <Range
              label="Knowledge k"
              value={d.k}
              min={0}
              max={1}
              step={0.01}
              readout={d.kAuto ? 'auto' : d.k.toFixed(2)}
              disabled={d.kAuto}
              hint="0 = one chunk fills the view, 1 = the whole globe (log of chunks across)."
              onInput={(v) => set({ k: v })}
              extra={
                <Auto
                  label="Knowledge"
                  on={d.kAuto}
                  onChange={(v) => set({ kAuto: v, k: regionsReadout.value?.k ?? d.k })}
                />
              }
            />
            <Range
              label="Bend"
              value={d.bend}
              min={0}
              max={1}
              step={0.01}
              readout={d.bendAuto ? 'auto' : d.bend.toFixed(2)}
              disabled={d.bendAuto}
              hint="0 = flat map, 1 = globe."
              onInput={(v) => set({ bend: v })}
              extra={
                <Auto
                  label="Bend"
                  on={d.bendAuto}
                  onChange={(v) => set({ bendAuto: v, bend: regionsReadout.value?.bend ?? d.bend })}
                />
              }
            />
            <Range
              label="Room around the view"
              value={d.margin}
              min={1}
              max={2.5}
              step={0.05}
              readout={`×${d.margin.toFixed(2)}`}
              hint="Extra space around the framed chunks."
              onInput={(v) => set({ margin: v })}
            />
          </details>

          <h4>Fog and clouds</h4>
          <div class="wg-layers">
            <Check label="Fog of war" checked={d.fog} onChange={(v) => set({ fog: v })} />
            <Check label="Known mask" checked={d.maskView} onChange={(v) => set({ maskView: v })} />
            <Check label="Truth overlay" checked={d.truth} onChange={(v) => set({ truth: v })} />
            <Check label="Chunk maps" checked={d.detail} onChange={(v) => set({ detail: v })} />
          </div>
          <label class="rg-row">
            <span class="rg-label">Clouds</span>
            <select
              value={d.clouds}
              aria-label="Cloud style"
              onChange={(e) => {
                const t = e.currentTarget;
                if (t instanceof HTMLSelectElement)
                  set({ clouds: t.value as RegionsDebug['clouds'] });
              }}
            >
              <option value="art">Pixel art (Alex’s set)</option>
              <option value="procedural">Procedural fallback</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label class="rg-row">
            <span class="rg-label">Cover tile</span>
            <select
              value={d.coverTile}
              aria-label="Cover tile"
              onChange={(e) => {
                const t = e.currentTarget;
                if (t instanceof HTMLSelectElement) set({ coverTile: t.value === 'B' ? 'B' : 'A' });
              }}
            >
              <option value="A">A (dense)</option>
              <option value="B">B (broken)</option>
            </select>
          </label>
          <label class="rg-row">
            <span class="rg-label">Chunk map scale</span>
            <select
              value={String(d.detailScale)}
              aria-label="Chunk map scale"
              onChange={(e) => {
                const t = e.currentTarget;
                if (t instanceof HTMLSelectElement) {
                  set({ detailScale: t.value === 'world' ? 'world' : t.value === '4' ? 4 : 1 });
                }
              }}
            >
              <option value="1">1× (fast preview)</option>
              <option value="4">4×</option>
              <option value="world">World scale (slow)</option>
            </select>
          </label>
          <Range
            label="Density"
            value={d.density}
            min={0}
            max={1}
            step={0.05}
            readout={d.density.toFixed(2)}
            onInput={(v) => set({ density: v })}
          />
          <Range
            label="Drift"
            value={d.drift}
            min={0}
            max={6}
            step={0.25}
            readout={`×${d.drift}`}
            onInput={(v) => set({ drift: v })}
          />

          <h4>Time</h4>
          <Range
            label="Skip ahead"
            value={d.timeSkip}
            min={0}
            max={120}
            step={1}
            readout={`${d.timeSkip} days`}
            onInput={(v) => set({ timeSkip: v })}
          />
          <p class="note">
            Fades from ~10 days away, levels off at ~60 (half colour, light haze). Never clouds
            again.
          </p>

          <h4>Rumours</h4>
          <Range
            label="New rumour confidence"
            value={d.rumorConfidence}
            min={0}
            max={1}
            step={0.05}
            readout={`${Math.round(d.rumorConfidence * 100)}%`}
            onInput={(v) => set({ rumorConfidence: v })}
          />
          <Check
            label="Direction known"
            checked={d.rumorDirection}
            onChange={(v) => set({ rumorDirection: v })}
          />
          <Rumors />
          {note ? (
            <div class="rg-note" role="status">
              <strong>Codex</strong>
              <span>
                Heard ({note.source}): {note.heard}
              </span>
              <span>Found: {note.found}</span>
            </div>
          ) : null}
          <div class="rg-tools">
            <button
              type="button"
              class="action secondary"
              onClick={() => regionsCommands.clearRumors()}
            >
              Clear rumours
            </button>
            <button type="button" class="action secondary" onClick={() => regionsCommands.reset()}>
              Reset all
            </button>
          </div>
        </>
      )}
    </section>
  );
}
