import { areaFromExport, type AreaEntry, type AreaExport } from './area-from-export';
import { createTownSession, type TownExitInfo, type TownSession } from './ct/town-session.js';

export interface AreaPose {
  x: number;
  z: number;
  yaw: number;
}

/** Action snapshot. The app fills this from the keyboard and gamepad map. */
export interface AreaActionPad {
  x: number;
  z: number;
  jump: boolean;
  sprint: boolean;
  sneak: boolean;
  roll: boolean;
  use: boolean;
  emote: boolean;
}

export interface AreaActionSnapshot {
  p1: AreaActionPad;
  p2: AreaActionPad;
  camLeft: boolean;
  camRight: boolean;
  camUp: boolean;
  camDown: boolean;
  view: boolean;
  mode: boolean;
}

export interface AreaHooks {
  getActions(): AreaActionSnapshot;
  onExit(info: TownExitInfo): void;
  /** Persisted 3D look. Absent in harnesses that only want the town defaults. */
  getLook?(): unknown;
  onLook?(patch: unknown): void;
  /** F on the party wagon. The shell opens the activity menu. */
  onWagon?(): void;
  /** F on a fish or chop sign. */
  onMinigame?(id: string): void;
}

export class AreaRenderer {
  private session: TownSession | null = null;
  private booting: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: AreaHooks,
  ) {}

  /** Build the controller town from an AreaExport. Safe to call once. */
  start(areaExport: unknown, entry?: AreaEntry): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.booting) {
      const exp = areaFromExport(areaExport);
      this.booting = this.boot(exp, entry);
    }
    return this.booting;
  }

  step(dt: number): void {
    this.session?.step(dt);
  }

  frame(): void {
    this.session?.frame();
  }

  prompt(): string {
    return this.session?.prompt() ?? '';
  }

  worldView(): ReturnType<TownSession['worldView']> | null {
    return this.session?.worldView() ?? null;
  }

  indoors(): boolean {
    return this.session?.indoors() ?? false;
  }

  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    return this.session?.bounds() ?? null;
  }

  stats(): { fps: number; calls: number; triangles: number; view: string; name: string } | null {
    return this.session?.stats() ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.session?.dispose();
    this.session = null;
  }

  private async boot(exp: AreaExport, entry?: AreaEntry): Promise<void> {
    const session = await createTownSession(this.canvas, {
      getActions: () => this.hooks.getActions(),
      onExit: (info) => this.hooks.onExit(info),
      getLook: () => this.hooks.getLook?.(),
      onLook: (patch: unknown) => this.hooks.onLook?.(patch),
      onWagon: () => this.hooks.onWagon?.(),
      onMinigame: (id: string) => this.hooks.onMinigame?.(id),
    });
    if (this.disposed) {
      session.dispose();
      return;
    }
    this.session = session;
    await session.start(exp, entry);
  }
}
