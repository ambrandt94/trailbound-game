/**
 * World Gen screen panel: world source and seed, chunk size and count, shape
 * sliders, layers, the start chunk and the chunk inspector. The planet view
 * itself is drawn by the World Gen scene behind this panel.
 */
import { BiomeLegend } from './biome-legend';
import {
  chunkKey,
  FACE_NAMES,
  isPlanetPreset,
  isWorldSource,
  PLANET_PRESETS,
  PLANET_PRESET_SPECS,
  WORLD_SOURCES,
  WORLD_SOURCE_LABELS,
  type ChunkAddr,
} from '../core/planet';
import {
  BIOME_LABELS,
  EXPERIMENTAL_WORLD_SCALES,
  LAND_CHOICES,
  LAND_CHOICE_LABELS,
  WORLD_SCALES,
  worldExtent,
  worldSizeKm,
  type LandStyle,
  type WorldScale,
  type WorldSettings,
} from '../core/world/models';
import { newWorldLand, newWorldSeed, newWorldSettings } from './creator-state';
import {
  wgBake,
  wgCached,
  wgChunk,
  wgClock,
  wgCommands,
  wgExisting,
  wgInspect,
  wgLayers,
  wgMode,
  wgPickStart,
  wgStart,
  wgStarts,
  type WgLayers,
  type WgMode,
} from './worldgen-state';

function addrLabel(a: ChunkAddr): string {
  return `${FACE_NAMES[a.face]} face (${a.cx}, ${a.cy})`;
}

function km(v: number): string {
  return v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
}

const MODES: Array<{ id: WgMode; label: string }> = [
  { id: 'globe', label: 'Globe' },
  { id: 'flat', label: 'World map' },
  { id: 'chunk', label: 'Chunk' },
];

const LAYERS: Array<{ id: keyof WgLayers; label: string }> = [
  { id: 'biomes', label: 'Biomes' },
  { id: 'height', label: 'Heightmap' },
  { id: 'mask', label: 'Land mask' },
  { id: 'grid', label: 'Chunk grid' },
  { id: 'ice', label: 'Ice' },
  { id: 'start', label: 'Start chunk' },
  { id: 'overlay', label: 'Biome overlay' },
];

/**
 * Globe · World map · Chunk. The thumb slides with the view's own transition;
 * "Chunk" opens the inspected chunk (or the start), generating it first if
 * needed, with a spinner until its map is ready.
 */
function ModeToggle() {
  const mode = wgMode.value;
  const job = wgChunk.value;
  const target = wgInspect.value?.addr ?? wgStart.value?.addr ?? null;
  const pending = job?.state === 'generating';
  const at = Math.max(
    0,
    MODES.findIndex((m) => m.id === mode),
  );
  return (
    <div class="wg-modes" role="group" aria-label="View" data-pending={pending ? 'yes' : 'no'}>
      <span
        class="wg-mode-thumb"
        aria-hidden="true"
        style={{ transform: `translateX(${at * 100}%)` }}
      />
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          class={`wg-mode${mode === m.id ? ' on' : ''}`}
          aria-pressed={mode === m.id}
          disabled={m.id === 'chunk' && !target && job?.state !== 'ready'}
          title={m.id === 'chunk' ? 'Fly into the selected chunk' : undefined}
          onClick={() => wgCommands.setMode(m.id)}
        >
          {m.id === 'chunk' && pending ? <span class="wg-spin" aria-label="Generating" /> : null}
          {m.label}
        </button>
      ))}
    </div>
  );
}

function Slider(props: {
  id: 'seaLevel' | 'tempBias' | 'moistBias';
  label: string;
  readout: string;
  settings: WorldSettings;
  disabled: boolean;
}) {
  return (
    <label class="field">
      <span>
        {props.label} <em class="wg-readout">{props.readout}</em>
      </span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={props.settings[props.id]}
        aria-label={props.label}
        disabled={props.disabled}
        onInput={(event) => {
          const target = event.currentTarget;
          if (target instanceof HTMLInputElement) {
            wgCommands.setSettings({ [props.id]: Number(target.value) });
          }
        }}
      />
    </label>
  );
}

