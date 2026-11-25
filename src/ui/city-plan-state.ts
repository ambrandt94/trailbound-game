/**
 * World Gen debug view of synthetic city plans. Off unless the panel is opened.
 * Nothing here is saved, and it does not change the map.
 */
import { signal } from '@preact/signals';
import type { SettlementClass } from '../core/world/city-plan';

export const cityPlansOn = signal(false);
export const cityPlanClass = signal<SettlementClass>('town');
export const cityPlanSeed = signal(7);
