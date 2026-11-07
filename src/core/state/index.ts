export { DEFAULT_SETTINGS, normalizeSettings, type GameSettings } from './settings';
export {
  AREA_VIEWS,
  CAM_DIST,
  CAM_FOV,
  CAM_PITCH,
  ZOOM_PER_MODE,
  clampCamera,
  cycleZoom,
  isThirdPerson,
  matchView,
  toggleCameraMode,
  viewName,
  zoomDistance,
  type AreaViewPreset,
  type CameraPose,
} from './area-camera';
export {
  DEFAULT_AREA_LOOK,
  FEEL_PRESET_NAMES,
  LOOK_FIELDS,
  LOOK_GROUPS,
  ORIGINAL_VISUAL_KEYS,
  applyFeelPreset,
  areaLooksEqual,
  fieldsInGroup,
  hourLabel,
  isFeelKey,
  normalizeAreaLook,
  visualNumbers,
  type AreaLook,
  type FeelPreset,
  type LookField,
} from './area-look';
export {
  AREA_PACE,
  FORGE_WALK_STRIDE_M,
  HERO_HEIGHT_M,
  clipTimeScale,
  gaitSpeed,
  playbackCap,
  type GaitName,
} from './area-pace';
export {
  createWorld,
  HERO_OUTSIDE_TOWN,
  WorldState,
  type AreaExit,
  type AreaSide,
  type HeroPose,
  type TownRef,
  type WorldEvent,
} from './world-state';
export type { PlayerAvatar } from '../people/avatar';
