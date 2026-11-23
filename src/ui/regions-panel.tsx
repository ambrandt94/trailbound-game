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
}) {
  return (
    <label class="rg-row">
      <span class="rg-label">
        {props.label} <em class="wg-readout">{props.readout ?? props.value}</em>
        {props.extra}
      </span>
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

function Readout() {
  const r = regionsReadout.value;
  if (!r) return <p class="note">Waiting for the first frame…</p>;
  return (
    <dl class="rg-readout" aria-label="Regions readout">
      <dt>Known</dt>
      <dd>
        {r.known} visited · {r.glimpsed} glimpsed
      </dd>
      <dt>Span</dt>
      <dd>
        {r.span.toFixed(1)} chunks · {Math.round(r.km).toLocaleString('en-US')} km
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
        {r.frameMs.toFixed(1)} ms avg · {r.frameMax.toFixed(1)} max · GL {r.drawMs.toFixed(1)} · 2D{' '}
        {r.overlayMs.toFixed(1)} ({r.stamps} stamps)
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
            {(['block', 'walk', 'journey'] as const).map((e) => (
              <button
                key={e}
                type="button"
                class={`rg-tool${d.explore === e ? ' on' : ''}`}
                aria-pressed={d.explore === e}
                onClick={() => set({ explore: e })}
              >
                {e === 'block' ? 'Radius' : e === 'walk' ? 'Random walk' : 'Journey'}
              </button>
            ))}
          </div>
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

          <h4>View</h4>
          <Range
            label="Knowledge k"
            value={d.k}
            min={0}
            max={1}
            step={0.01}
            readout={d.kAuto ? 'auto' : d.k.toFixed(2)}
            disabled={d.kAuto}
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
            label="Bend starts at"
            value={d.bendStart}
            min={2}
            max={15}
            step={0.5}
            readout={`${d.bendStart} chunks`}
            onInput={(v) => set({ bendStart: v })}
          />
          <Range
            label="Whole globe at"
            value={d.spanFull}
            min={8}
            max={60}
            step={1}
            readout={`${d.spanFull} chunks`}
            onInput={(v) => set({ spanFull: v })}
          />
          <Range
            label="Margin"
            value={d.margin}
            min={1}
            max={2.5}
            step={0.05}
            readout={`×${d.margin.toFixed(2)}`}
            onInput={(v) => set({ margin: v })}
          />

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