function bias(v: number, neg: string, pos: string): string {
  if (Math.abs(v) < 0.025) return 'as authored';
  return `${v > 0 ? pos : neg} ${Math.round(Math.abs(v) * 100)}%`;
}

function ChunkInspector() {
  const info = wgInspect.value;
  const job = wgChunk.value;
  void wgClock.value;
  if (!info) {
    return (
      <p class="note">
        Click any chunk on the globe or world map to generate its full local map and zoom in.
      </p>
    );
  }
  const start = wgStart.value;
  const isStart = !!start && chunkKey(start.addr) === chunkKey(info.addr);
  const jobHere = job && chunkKey(job.addr) === chunkKey(info.addr) ? job : null;
  const progress =
    jobHere?.state === 'generating'
      ? Math.min(0.95, (performance.now() - jobHere.startedAt) / Math.max(1, jobHere.estimateMs))
      : 0;
  return (
    <div class="wg-inspect" aria-label="Chunk inspector">
      <p class="wg-addr">
        {addrLabel(info.addr)}
        {isStart ? <span class="wg-tag">start</span> : null}
      </p>
      <dl class="wg-stats">
        <dt>Lat / long</dt>
        <dd>
          {info.latDeg.toFixed(1)}°, {info.lonDeg.toFixed(1)}°
        </dd>
        <dt>Land</dt>
        <dd>{Math.round(info.land * 100)}%</dd>
        <dt>Elevation</dt>
        <dd>
          {Math.round(info.minM)} to {Math.round(info.maxM)} m
        </dd>
        <dt>Biomes</dt>
        <dd>
          {info.biomes.length
            ? info.biomes
                .map((b) => `${BIOME_LABELS[b.biome]} ${Math.round(b.share * 100)}%`)
                .join(', ')
            : 'open sea'}
        </dd>
        <dt>Start score</dt>
        <dd>
          {info.score.toFixed(2)}
          {info.score < 0.05 ? ' (poor start)' : ''}
        </dd>
      </dl>
      {jobHere?.state === 'generating' ? (
        <div class="wg-progress" data-state="generating">
          <span>Generating {jobHere.estimateMs > 2000 ? 'the full map' : 'map'}…</span>
          <progress max={1} value={progress} aria-label="Chunk map progress" />
          <button type="button" class="action secondary" onClick={() => wgCommands.cancelChunk()}>
            Cancel
          </button>
        </div>
      ) : null}
      {jobHere?.state === 'error' ? (
        <p class="note">Could not generate: {jobHere.message}</p>
      ) : null}
      {jobHere?.state === 'ready' ? (
        <div class="wg-progress" data-state="ready">
          <span>
            {jobHere.tiles}² tiles, {Math.round(jobHere.land * 100)}% land, {jobHere.towns} towns
            {jobHere.cached ? ' (cached)' : ` in ${(jobHere.genMs / 1000).toFixed(1)} s`}
          </span>
          {wgMode.value !== 'chunk' ? (
            <button type="button" class="action" onClick={() => wgCommands.setMode('chunk')}>
              Zoom in
            </button>
          ) : null}
        </div>
      ) : null}
      {!jobHere ? (
        <button type="button" class="action" onClick={() => wgCommands.openChunk(info.addr)}>
          Generate this chunk
        </button>
      ) : null}
    </div>
  );
}

