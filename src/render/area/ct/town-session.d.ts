import type { AreaEntry, AreaExport } from '../area-from-export';

export interface TownExitInfo {
  side?: string;
  pos?: number | { x: number; z: number };
  yaw?: number;
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
  },
): Promise<TownSession>;
