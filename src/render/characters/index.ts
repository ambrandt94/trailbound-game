/**
 * Character Forge is reached through `forge.ts`. v2 (`backends/v2.ts`) is the
 * default. v1 (`backends/v1.ts`) stays available with `?cf=1` and is the
 * fallback when v2 fails to init or preload. The town uses the block rig in
 * `pawns.ts` when no forge body has been adopted.
 */
export {
  adoptPlayerBody,
  aimForgeSun,
  buildAvatar,
  characterEngine,
  forgeBuildError,
  forgeCatalog,
  forgeEditCatalog,
  forgeReady,
  forgeStats,
  checkRecipeEdit,
  cloneRecipe,
  describeRecipe,
  editRecipe,
  forgeTimings,
  forgePresentation,
  generateRecipe,
  getPlayerBody,
  initForge,
  preloadForge,
  optionsFor,
  packsForRecipe,
  placeholderAvatar,
  recipeForAvatar,
  recipeFromStored,
  recipeHashOf,
  tickPlayerBody,
  validateGameProfile,
  type AvatarBody,
  type CharacterRecipe,
  type EditIssue,
  type EditOptions,
  type EditPatch,
  type EditReport,
  type EditSnapshot,
  type ForgeCatalog,
  type ForgeRaceMetrics,
  type ForgeStatus,
  type ForgeTimings,
  type GarmentOption,
  type HairStyleOption,
  type ProfileReport,
  type SliderSpec,
  type Swatch,
  type WornPiece,
} from './forge';
export { AvatarPreview } from './preview';
export { createBlockRig, type BlockRig, type BlockRigMaterials } from './pawns';
