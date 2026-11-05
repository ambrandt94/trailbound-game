export interface Clock {
  /** Monotonic milliseconds. */
  now(): number;
}

export function systemClock(): Clock {
  return { now: () => performance.now() };
}

/**
 * Fixed-step accumulator. `advance` runs as many `step` updates as fit in the
 * frame (capped so a hitch cannot spiral) and returns the leftover fraction
 * for render interpolation.
 */
export class FixedStep {
  private acc = 0;

  constructor(
    private readonly step: number,
    private readonly maxSteps = 8,
  ) {}

  advance(frameSeconds: number, update: (dt: number) => void): number {
    const capped = Math.min(Math.max(frameSeconds, 0), this.step * this.maxSteps);
    this.acc += capped;
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      update(this.step);
      this.acc -= this.step;
      steps += 1;
    }
    if (this.acc < 1e-8) this.acc = 0;
    return this.step === 0 ? 1 : this.acc / this.step;
  }
}

/** Drives a fixed step from an injected clock instead of the rAF timestamp. */
export class FrameClock {
  private last: number | null = null;
  private readonly stepper: FixedStep;

  constructor(
    private readonly clock: Clock,
    hz = 120,
    maxSteps = 8,
  ) {
    this.stepper = new FixedStep(1 / hz, maxSteps);
  }

  frame(update: (dt: number) => void, render: (alpha: number) => void): void {
    const now = this.clock.now();
    if (this.last === null) {
      this.last = now;
      render(1);
      return;
    }
    const seconds = Math.max(0, now - this.last) / 1000;
    this.last = now;
    const alpha = this.stepper.advance(seconds, update);
    render(alpha);
  }
}
