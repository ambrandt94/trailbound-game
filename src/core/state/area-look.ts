import { clampCamera, type CameraPose } from './area-camera';
import { AREA_PACE } from './area-pace';

/**
 * Every control from the controller's Visuals panel, plus the sidebar
 * camera, feel, and debug toggles that change the 3D view.
 * Draw distance is not its own slider there: fog density and zoom set the far plane.
 */
export const ORIGINAL_VISUAL_KEYS = [
  'px',
  'pixelFilter',
  'posterize',
  'outline',
  'outlineThick',
  'outlineDark',
  'outlineBlack',
  'depthEdge',
  'normalEdge',
  'sunIntensity',
  'sunHour',
  'sunWarmth',
  'hemi',
  'shadeCool',
  'shadeSteps',
  'shadows',
  'shadowSoft',
  'litDither',
  'litPat',
  'litEdge',
  'litStrength',
  'shHue',
  'sat',
  'contrast',
  'bright',
  'gamma',
  'hue',
  'grass',
  'fog',
  'haze',
  'skyTop',
  'skyHor',
  'clouds',
  'texel',
  'dither',
  'oldTiles',
  'camFov',
  'camDist',
  'camPitch',
  'scatter',
  'flower',
  'wind',
  'fps',
  'heightDebug',
  'heightContour',
] as const;

export type FeelPreset =
  | 'Custom'
  | 'Default'
  | "Baldur's Gate"
  | 'Diablo'
  | 'Bravely Default'
  | 'Souls-like'
  | 'Platformer';

export const FEEL_PRESET_NAMES: readonly FeelPreset[] = [
  'Custom',
  'Default',
  "Baldur's Gate",
  'Diablo',
  'Bravely Default',
  'Souls-like',
  'Platformer',
];

export interface AreaLook extends CameraPose {
  px: number;
  pixelFilter: boolean;
  posterize: number;
  outline: boolean;
  outlineThick: number;
  outlineDark: number;
  outlineBlack: boolean;
  depthEdge: number;
  normalEdge: number;
  sunIntensity: number;
  sunHour: number;
  sunWarmth: number;
  hemi: number;
  shadeCool: number;
  shadeSteps: number;
  shadows: boolean;
  shadowSoft: number;
  litDither: boolean;
  litPat: number;
  litEdge: number;
  litStrength: number;
  shHue: number;
  sat: number;
  contrast: number;
  bright: number;
  gamma: number;
  hue: number;
  grass: string;
  fog: number;
  haze: string;
  skyTop: string;
  skyHor: string;
  clouds: number;
  texel: number;
  dither: number;
  oldTiles: boolean;
  scatter: number;
  flower: number;
  wind: number;
  fps: boolean;
  heightDebug: boolean;
  heightContour: boolean;
  hitbox: boolean;
  showHud: boolean;
  invertX: boolean;
  invertY: boolean;
  maxSpeed: number;
  sprintMult: number;
  sneakMult: number;
  /** On-screen metres per real second. These drive the motor; maxSpeed does not. */
  walkMps: number;
  runMps: number;
  sprintMps: number;
  sneakMps: number;
  horseMult: number;
  accel: number;
  decel: number;
  turn: number;
  airCtl: number;
  jumpH: number;
  grav: number;
  fall: number;
  coyote: number;
  buffer: number;
  dodgeSpeed: number;
  dodgeTime: number;
  dodgeCd: number;
  scale: number;
  slow: number;
  feelPreset: FeelPreset;
}

type LookGroup =
  | 'Pixelation'
  | 'Outlines'
  | 'Lighting'
  | 'Color grading'
  | 'Atmosphere'
  | 'Textures'
  | 'Camera'
  | 'World'
  | 'Debug'
  | 'Controller';

interface NumberField {
  key: keyof AreaLook;
  label: string;
  group: LookGroup;
  kind: 'number';
  min: number;
  max: number;
  step: number;
  fallback: number;
  integer?: boolean;
}

interface BoolField {
  key: keyof AreaLook;
  label: string;
  group: LookGroup;
  kind: 'bool';
  fallback: boolean;
}

