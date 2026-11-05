/**
 * OWNED BY THE TOUCH-CONTROLS AGENT.
 * Alex's separate touch-controls agent (the one that owns the controller touch pad)
 * owns every behavior change in this folder. Other agents may only import
 * `attachTouchControls` and pass a sink from `src/app`.
 */

export type TouchAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel';

export interface TouchSink {
  setHeld(action: TouchAction, held: boolean): void;
}

/** Placeholder until the pad is copied in G4. Returns an unsubscribe. */
export function attachTouchControls(_root: HTMLElement, _sink: TouchSink): () => void {
  return () => undefined;
}
