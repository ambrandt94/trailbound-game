import { expect, test } from 'vitest';
import { createParty, type MinigameResult, type ResolvedMinigame } from '../../src/core/sim/party';
import { MinigameHost } from '../../src/minigames/host';
import { registerMinigame } from '../../src/minigames/registry';
import type { MinigameActionSource } from '../../src/minigames/input-bridge';
import type { MinigameDef } from '../../src/minigames/types';

test('the host reads confirm and quit from the area actions and applies one result', () => {
  const source = new ScriptedSource();
  const applied: MinigameResult[] = [];
  const root = document.createElement('div');
  document.body.append(root);
  let party = { ...createParty(), meals: 1 };
  const host = new MinigameHost({
    root,
    source,
    readParty: () => party,
    apply: (result) => {
      applied.push(result);
      party = { ...party, meals: party.meals + (result.mealsDelta ?? 0) };
      return { party, tu: result.tu ?? 0, message: result.message, lines: ['TU +3'] };
    },
  });
  const def: MinigameDef = {
    id: 'host_probe',
    name: 'Probe',
    type: 'pop2d',
    size: 'part',
    activity: 'eat',
    start() {
      return;
    },
    update(g) {
      if (g.quit) g.done({ ok: false, message: 'You let it go.', activity: 'eat' });
      else if (g.act)
        g.done({ ok: true, message: 'Bitten.', activity: 'eat', mealsDelta: -1, tu: 3 });
    },
  };
  registerMinigame(def);
  host.arm(def);
  expect(host.isOpen()).toBe(true);
  expect(host.locksAreaInput()).toBe(true);
  source.queue({ jump: true });
  host.tick(0.016);
  expect(applied).toHaveLength(1);
  expect(applied[0]?.ok).toBe(true);
  expect(host.snapshot().phase).toBe('card');
  source.queue({ escape: true });
  host.tick(0.016);
  expect(host.isOpen()).toBe(false);
  expect(root.dataset.minigame).toBe('');
  const shell = document.querySelector('#mg');
  expect(shell).toBeInstanceOf(HTMLElement);
  if (!(shell instanceof HTMLElement)) throw new Error('missing overlay');
  expect(shell.hidden).toBe(true);
  expect(shell.className).toBe('');
});

test('a second confirm does not apply the result twice', () => {
  const source = new ScriptedSource();
  let calls = 0;
  const root = document.createElement('div');
  const host = new MinigameHost({
    root,
    source,
    readParty: () => createParty(),
    apply: () => {
      calls += 1;
      return blankApplied();
    },
  });
  const def: MinigameDef = {
    id: 'host_probe_once',
    name: 'Once',
    type: 'world',
    start(g) {
      g.done({ ok: true, message: 'Once.', coins: 1 });
    },
    update() {
      return;
    },
  };
  host.arm(def);
  host.tick(0.016);
  host.tick(0.016);
  expect(calls).toBe(1);
  expect(host.kind).toBe('world');
});

class ScriptedSource implements MinigameActionSource {
  private jump = false;
  private roll = false;
  private use = false;
  private escape = false;

  queue(next: { jump?: boolean; roll?: boolean; use?: boolean; escape?: boolean }): void {
    this.jump = next.jump === true;
    this.roll = next.roll === true;
    this.use = next.use === true;
    this.escape = next.escape === true;
  }

  areaActions() {
    const jump = this.jump;
    const roll = this.roll;
    const use = this.use;
    this.jump = false;
    this.roll = false;
    this.use = false;
    return {
      p1: { x: 0, z: 0, jump, roll, use },
      p2: { jump: false, roll: false, use: false },
    };
  }

  consumePress(code: string): boolean {
    if (code === 'Escape' && this.escape) {
      this.escape = false;
      return true;
    }
    return false;
  }
}

function blankApplied(): ResolvedMinigame {
  return { party: createParty(), tu: 0, message: '', lines: [] };
}