interface ColorField {
  key: keyof AreaLook;
  label: string;
  group: LookGroup;
  kind: 'color';
  fallback: string;
}

interface ChoiceField {
  key: keyof AreaLook;
  label: string;
  group: LookGroup;
  kind: 'choice';
  fallback: number;
  choices: readonly (readonly [number, string])[];
}

export type LookField = NumberField | BoolField | ColorField | ChoiceField;

export const LOOK_FIELDS: readonly LookField[] = [
  {
    key: 'px',
    label: 'Pixel scale (render ÷)',
    group: 'Pixelation',
    kind: 'number',
    min: 1,
    max: 5,
    step: 1,
    fallback: 2,
    integer: true,
  },
  {
    key: 'pixelFilter',
    label: 'Crisp pixel filter',
    group: 'Pixelation',
    kind: 'bool',
    fallback: true,
  },
  {
    key: 'posterize',
    label: 'Posterize levels (0 off)',
    group: 'Pixelation',
    kind: 'number',
    min: 0,
    max: 16,
    step: 1,
    fallback: 0,
    integer: true,
  },
  { key: 'outline', label: 'Outlines', group: 'Outlines', kind: 'bool', fallback: true },
  {
    key: 'outlineThick',
    label: 'Thickness',
    group: 'Outlines',
    kind: 'number',
    min: 0.5,
    max: 6,
    step: 0.5,
    fallback: 1,
  },
  {
    key: 'outlineDark',
    label: 'Darkness',
    group: 'Outlines',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'outlineBlack',
    label: 'Black ink (off = object tint)',
    group: 'Outlines',
    kind: 'bool',
    fallback: false,
  },
  {
    key: 'depthEdge',
    label: 'Depth edge',
    group: 'Outlines',
    kind: 'number',
    min: 0.001,
    max: 0.2,
    step: 0.001,
    fallback: 0.02,
  },
  {
    key: 'normalEdge',
    label: 'Normal edge (2 off)',
    group: 'Outlines',
    kind: 'number',
    min: 0.05,
    max: 2,
    step: 0.05,
    fallback: 2,
  },
  {
    key: 'sunIntensity',
    label: 'Sun intensity',
    group: 'Lighting',
    kind: 'number',
    min: 0,
    max: 3,
    step: 0.05,
    fallback: 1.15,
  },
  {
    key: 'sunHour',
    label: 'Sun angle (time of day)',
    group: 'Lighting',
    kind: 'number',
    min: 0,
    max: 24,
    step: 0.1,
    fallback: 9.5,
  },
  {
    key: 'sunWarmth',
    label: 'Sun warmth',
    group: 'Lighting',
    kind: 'number',
    min: -1,
    max: 1,
    step: 0.05,
    fallback: 0,
  },
  {
    key: 'hemi',
    label: 'Hemisphere',
    group: 'Lighting',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.02,
    fallback: 0.58,
  },
  {
    key: 'shadeCool',
    label: 'Shadow coolness',
    group: 'Lighting',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'shadeSteps',
    label: 'Shade steps',
    group: 'Lighting',
    kind: 'number',
    min: 1,
    max: 8,
    step: 1,
    fallback: 4,
    integer: true,
  },
  { key: 'shadows', label: 'Shadows', group: 'Lighting', kind: 'bool', fallback: true },
  {
    key: 'shadowSoft',
    label: 'Shadow softness',
    group: 'Lighting',
    kind: 'number',
    min: 0,
    max: 4,
    step: 0.1,
    fallback: 1,
  },
  { key: 'litDither', label: 'Lighting dither', group: 'Lighting', kind: 'bool', fallback: true },
  {
    key: 'litPat',
    label: 'Pattern',
    group: 'Lighting',
    kind: 'choice',
    fallback: 0,
    choices: [
      [0, 'Bayer 4×4'],
      [1, 'Chunky 2×2'],
    ],
  },
  {
    key: 'litEdge',
    label: 'Edge width',
    group: 'Lighting',
    kind: 'number',
    min: 0.02,
    max: 0.15,
    step: 0.005,
    fallback: 0.06,
  },
  {
    key: 'litStrength',
    label: 'Dither strength',
    group: 'Lighting',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    fallback: 0.6,
  },
  {
    key: 'shHue',
    label: 'Shadow hue °',
    group: 'Lighting',
    kind: 'number',
    min: 15,
    max: 25,
    step: 1,
    fallback: 20,
    integer: true,
  },
  {
    key: 'sat',
    label: 'Saturation',
    group: 'Color grading',
    kind: 'number',
    min: 0,
    max: 2,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'contrast',
    label: 'Contrast',
    group: 'Color grading',
    kind: 'number',
    min: 0.5,
    max: 2,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'bright',
    label: 'Brightness',
    group: 'Color grading',
    kind: 'number',
    min: 0.4,
    max: 2,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'gamma',
    label: 'Gamma (1 = now)',
    group: 'Color grading',
    kind: 'number',
    min: 0.4,
    max: 2.2,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'hue',
    label: 'Hue shift °',
    group: 'Color grading',
    kind: 'number',
    min: -180,
    max: 180,
    step: 1,
    fallback: 0,
    integer: true,
  },
  { key: 'grass', label: 'Grass tint', group: 'Color grading', kind: 'color', fallback: '#ffffff' },
  {
    key: 'fog',
    label: 'Fog density',
    group: 'Atmosphere',
    kind: 'number',
    min: 0,
    max: 3,
    step: 0.05,
    fallback: 1,
  },
  { key: 'haze', label: 'Haze tint', group: 'Atmosphere', kind: 'color', fallback: '#c3e5f9' },
  { key: 'skyTop', label: 'Sky top', group: 'Atmosphere', kind: 'color', fallback: '#61a0f9' },
  { key: 'skyHor', label: 'Sky horizon', group: 'Atmosphere', kind: 'color', fallback: '#b1dcfd' },
  {
    key: 'clouds',
    label: 'Cloud density',
    group: 'Atmosphere',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'texel',
    label: 'Texel density',
    group: 'Textures',
    kind: 'number',
    min: 0.5,
    max: 3,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'dither',
    label: 'Dither (0 off)',
    group: 'Textures',
    kind: 'number',
    min: 0,
    max: 0.35,
    step: 0.01,
    fallback: 0,
  },
  {
    key: 'oldTiles',
    label: 'Old nature textures',
    group: 'Textures',
    kind: 'bool',
    fallback: false,
  },
  {
    key: 'camFov',
    label: 'FOV',
    group: 'Camera',
    kind: 'number',
    min: 15,
    max: 75,
    step: 1,
    fallback: 24,
    integer: true,
  },
  {
    key: 'camDist',
    label: 'Distance',
    group: 'Camera',
    kind: 'number',
    min: 2,
    max: 80,
    step: 0.5,
    fallback: 60,
  },
  {
    key: 'camPitch',
    label: 'Pitch °',
    group: 'Camera',
    kind: 'number',
    min: -5,
    max: 85,
    step: 1,
    fallback: 50,
  },
  {
    key: 'camYaw',
    label: 'Yaw °',
    group: 'Camera',
    kind: 'number',
    min: 0,
    max: 360,
    step: 1,
    fallback: 45,
  },
  {
    key: 'camLag',
    label: 'Follow lag (s)',
    group: 'Camera',
    kind: 'number',
    min: 0,
    max: 0.6,
    step: 0.02,
    fallback: 0.25,
  },
  {
    key: 'scatter',
    label: 'Foliage & scatter',
    group: 'World',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'flower',
    label: 'Flower rate',
    group: 'World',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.02,
    fallback: 0.2,
  },
  {
    key: 'wind',
    label: 'Wind sway',
    group: 'World',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    fallback: 0,
  },
  { key: 'fps', label: 'FPS counter', group: 'Debug', kind: 'bool', fallback: false },
  { key: 'heightDebug', label: 'Height tint', group: 'Debug', kind: 'bool', fallback: false },
  { key: 'heightContour', label: 'Contour lines', group: 'Debug', kind: 'bool', fallback: false },
  { key: 'hitbox', label: 'Hitbox', group: 'Debug', kind: 'bool', fallback: false },
  { key: 'showHud', label: 'Speed HUD', group: 'Debug', kind: 'bool', fallback: false },
  { key: 'invertX', label: 'Invert look X', group: 'Debug', kind: 'bool', fallback: false },
  { key: 'invertY', label: 'Invert look Y', group: 'Debug', kind: 'bool', fallback: false },
  {
    key: 'walkMps',
    label: 'Walk (no modifier) m/s',
    group: 'Controller',
    kind: 'number',
    min: 0.6,
    max: 3,
    step: 0.05,
    fallback: AREA_PACE.walk,
  },
  {
    key: 'runMps',
    label: 'Jog (Shift) m/s',
    group: 'Controller',
    kind: 'number',
    min: 1.5,
    max: 6,
    step: 0.05,
    fallback: AREA_PACE.run,
  },
  {
    key: 'sprintMps',
    label: 'Sprint (hold Shift) m/s',
    group: 'Controller',
    kind: 'number',
    min: 3,
    max: 8,
    step: 0.05,
    fallback: AREA_PACE.sprint,
  },
  {
    key: 'sneakMps',
    label: 'Sneak (Ctrl) m/s',
    group: 'Controller',
    kind: 'number',
    min: 0.3,
    max: 2,
    step: 0.05,
    fallback: AREA_PACE.sneak,
  },
  {
    key: 'horseMult',
    label: 'Horse speed ×',
    group: 'Controller',
    kind: 'number',
    min: 1.2,
    max: 3,
    step: 0.05,
    fallback: 1.9,
  },
  {
    key: 'accel',
    label: 'Acceleration',
    group: 'Controller',
    kind: 'number',
    min: 5,
    max: 120,
    step: 1,
    fallback: 45,
    integer: true,
  },
  {
    key: 'decel',
    label: 'Braking',
    group: 'Controller',
    kind: 'number',
    min: 5,
    max: 120,
    step: 1,
    fallback: 55,
    integer: true,
  },
  {
    key: 'turn',
    label: 'Turn speed (rad/s)',
    group: 'Controller',
    kind: 'number',
    min: 2,
    max: 40,
    step: 1,
    fallback: 14,
    integer: true,
  },
  {
    key: 'airCtl',
    label: 'Air control',
    group: 'Controller',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    fallback: 0.6,
  },
  {
    key: 'jumpH',
    label: 'Jump height',
    group: 'Controller',
    kind: 'number',
    min: 0.5,
    max: 3.5,
    step: 0.1,
    fallback: 1.6,
  },
  {
    key: 'grav',
    label: 'Gravity',
    group: 'Controller',
    kind: 'number',
    min: 10,
    max: 60,
    step: 1,
    fallback: 30,
    integer: true,
  },
  {
    key: 'fall',
    label: 'Fall gravity ×',
    group: 'Controller',
    kind: 'number',
    min: 1,
    max: 3,
    step: 0.05,
    fallback: 1.4,
  },
  {
    key: 'coyote',
    label: 'Coyote time (s)',
    group: 'Controller',
    kind: 'number',
    min: 0,
    max: 0.25,
    step: 0.01,
    fallback: 0.1,
  },
  {
    key: 'buffer',
    label: 'Jump buffer (s)',
    group: 'Controller',
    kind: 'number',
    min: 0,
    max: 0.3,
    step: 0.01,
    fallback: 0.12,
  },
  {
    key: 'dodgeSpeed',
    label: 'Roll speed',
    group: 'Controller',
    kind: 'number',
    min: 5,
    max: 20,
    step: 0.5,
    fallback: 11,
  },
  {
    key: 'dodgeTime',
    label: 'Roll duration (s)',
    group: 'Controller',
    kind: 'number',
    min: 0.15,
    max: 0.8,
    step: 0.01,
    fallback: 0.42,
  },
  {
    key: 'dodgeCd',
    label: 'Roll cooldown (s)',
    group: 'Controller',
    kind: 'number',
    min: 0,
    max: 1.5,
    step: 0.05,
    fallback: 0.5,
  },
  {
    key: 'scale',
    label: 'Character scale',
    group: 'Controller',
    kind: 'number',
    min: 0.7,
    max: 1.6,
    step: 0.05,
    fallback: 1,
  },
  {
    key: 'slow',
    label: 'Time scale',
    group: 'Controller',
    kind: 'number',
    min: 0.1,
    max: 1,
    step: 0.05,
    fallback: 1,
  },
];

