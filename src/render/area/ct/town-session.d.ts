import type { AreaEntry, AreaExport } from '../area-from-export';

export interface TownExitInfo {
  side?: string;
  pos?: number | { x: number; z: number };
  yaw?: number;
}

export interface ConvoyFrame {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  /** The wagon has rolled off this zone: hide it and stop following it. */
  gone?: boolean;
  /** Gone because the wagon has not reached this zone yet (the hero came on foot). */
  away?: boolean;
  /** This zone's edge in area metres. The hero's auto-walk stops short of it. */
  edge?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface ConvoyStatus {
  mode: 'walk' | 'bench' | 'free';
  leash: 'ok' | 'hint' | 'pull';
  dist: number;
  x: number;
  z: number;
  yaw: number;
  /** The wagon has rolled off this zone. The hero is on foot and free. */
  gone?: boolean;
  /** The wagon has not been in this zone yet: it is elsewhere on its route. */
  away?: boolean;
}

export interface TownSession {
  start(areaExport: AreaExport, entry?: AreaEntry): Promise<void>;
  step(dt: number): void;
  frame(): void;
  prompt(): string;
  worldView(): {
    scene: import('three').Scene;
    pose: { x: number; y: number; z: number; yaw: number };
    draw(scene: import('three').Scene, camera: import('three').Camera): void;
  };
  indoors(): boolean;
  convoyStatus(): ConvoyStatus | null;
  convoyCommand(command: 'bench' | 'rejoin'): void;
  cameraSweep(kind: 'in' | 'out', seconds: number): void;
  /** Current follow-camera distance, metres. */
  cameraDistance(): number;
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  stats(): { fps: number; calls: number; triangles: number; view: string; name: string };
  dispose(): void;
}

export function createTownSession(
  canvas: HTMLCanvasElement,
  hooks: {
    getActions: () => {
      p1: {
        x: number;
        z: number;
        jump: boolean;
        sprint: boolean;
        sneak: boolean;
        roll: boolean;
        use: boolean;
        emote: boolean;
      };
      p2: {
        x: number;
        z: number;
        jump: boolean;
        sprint: boolean;
        sneak: boolean;
        roll: boolean;
        use: boolean;
        emote: boolean;
      };
      camLeft: boolean;
      camRight: boolean;
      camUp: boolean;
      camDown: boolean;
      view: boolean;
      mode: boolean;
    };
    onExit: (info: TownExitInfo) => void;
    getLook?: () => unknown;
    onLook?: (patch: unknown) => void;
    onWagon?: () => void;
    onMinigame?: (id: string) => void;
    getConvoy?: () => ConvoyFrame | null;
  },
): Promise<TownSession>;
