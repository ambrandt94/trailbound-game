import type { ComboSpec, ComboStep, WeaponStyle } from './types';

export type { ComboStep } from './types';

export interface ResolvedCombo {
  moveId: string;
  ender: boolean;
  /** What the string still holds after this attack. Empty after an ender. */
  chain: readonly ComboStep[];
}

/**
 * Longest current string wins. A string that is only a prefix of a longer
 * combo plays the neutral of its newest step and keeps the prefix, so the
 * finisher can still land. A string that matches nothing drops from the
 * front until a neutral remains.
 */
export function createComboResolver(style: WeaponStyle): {
  push(step: ComboStep): ResolvedCombo;
  reset(): void;
} {
  let chain: ComboStep[] = [];

  const same = (a: ComboStep, b: ComboStep) => a.button === b.button && a.kind === b.kind;
  const exact = (steps: readonly ComboStep[]): ComboSpec | undefined =>
    style.combos.find(
      (combo) =>
        combo.sequence.length === steps.length &&
        combo.sequence.every((step, index) => {
          const got = steps[index];
          return got ? same(step, got) : false;
        }),
    );
  const prefix = (steps: readonly ComboStep[]): boolean =>
    style.combos.some(
      (combo) =>
        combo.sequence.length > steps.length &&
        steps.every((step, index) => {
          const next = combo.sequence[index];
          return next ? same(step, next) : false;
        }),
    );

  return {
    reset() {
      chain = [];
    },
    push(step: ComboStep): ResolvedCombo {
      chain.push({ button: step.button, kind: step.kind });
      while (chain.length > 1 && !exact(chain) && !prefix(chain)) chain.shift();
      const matched = exact(chain);
      if (matched) {
        if (matched.ender) {
          chain = [];
          return { moveId: matched.moveId, ender: true, chain: [] };
        }
        return { moveId: matched.moveId, ender: false, chain: chain.slice() };
      }
      const neutral = exact([step]);
      if (!neutral) throw new Error(`no neutral for ${step.button} ${step.kind}`);
      return { moveId: neutral.moveId, ender: false, chain: chain.slice() };
    },
  };
}