export const LOOK_GROUPS: readonly LookGroup[] = [
  'Pixelation',
  'Outlines',
  'Lighting',
  'Color grading',
  'Atmosphere',
  'Textures',
  'Camera',
  'World',
  'Controller',
  'Debug',
];

const FEEL_RESET: (keyof AreaLook)[] = [
  'walkMps',
  'runMps',
  'sprintMps',
  'sneakMps',
  'horseMult',
  'accel',
  'decel',
  'turn',
  'airCtl',
  'jumpH',
  'grav',
  'fall',
  'coyote',
  'buffer',
  'dodgeSpeed',
  'dodgeTime',
  'dodgeCd',
  'camYaw',
  'camPitch',
  'camDist',
  'camFov',
  'camLag',
];

const PRESETS: Record<Exclude<FeelPreset, 'Custom'>, Partial<AreaLook>> = {
  Default: {},
  "Baldur's Gate": {
    walkMps: 1.4,
    runMps: 3,
    sprintMps: 4.6,
    accel: 22,
    decel: 30,
    turn: 9,
    jumpH: 1,
    grav: 26,
    dodgeSpeed: 8,
    dodgeTime: 0.5,
    dodgeCd: 0.7,
    sprintMult: 1.5,
    sneakMult: 0.5,
    camPitch: 55,
    camDist: 18,
    camFov: 26,
    camLag: 0.2,
  },
  Diablo: {
    walkMps: 1.8,
    runMps: 4,
    sprintMps: 6,
    accel: 80,
    decel: 90,
    turn: 30,
    jumpH: 0.8,
    dodgeSpeed: 13,
    dodgeTime: 0.35,
    dodgeCd: 0.35,
    sprintMult: 1.4,
    camPitch: 58,
    camDist: 18,
    camFov: 24,
    camLag: 0.08,
  },
  'Bravely Default': {
    walkMps: 1.5,
    runMps: 3.2,
    sprintMps: 5,
    accel: 35,
    decel: 40,
    turn: 16,
    jumpH: 1.8,
    grav: 24,
    fall: 1.3,
    camPitch: 48,
    camDist: 14,
    camFov: 34,
    camLag: 0.15,
  },
  'Souls-like': {
    walkMps: 1.3,
    runMps: 2.8,
    sprintMps: 4.4,
    accel: 18,
    decel: 26,
    turn: 7,
    jumpH: 1,
    grav: 32,
    fall: 1.6,
    dodgeSpeed: 9,
    dodgeTime: 0.6,
    dodgeCd: 0.9,
    sprintMult: 1.7,
    sneakMult: 0.5,
    camPitch: 40,
    camDist: 11,
    camFov: 40,
    camLag: 0.25,
  },
  Platformer: {
    walkMps: 2,
    runMps: 4.2,
    sprintMps: 6.5,
    accel: 90,
    decel: 70,
    turn: 25,
    airCtl: 1,
    jumpH: 2.8,
    grav: 22,
    fall: 1.8,
    coyote: 0.15,
    buffer: 0.18,
    camPitch: 45,
    camDist: 15,
    camFov: 32,
    camLag: 0.1,
  },
};