export function WorldGenScreen() {
  const existing = wgExisting.value;
  const readOnly = !!existing;
  const s = existing ? existing.settings : newWorldSettings();
  const seed = existing ? existing.seed : newWorldSeed.value;
  const bake = wgBake.value;
  const n = PLANET_PRESET_SPECS[s.planet].n;
  const chunkKm = worldSizeKm(s.worldScale);
  const island = s.worldSource === 'island';
  const layers = wgLayers.value;
  const start = wgStart.value;
  const starts = wgStarts.value;
  return (
    <div class="wg-screen" data-wg-mode={wgMode.value} data-wg-bake={bake.state}>
      <ModeToggle />
      {layers.overlay ? <BiomeLegend class="wg-legend" /> : null}
      {wgMode.value === 'chunk' ? (
        <button
          type="button"
          class="wg-back action secondary"
          onClick={() => wgCommands.backToPlanet()}
        >
          Back
        </button>
      ) : null}
      <div class="wg-status" aria-live="polite">
        {bake.state === 'baking' ? `Baking planet… ${Math.round(bake.progress * 100)}%` : null}
        {bake.state === 'preview' ? 'Preview — sharpening…' : null}
        {bake.state === 'error' ? `Bake failed: ${bake.message}` : null}
        {bake.message && bake.state !== 'error' ? bake.message : null}
        {wgPickStart.value ? ' Click a land chunk to start there.' : null}
      </div>
      <section class="wg-panel tb-scroll" aria-label="World Gen">
        <h2>{readOnly ? 'Your world' : 'World Gen'}</h2>
        {readOnly ? (
          <p class="lede tight">
            Settings are fixed for a world in play. Click any chunk to look at it.
          </p>
        ) : (
          <p class="lede tight">Shape the planet, pick where you start, and look at any chunk.</p>
        )}

        <h3 class="tb-heading">World</h3>
        <label class="field">
          <span>Source</span>
          <select
            aria-label="World source"
            value={s.worldSource}
            disabled={readOnly}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLSelectElement && isWorldSource(target.value)) {
                wgCommands.setSettings({ worldSource: target.value });
              }
            }}
          >
            {WORLD_SOURCES.map((src) => (
              <option key={src} value={src}>
                {WORLD_SOURCE_LABELS[src]}
              </option>
            ))}
          </select>
        </label>
        <div class="field-row wg-seed">
          <label class="field">
            <span>Seed</span>
            <input
              type="number"
              aria-label="Seed"
              value={seed}
              disabled={readOnly}
              onChange={(event) => {
                const target = event.currentTarget;
                if (target instanceof HTMLInputElement) wgCommands.setSeed(Number(target.value));
              }}
            />
          </label>
          <button
            type="button"
            class="action secondary"
            disabled={readOnly}
            title="Re-roll the seed"
            onClick={() => wgCommands.rerollSeed()}
          >
            Re-roll
          </button>
        </div>
        {island && !readOnly ? (
          <label class="field">
            <span>Land</span>
            <select
              aria-label="Island land"
              value={newWorldLand.value}
              onChange={(event) => {
                const target = event.currentTarget;
                if (target instanceof HTMLSelectElement) {
                  const next = target.value;
                  if ((LAND_CHOICES as readonly string[]).includes(next)) {
                    newWorldLand.value = next as LandStyle;
                  }
                }
              }}
            >
              {LAND_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {LAND_CHOICE_LABELS[choice]}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <h3 class="tb-heading">Chunks</h3>
        <label class="field">
          <span>Chunks per face</span>
          <select
            aria-label="Chunks per face"
            value={s.planet}
            disabled={readOnly}
            onChange={(event) => {
              const target = event.currentTarget;
              if (target instanceof HTMLSelectElement && isPlanetPreset(target.value)) {
                wgCommands.setSettings({ planet: target.value });
              }
            }}
          >
            {PLANET_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PLANET_PRESET_SPECS[p].label}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Chunk resolution</span>
          <select
            aria-label="Chunk resolution"
            value={String(s.worldScale)}
            disabled={readOnly}
            onChange={(event) => {
              const target = event.currentTarget;
              if (!(target instanceof HTMLSelectElement)) return;
              const next = Number(target.value);
              if ((WORLD_SCALES as readonly number[]).includes(next)) {
                wgCommands.setSettings({ worldScale: next as WorldScale });
              }
            }}
          >
            {WORLD_SCALES.map((scale) => (
              <option key={scale} value={String(scale)}>
                {scale}× · {worldExtent(scale)}² tiles · {km(worldSizeKm(scale))} km
                {EXPERIMENTAL_WORLD_SCALES.includes(scale) ? ' (experimental)' : ''}
              </option>
            ))}
          </select>
        </label>
        <p class="note wg-readout-line">
          {(6 * n * n).toLocaleString('en-US')} chunks, about {km(4 * n * chunkKm)} km around the
          equator; each chunk ≈ {km(chunkKm)} km.
          {EXPERIMENTAL_WORLD_SCALES.includes(s.worldScale)
            ? ' 32× uses about four times the memory of 16×.'
            : ''}
        </p>

        {!island ? (
          <>
            <h3 class="tb-heading">Shape and climate</h3>
            <Slider
              id="seaLevel"
              label="Sea level"
              readout={`${Math.round(bake.landShare * 100)}% land`}
              settings={s}
              disabled={readOnly}
            />
            <Slider
              id="tempBias"
              label="Temperature"
              readout={bias(s.tempBias, 'colder', 'warmer')}
              settings={s}
              disabled={readOnly}
            />
            <Slider
              id="moistBias"
              label="Moisture"
              readout={bias(s.moistBias, 'drier', 'wetter')}
              settings={s}
              disabled={readOnly}
            />
          </>
        ) : null}

        <h3 class="tb-heading">Layers</h3>
        <div class="wg-layers">
          {LAYERS.map((l) => (
            <label key={l.id} class="wg-check">
              <input
                type="checkbox"
                checked={layers[l.id]}
                aria-label={l.label}
                onChange={(event) => {
                  const target = event.currentTarget;
                  if (target instanceof HTMLInputElement) {
                    wgCommands.setLayers({ [l.id]: target.checked });
                  }
                }}
              />
              {l.label}
            </label>
          ))}
        </div>

        <h3 class="tb-heading">Start</h3>
        <p class="note">
          {start
            ? `${addrLabel(start.addr)} — ${
                start.how === 'auto'
                  ? 'auto pick'
                  : start.how === 'reroll'
                    ? 'rerolled'
                    : 'hand picked'
              }`
            : bake.state === 'ready'
              ? 'No good start found.'
              : 'Finding the best start…'}
        </p>
        {!readOnly && !island ? (
          <div class="actions wg-start">
            <button
              type="button"
              class="action secondary"
              aria-pressed={start?.how === 'auto'}
              onClick={() => wgCommands.autoStart()}
            >
              Auto
            </button>
            <button
              type="button"
              class="action secondary"
              disabled={starts.length < 2}
              onClick={() => wgCommands.rerollStart()}
            >
              Reroll start
            </button>
            <button
              type="button"
              class="action secondary"
              aria-pressed={wgPickStart.value}
              onClick={() => wgCommands.togglePickStart()}
            >
              {wgPickStart.value ? 'Picking…' : 'Pick on map'}
            </button>
          </div>
        ) : null}

        <h3 class="tb-heading">Chunk inspector</h3>
        <ChunkInspector />
        {wgCached.value.length ? (
          <p class="note wg-cache">
            {wgCached.value.length} chunk map{wgCached.value.length === 1 ? '' : 's'} held in memory
            while this screen is open.
          </p>
        ) : null}

        <div class="actions wg-actions">
          {readOnly ? (
            <button type="button" class="action" onClick={() => wgCommands.close()}>
              Back to the road
            </button>
          ) : (
            <>
              <button type="button" class="action" onClick={() => wgCommands.confirm()}>
                Choose character
              </button>
              <button
                type="button"
                class="action secondary"
                onClick={() => wgCommands.quickStart()}
              >
                Quick start
              </button>
              <button type="button" class="action secondary" onClick={() => wgCommands.close()}>
                Back
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
