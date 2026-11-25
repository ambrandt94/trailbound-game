import { weaponById, weapons, type ComboSpec } from '../core/combat';
import { skinText } from './glyphs';
import {
  dojoAggression,
  dojoAttackRate,
  dojoCounterMs,
  dojoEnemies,
  dojoHitboxes,
  dojoHoldMs,
  dojoLockHoldMs,
  dojoHud,
  dojoNotice,
  dojoTimeScale,
  dojoWeapon,
} from './dojo-state';
import { commands } from './state';

function stepLabel(combo: ComboSpec): string {
  return combo.sequence
    .map((step) =>
      step.kind === 'hold' ? `${step.button.toUpperCase()} hold` : step.button.toUpperCase(),
    )
    .join(' · ');
}

function pickWeapon(id: string): void {
  dojoWeapon.value = id;
  dojoCounterMs.value = weaponById(id).counterWindowMs;
}

export function DojoScreen() {
  const hud = dojoHud.value;
  const style = weaponById(dojoWeapon.value);
  const counterOpen = hud?.enemies.some((enemy) => enemy.telegraph === 'open') ?? false;
  return (
    <>
      <div class="dojo-readout">
        <p class="dojo-hp">
          {skinText(`You ${hud ? hud.playerHp : '—'}/${hud ? hud.playerMax : '—'}`)}
          {hud?.move ? <small>{skinText(hud.move)}</small> : null}
        </p>
        <ul class="dojo-enemies">
          {(hud?.enemies ?? []).map((enemy, index) => (
            <li key={enemy.id} data-telegraph={enemy.telegraph}>
              {skinText(`Foe ${index + 1} ${enemy.hp}/${enemy.max}`)}
              {enemy.telegraph === 'open' ? <em> counter</em> : null}
            </li>
          ))}
        </ul>
        {counterOpen ? <p class="dojo-cue">Counter</p> : null}
        {hud?.lockId ? <p class="dojo-lock">Locked</p> : null}
        {hud && hud.ready < 5 ? (
          <p class="dojo-loading">{skinText(`Forging bodies ${hud.ready}/5`)}</p>
        ) : null}
        {dojoNotice.value ? <p class="dojo-notice">{skinText(dojoNotice.value)}</p> : null}
        {dojoHitboxes.value && hud?.move ? (
          <p class="dojo-timing">{skinText(`Window: ${hud.move}`)}</p>
        ) : null}
      </div>
      <aside class="dojo-panel" aria-label="Dojo">
        <header class="dojo-head">
          <p class="eyebrow">Dojo</p>
          <h2>{skinText(style.name)}</h2>
          <p>{skinText(style.blurb)}</p>
        </header>
        <div class="dojo-weapons" role="group" aria-label="Weapon style">
          {weapons().map((item) => (
            <button
              key={item.id}
              type="button"
              class={item.id === style.id ? 'action' : 'action secondary'}
              data-dojo-weapon={item.id}
              aria-pressed={item.id === style.id}
              onClick={() => pickWeapon(item.id)}
            >
              {skinText(item.name)}
            </button>
          ))}
        </div>
        <label class="dojo-field">
          <span>Enemies {dojoEnemies.value}</span>
          <input
            type="range"
            min="1"
            max="4"
            step="1"
            value={dojoEnemies.value}
            onInput={(event) => {
              dojoEnemies.value = Number((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        <label class="dojo-field">
          <span>Aggression {dojoAggression.value.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={dojoAggression.value}
            onInput={(event) => {
              dojoAggression.value = Number((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        <label class="dojo-field">
          <span>Attack rate {dojoAttackRate.value.toFixed(2)} /s</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={dojoAttackRate.value}
            onInput={(event) => {
              dojoAttackRate.value = Number((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        <label class="dojo-field">
          <span>Counter window {dojoCounterMs.value} ms</span>
          <input
            type="range"
            min="80"
            max="700"
            step="10"
            value={dojoCounterMs.value}
            onInput={(event) => {
              dojoCounterMs.value = Number((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        <label class="dojo-field">
          <span>Hold threshold {dojoHoldMs.value} ms</span>
          <input
            type="range"
            min="120"
            max="600"
            step="10"
            value={dojoHoldMs.value}
            onInput={(event) => {
              dojoHoldMs.value = Number((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        <label class="dojo-field">
          <span>Lock hold {dojoLockHoldMs.value} ms</span>
          <input
            type="range"
            min="120"
            max="600"
            step="10"
            value={dojoLockHoldMs.value}
            onInput={(event) => {
              dojoLockHoldMs.value = Number((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        <label class="dojo-field">
          <span>Time scale {dojoTimeScale.value.toFixed(2)}</span>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={dojoTimeScale.value}
            onInput={(event) => {
              dojoTimeScale.value = Number((event.currentTarget as HTMLInputElement).value);
            }}
          />
        </label>
        <label class="dojo-check">
          <input
            type="checkbox"
            checked={dojoHitboxes.value}
            onChange={(event) => {
              dojoHitboxes.value = (event.currentTarget as HTMLInputElement).checked;
            }}
          />
          <span>Show hitboxes and timing windows</span>
        </label>
        <div class="dojo-combos">
          <p class="eyebrow">Combos</p>
          <ul>
            {style.combos.map((combo) => (
              <li key={combo.id}>
                <strong>{skinText(stepLabel(combo))}</strong>
                <span>
                  {skinText(combo.name)}
                  {combo.ender ? ' · ender' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div class="dojo-controls">
          <p class="eyebrow">Controls</p>
          <ul>
            <li>WASD move</li>
            <li>J or left click — X</li>
            <li>K or right click — Y</li>
            <li>Space or L — counter</li>
            <li>Tab, middle click, or R3 — lock on</li>
            <li>Tap cycles foes. Hold clears the lock.</li>
            <li>Q / E orbit</li>
            <li>Pad: stick, X, Y, B counter</li>
          </ul>
        </div>
        <button type="button" class="action secondary" onClick={() => commands.leaveDojo()}>
          Back
        </button>
      </aside>
    </>
  );
}