function fieldMap(): Map<keyof AreaLook, LookField> {
  return new Map(LOOK_FIELDS.map((field) => [field.key, field]));
}

const FIELDS = fieldMap();

function blankLook(): AreaLook {
  const look = { feelPreset: 'Default' as FeelPreset } as AreaLook;
  for (const field of LOOK_FIELDS) {
    if (field.kind === 'number' || field.kind === 'choice') {
      Reflect.set(look, field.key, field.fallback);
    } else if (field.kind === 'bool') {
      Reflect.set(look, field.key, field.fallback);
    } else {
      Reflect.set(look, field.key, field.fallback);
    }
  }
  /* Kept so older saves and feel presets still parse. The motor uses the m/s fields. */
  look.maxSpeed = 5.5;
  look.sprintMult = 1.6;
  look.sneakMult = 0.45;
  return look;
}

export const DEFAULT_AREA_LOOK: AreaLook = blankLook();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNum(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  integer: boolean,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const next = Math.min(max, Math.max(min, value));
  return integer ? Math.round(next) : next;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return fallback;
}

function asHex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const hex = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : fallback;
}

export function hourLabel(hour: number): string {
  const name =
    hour < 5
      ? 'night'
      : hour < 8
        ? 'dawn'
        : hour < 11
          ? 'morning'
          : hour < 14
            ? 'midday'
            : hour < 17
              ? 'afternoon'
              : hour < 20
                ? 'evening'
                : 'night';
  const text =
    Math.abs(hour - Math.round(hour)) < 1e-6
      ? String(Math.round(hour))
      : String(Math.round(hour * 10) / 10);
  return `${text} ${name}`;
}

export function normalizeAreaLook(value: unknown): AreaLook {
  const record = isRecord(value) ? value : {};
  const next = blankLook();
  for (const field of LOOK_FIELDS) {
    const raw = record[field.key as string];
    if (field.kind === 'number') {
      Reflect.set(
        next,
        field.key,
        clampNum(raw, field.min, field.max, field.fallback, !!field.integer),
      );
    } else if (field.kind === 'bool') {
      Reflect.set(next, field.key, asBool(raw, field.fallback));
    } else if (field.kind === 'color') {
      Reflect.set(next, field.key, asHex(raw, field.fallback));
    } else {
      const choice = clampNum(raw, 0, 1, field.fallback, true);
      const allowed = field.choices.some((pair) => pair[0] === choice);
      Reflect.set(next, field.key, allowed ? choice : field.fallback);
    }
  }
  const pose = clampCamera({
    camDist: next.camDist,
    camPitch: next.camPitch,
    camFov: next.camFov,
    camYaw: next.camYaw,
    camLag: next.camLag,
  });
  next.camDist = pose.camDist;
  next.camPitch = pose.camPitch;
  next.camFov = pose.camFov;
  next.camYaw = pose.camYaw;
  next.camLag = pose.camLag;
  const preset = record.feelPreset;
  next.feelPreset = FEEL_PRESET_NAMES.find((name) => name === preset) ?? 'Default';
  return next;
}

export function applyFeelPreset(look: AreaLook, name: Exclude<FeelPreset, 'Custom'>): AreaLook {
  const next: AreaLook = { ...look };
  for (const key of FEEL_RESET) {
    const field = FIELDS.get(key);
    if (field && (field.kind === 'number' || field.kind === 'choice')) {
      Reflect.set(next, key, field.fallback);
    }
  }
  Object.assign(next, PRESETS[name]);
  next.feelPreset = name;
  return normalizeAreaLook(next);
}

export function areaLooksEqual(a: AreaLook, b: AreaLook): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Numbers the ported visuals module still expects (checkboxes are 0 or 1). */
export function visualNumbers(look: AreaLook): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const key of ORIGINAL_VISUAL_KEYS) {
    const value = look[key];
    if (typeof value === 'boolean') out[key] = value ? 1 : 0;
    else out[key] = value;
  }
  return out;
}

export function fieldsInGroup(group: LookGroup): LookField[] {
  return LOOK_FIELDS.filter((field) => field.group === group);
}

export function isFeelKey(key: keyof AreaLook): boolean {
  return FEEL_RESET.includes(key) || key === 'scale' || key === 'slow';
}
