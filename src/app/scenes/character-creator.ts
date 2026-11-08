import {
  playableIds,
  type AvatarGender,
  type PlayerAvatar,
  type PlayerProfileEntry,
} from '../../core/people/avatar';
import {
  adoptPlayerBody,
  buildAvatar,
  checkRecipeEdit,
  cloneRecipe,
  describeRecipe,
  editRecipe,
  forgeBuildError,
  forgeCatalog,
  forgeReady,
  generateRecipe,
  initForge,
  optionsFor,
  placeholderAvatar,
  recipeFromStored,
  recipeHashOf,
  type CharacterRecipe,
  type EditOptions,
  type EditPatch,
  type EditSnapshot,
} from '../../render/characters/index';
import { AvatarPreview } from '../../render/characters/preview';
import {
  bindCreator,
  creatorBusy,
  creatorCommands,
  creatorSerial,
  creatorSource,
  creatorView,
  type CreatorCommands,
  type CreatorView,
  type PartView,
  type SliderView,
} from '../../ui/creator-state';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';
import { chooseStatePatch, diffOutfit, removedPieces, type WardrobeOutfit } from '../wardrobe-edit';

const DEBOUNCE_SECONDS = 0.16;
const HISTORY_LIMIT = 12;
const LENGTH_ORDER = ['hairLength', 'bangLength', 'beardLength', 'hairGrey', 'beardGrey'] as const;

export interface CreatorOptions {
  intent: 'new' | 'edit';
  initial: PlayerAvatar;
  onConfirm(avatar: PlayerAvatar): Promise<void> | void;
  onCancel(): Promise<void> | void;
  /** Edit avatar opens the paperdoll. A new traveller starts on the body page. */
  paperdoll?: boolean;
}

interface LookSnap {
  recipe: CharacterRecipe;
  seed: number;
  race: string;
  gender: AvatarGender;
}

export class CharacterCreatorScene implements Scene {
  readonly id = 'CharacterCreator';

  private name: string;
  private seed: number;
  private race: string;
  private gender: AvatarGender;
  private recipe: CharacterRecipe | null = null;
  private options: EditOptions | null = null;
  private snap: EditSnapshot | null = null;
  private past: LookSnap[] = [];
  private future: LookSnap[] = [];
  private slot = 'head_outer';
  private paperdoll: boolean;
  private focus: 'full' | 'upper' | 'lower' = 'full';
  private notice = '';
  private noticeKept = '';
  private facePreset = 'race';
  private warnings: string[] = [];
  private errors: string[] = [];
  private note = '';
  private hash = '';
  private flyerRaces: string[] = ['pixie'];
  private races: string[] = ['human'];
  private preview: AvatarPreview | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private working: Awaited<ReturnType<typeof buildAvatar>> | null = null;
  private handedOff = false;
  private clip: 'Idle' | 'Walk' = 'Idle';
  private turntable = false;
  private dirty = false;
  private wait = 0;
  private generation = 0;
  private building = false;
  private chain: Promise<void> = Promise.resolve();
  private gesture: CharacterRecipe | null = null;
  private nameBase: string | null = null;
  private closed = false;
  private profile: unknown = null;

  constructor(
    private readonly host: GameHost,
    private readonly optionsIn: CreatorOptions,
  ) {
    this.name = optionsIn.initial.name;
    this.seed = optionsIn.initial.seed >>> 0;
    this.race = optionsIn.initial.race || 'human';
    this.gender = optionsIn.initial.gender === 'f' ? 'f' : 'm';
    this.paperdoll = optionsIn.paperdoll === true;
  }

  async enter(): Promise<void> {
    this.host.setMode('creator');
    this.host.setCreatorVisible(true);
    this.mountCanvas();
    bindCreator(this.commands());
    creatorBusy.value = true;
    this.publish();
    try {
      this.profile = await this.host.content.load('characters/trailbound');
    } catch {
      this.profile = null;
    }
    const ready = await initForge({ profile: this.profile });
    const catalog = forgeCatalog();
    if (catalog) {
      this.flyerRaces = catalog.flyerRaces;
      this.races = playableIds([...catalog.races, ...racesInProfile(this.profile)], 0.5);
    }
    if (!ready.ok) {
      this.note =
        ready.reason === 'cf=0'
          ? 'Forge is off (?cf=0). Showing a stand-in.'
          : `Forge did not start (${ready.reason}). Showing a stand-in.`;
    } else {
      this.restoreOrGenerate(this.optionsIn.initial.recipe);
    }
    this.dirty = true;
    this.wait = DEBOUNCE_SECONDS;
    creatorBusy.value = false;
    this.publish();
  }

  update(dt: number): void {
    this.orbitFromKeys(dt);
    this.working?.update(dt);
    this.preview?.update(dt);
    if (!this.dirty || this.building) return;
    this.wait += dt;
    if (this.wait < DEBOUNCE_SECONDS) return;
    this.wait = 0;
    this.dirty = false;
    void this.enqueue(this.generation);
  }

  render(_alpha: number): void {
    this.preview?.render();
  }

  exit(): void {
    this.closed = true;
    bindCreator(silentCommands());
    this.preview?.releaseBody();
    this.preview?.dispose();
    this.preview = null;
    if (!this.handedOff) this.working?.dispose();
    this.working = null;
    this.canvas?.remove();
    this.canvas = null;
    this.host.setCreatorVisible(false);
    creatorBusy.value = false;
  }

  private commands(): CreatorCommands {
    return {
      setName: (name) => {
        if (this.nameBase === null) this.nameBase = this.name;
        this.name = name;
        this.publish();
      },
      commitName: () => {
        this.nameBase = null;
      },
      setRace: (race) => this.changeOrigin({ race }),
      setGender: (gender) => this.changeOrigin({ gender }),
      randomize: () => {
        this.remember();
        this.seed = Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
        this.facePreset = 'race';
        this.generateLook();
      },
      undo: () => this.step(-1),
      redo: () => this.step(1),
      setSkin: (id) => this.apply({ skin: id }, true),
      setHairColor: (id) => this.apply({ hairColor: id }, true),
      setEye: (id) => this.apply({ eyeColor: id }, true),
      setSclera: (id) => this.apply({ sclera: id }, true),
      setHairStyle: (id) => this.apply({ hairStyle: id }, true),
      setFacialHair: (id) => this.apply({ facialHair: id || null }, true),
      setStubble: (value) => this.applyOntoGesture({ stubble: value }),
      beginGesture: () => {
        if (this.recipe && !this.gesture) this.gesture = cloneRecipe(this.recipe);
      },
      setLength: (id, value) => this.applyOntoGesture({ [id]: value }),
      setSlider: (id, value) => this.applyOntoGesture({ sliders: { [id]: value } }),
      setFaceParam: (id, value) => this.applyOntoGesture({ face: { params: { [id]: value } } }),
      endGesture: () => this.endGesture(),
      setFacePreset: (id) => {
        this.facePreset = id;
        this.apply({ face: { preset: id } }, true);
      },
      setFacePart: (key, value) => this.apply({ face: { [key]: value } }, true),
      setSlot: (slot) => {
        this.slot = slot;
        this.publish();
      },
      setGarment: (id) => {
        this.noticeKept = id;
        this.apply({ outfit: { [this.slot]: id || null } }, true);
      },
      setDye: (region, rgb) => {
        const worn = this.snap?.outfit[this.slot];
        if (!worn) return;
        this.apply({ dye: { [worn.id]: { [region]: rgb } } }, true);
      },
      openPaperdoll: () => {
        this.paperdoll = true;
        this.focus = 'full';
        this.preview?.frameFocus('full');
        this.publish();
      },
      closePaperdoll: () => {
        this.paperdoll = false;
        this.preview?.frameBody();
        this.publish();
      },
      setFocus: (focus) => {
        this.focus = focus;
        this.preview?.frameFocus(focus);
        this.publish();
      },
      setGarmentState: (name, value) => this.changeState(name, value),
      setClip: (clip) => {
        this.clip = clip;
        this.working?.play(clip);
        this.publish();
      },
      setTurntable: (on) => {
        this.turntable = on;
        this.preview?.setTurntable(on);
        this.publish();
      },
      frame: (mode) => {
        if (mode === 'face') this.preview?.frameFace();
        else this.preview?.frameBody();
      },
      confirm: () => {
        void this.confirm();
      },
      cancel: () => {
        void this.optionsIn.onCancel();
      },
    };
  }

  private restoreOrGenerate(stored: PlayerAvatar['recipe']): void {
    if (stored && forgeReady().ok) {
      try {
        this.recipe = recipeFromStored(stored, this.seed);
        this.snap = describeRecipe(this.recipe);
        this.race = this.snap.race || this.race;
        this.gender = this.snap.gender;
        this.options = optionsFor(this.race, this.gender, 'adult');
        this.hash = recipeHashOf(this.recipe);
        if (!this.options.slots[this.slot]) this.slot = Object.keys(this.options.slots)[0] ?? '';
        return;
      } catch {
        this.note = 'The saved look could not be read. Rolling it again from the seed.';
      }
    }
    this.generateLook();
  }

  private changeOrigin(partial: { race?: string; gender?: AvatarGender }): void {
    this.remember();
    if (partial.race) this.race = partial.race;
    if (partial.gender) this.gender = partial.gender;
    this.facePreset = 'race';
    this.generateLook();
  }

  private generateLook(): void {
    if (!forgeReady().ok) return;
    try {
      this.recipe = generateRecipe({
        seed: this.seed,
        profileEntry: entryFor(this.race, this.gender),
        race: this.race,
        gender: this.gender,
        generatorVersion: 1,
      });
      this.options = optionsFor(this.race, this.gender, 'adult');
      this.snap = describeRecipe(this.recipe);
      this.errors = [];
      this.warnings = [];
      this.notice = '';
      this.hash = recipeHashOf(this.recipe);
      if (!this.options.slots[this.slot])
        this.slot = Object.keys(this.options.slots)[0] ?? this.slot;
      this.schedule();
    } catch (error) {
      this.errors = [error instanceof Error ? error.message : 'Could not roll this look'];
      this.publish();
    }
  }

  private changeState(name: string, value: string): void {
    const worn = this.snap?.outfit[this.slot];
    if (!this.recipe || !this.snap || !this.options || !worn) return;
    const spec = this.options.slots[this.slot]?.find((item) => item.id === worn.id);
    const states = { ...(worn.states ?? {}) };
    for (const [key, row] of Object.entries(spec?.states ?? {})) {
      if (!(key in states)) states[key] = row.default;
    }
    states[name] = value;
    const offered: Record<string, string[]> = {};
    for (const [slot, list] of Object.entries(this.options.slots)) {
      offered[slot] = list.map((item) => item.id);
    }
    const occupied = Object.keys(this.snap.outfit).filter(
      (slot) => this.snap?.outfit[slot]?.id === worn.id,
    );
    const choice = chooseStatePatch({
      garmentId: worn.id,
      states,
      slotOrder: Object.keys(this.options.slots),
      offered,
      occupied,
      accept: (slot, next) =>
        checkRecipeEdit(this.recipe!, { outfit: { [slot]: { id: worn.id, states: next } } }).ok,
    });
    if (!choice) {
      this.errors = ['Forge refused that state on every slot that offers this garment.'];
      this.publish();
      return;
    }
    this.slot = choice.slot;
    this.noticeKept = worn.id;
    this.apply({ outfit: { [choice.slot]: { id: worn.id, states: choice.states } } }, true);
  }

  private apply(patch: EditPatch, record: boolean): void {
    if (!this.recipe) return;
    this.applyTo(this.recipe, patch, record);
  }

  private applyOntoGesture(patch: EditPatch): void {
    const base = this.gesture ?? this.recipe;
    if (!base) return;
    this.applyTo(base, patch, false);
  }

  private applyTo(base: CharacterRecipe, patch: EditPatch, record: boolean): void {
    const check = checkRecipeEdit(base, patch);
    if (!check.ok || !check.recipe) {
      this.errors = check.errors.map((issue) => issue.msg);
      this.warnings = check.warnings.map((issue) => issue.msg);
      this.publish();
      return;
    }
    let next = check.recipe;
    try {
      next = editRecipe(base, patch);
    } catch (error) {
      this.errors = [error instanceof Error ? error.message : 'Edit was rejected'];
      this.publish();
      return;
    }
    if (record && this.recipe) this.remember();
    this.recipe = next;
    const previous = this.snap?.outfit;
    this.snap = describeRecipe(next);
    if (previous && isOutfitPatch(patch)) {
      this.notice = displacementNote(
        diffOutfit(wardrobeOutfit(previous), wardrobeOutfit(this.snap.outfit)),
        this.noticeKept,
      );
    }
    this.noticeKept = '';
    this.errors = [];
    this.warnings = check.warnings.map((issue) => issue.msg);
    this.hash = recipeHashOf(next);
    this.schedule();
  }

  private endGesture(): void {
    if (!this.gesture || !this.recipe) {
      this.gesture = null;
      return;
    }
    const before = this.gesture;
    this.gesture = null;
    if (recipeHashOf(before) !== recipeHashOf(this.recipe)) this.remember(before);
    this.publish();
  }

  private remember(before?: CharacterRecipe): void {
    const recipe = before ?? this.recipe;
    if (!recipe) return;
    this.past = [
      ...this.past,
      { recipe: cloneRecipe(recipe), seed: this.seed, race: this.race, gender: this.gender },
    ];
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
  }

  private step(direction: -1 | 1): void {
    const from = direction < 0 ? this.past : this.future;
    const to = direction < 0 ? this.future : this.past;
    const snap = from.pop();
    if (!snap || !this.recipe) return;
    to.push({
      recipe: cloneRecipe(this.recipe),
      seed: this.seed,
      race: this.race,
      gender: this.gender,
    });
    this.seed = snap.seed;
    this.race = snap.race;
    this.gender = snap.gender;
    this.recipe = snap.recipe;
    try {
      this.options = optionsFor(this.race, this.gender, 'adult');
      this.snap = describeRecipe(this.recipe);
      this.hash = recipeHashOf(this.recipe);
    } catch (error) {
      this.errors = [error instanceof Error ? error.message : 'Could not restore that look'];
    }
    this.schedule();
  }

  private async confirm(): Promise<void> {
    if (this.closed || !this.recipe) return;
    this.generation += 1;
    this.dirty = false;
    await this.enqueue(this.generation);
    if (this.closed || !this.recipe) return;
    const engine = JSON.parse(JSON.stringify(this.recipe.engine)) as Record<string, unknown>;
    const avatar: PlayerAvatar = {
      name: this.name.trim() || 'Traveller',
      seed: this.seed >>> 0,
      profileEntry: entryFor(this.race, this.gender),
      generatorVersion: this.recipe.generatorVersion,
      recipeHash: recipeHashOf(this.recipe),
      race: this.race,
      gender: this.gender,
      recipe: engine,
    };
    if (this.working) {
      adoptPlayerBody(this.working);
      this.handedOff = true;
    }
    await this.optionsIn.onConfirm(avatar);
  }

  private enqueue(generation: number): Promise<void> {
    const run = this.chain.then(() => this.rebuild(generation));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async rebuild(generation: number): Promise<void> {
    if (generation !== this.generation || this.closed) return;
    this.building = true;
    creatorBusy.value = true;
    this.publish();
    try {
      const body =
        !forgeReady().ok || !this.recipe
          ? placeholderAvatar(this.seed)
          : await buildAvatar(this.recipe, { budgetMs: 8 });
      if (generation !== this.generation || this.closed) {
        body.dispose();
        return;
      }
      if (body.source === 'placeholder' && forgeBuildError()) {
        this.note = 'This look could not be built. Showing a stand-in.';
      } else if (body.source === 'forge' && forgeReady().ok) {
        this.note = '';
      }
      body.play(this.clip);
      const previous = this.working;
      this.working = body;
      this.hash = body.recipeHash;
      creatorSource.value = body.source;
      creatorSerial.value += 1;
      this.preview?.setBody(body.object3D);
      if (this.paperdoll) this.preview?.frameFocus(this.focus);
      if (previous && previous !== body) previous.dispose();
    } catch (error) {
      this.note = error instanceof Error ? error.message : 'Could not build this look.';
    } finally {
      this.building = false;
      creatorBusy.value = false;
      if (this.dirty) this.wait = DEBOUNCE_SECONDS;
      this.publish();
    }
  }

  private schedule(): void {
    this.generation += 1;
    this.dirty = true;
    this.wait = 0;
    this.publish();
  }

  private publish(): void {
    const options = this.options;
    const snap = this.snap;
    const worn = snap?.outfit[this.slot] ?? null;
    const garments = options?.slots[this.slot] ?? [];
    const wornOption = garments.find((item) => item.id === worn?.id);
    const style = options?.styles.find((item) => item.id === snap?.hairStyle);
    const view: CreatorView = {
      intent: this.optionsIn.intent,
      name: this.name,
      race: this.race,
      gender: this.gender,
      races: this.races.includes(this.race) ? this.races : [this.race, ...this.races],
      seed: this.seed,
      skins: (options?.skins ?? []).map(swatchLabel),
      skin: snap?.skin ?? '',
      hairColors: (options?.hairColors ?? [])
        .filter((item) => !snap?.skin || !item.deniedSkins?.includes(snap.skin))
        .map(swatchLabel),
      hairColor: snap?.hairColor ?? '',
      showHairColor: options?.controls.hairColor !== false,
      iris: (options?.iris ?? []).map(swatchLabel),
      eyeColor: snap?.eyeColor ?? '',
      scleras: (options?.sclera ?? []).map(swatchLabel),
      sclera: snap?.sclera ?? '',
      styles: (options?.styles ?? []).map((item) => ({
        id: item.id,
        label: item.name || pretty(item.id),
      })),
      hairStyle: snap?.hairStyle ?? '',
      showHairStyle: options?.controls.hairStyle !== false,
      hatNote: hatNote(style?.headwear ?? {}, worn?.id, snap),
      facialHair: (options?.facialHair ?? []).map((item) => ({
        id: item.id,
        label: item.name || pretty(item.id),
      })),
      facial: snap?.facialHair ?? '',
      showFacial: options?.controls.facialHair === true,
      showStubble: options?.controls.stubble === true,
      stubble: snap?.stubble ?? 0,
      lengths: lengthSliders(options, snap),
      heightSliders: bodySliders(options, snap, 'height'),
      buildSliders: bodySliders(options, snap, 'build'),
      shapeSliders: bodySliders(options, snap, 'shape'),
      facePresets: options?.face.presets ?? [],
      facePreset: this.facePreset,
      faceParts: faceParts(options, snap),
      faceParams: (options?.face.params ?? []).map((spec) => ({
        id: spec.id,
        label: pretty(spec.id.replace(/^face_/, '')),
        min: spec.min,
        max: spec.max,
        step: spec.step,
        value: snap?.face.params[spec.id] ?? spec.default,
      })),
      slots: Object.keys(options?.slots ?? {}),
      slot: this.slot,
      garment: worn?.id ?? '',
      garments: garments.map((item) => item.id),
      worn: Object.fromEntries(
        Object.entries(snap?.outfit ?? {}).map(([slot, piece]) => [slot, piece?.id ?? '']),
      ),
      dyes: (wornOption?.dyeRegions ?? []).map((region) => ({
        region,
        rgb: snap?.dye[worn?.id ?? '']?.[region] ?? [],
        swatches: dyeSwatches(region, options?.palettes ?? {}),
      })),
      paperdoll: this.paperdoll,
      focus: this.focus,
      states: Object.entries(wornOption?.states ?? {}).map(([name, spec]) => ({
        name,
        value: worn?.states?.[name] ?? spec.default,
        options: spec.options,
      })),
      homes: Object.keys(snap?.outfit ?? {}).filter((slot) => snap?.outfit[slot]?.id === worn?.id),
      notice: this.notice,
      warnings: this.warnings,
      errors: this.errors,
      note: this.note,
      hash: this.hash,
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      clip: this.clip,
      turntable: this.turntable,
      pixieNote: this.flyerRaces.includes(this.race)
        ? `${pretty(this.race)} hovers. Idle is a hover and Walk is flight.`
        : '',
    };
    creatorView.value = view;
    const root = this.canvas?.parentElement;
    if (!root) return;
    root.dataset.building = creatorBusy.value ? 'true' : 'false';
    root.dataset.avatarSource = creatorSource.value;
    root.dataset.cfInitMs = forgeReady().initMs.toFixed(0);
  }

  private mountCanvas(): void {
    const parent = this.host.areaCanvas.parentElement;
    if (!parent) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'creator-view';
    canvas.className = 'creator-view';
    parent.append(canvas);
    this.canvas = canvas;
    try {
      this.preview = new AvatarPreview(canvas);
    } catch (error) {
      this.note = error instanceof Error ? error.message : 'Preview failed';
    }
  }

  private orbitFromKeys(dt: number): void {
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement
    ) {
      return;
    }
    const speed = 1.35 * dt;
    const keyboard = this.host.keyboard;
    if (keyboard.isDown('ArrowLeft')) this.preview?.orbit(speed, 0);
    if (keyboard.isDown('ArrowRight')) this.preview?.orbit(-speed, 0);
    if (keyboard.isDown('ArrowUp')) this.preview?.orbit(0, speed);
    if (keyboard.isDown('ArrowDown')) this.preview?.orbit(0, -speed);
  }
}

function entryFor(race: string, gender: AvatarGender): PlayerProfileEntry {
  return { races: { [race]: 1 }, genders: { [gender]: 1 }, ages: { adult: 1 } };
}

function swatchLabel(item: { id: string; rgb: number[]; name?: string }): {
  id: string;
  rgb: number[];
  label: string;
} {
  const label = item.name ? `${item.name}` : pretty(item.id);
  return { id: item.id, rgb: item.rgb, label };
}

function lengthSliders(options: EditOptions | null, snap: EditSnapshot | null): SliderView[] {
  if (!options) return [];
  const values: Record<string, number> = {
    hairLength: snap?.hairLength ?? 0,
    bangLength: snap?.bangLength ?? 0,
    beardLength: snap?.beardLength ?? 0,
    hairGrey: snap?.hairGrey ?? 0,
    beardGrey: snap?.beardGrey ?? 0,
  };
  return LENGTH_ORDER.flatMap((id) => {
    const spec = options.hsld[id];
    if (!spec) return [];
    return [
      {
        id,
        label: pretty(id),
        min: spec.min,
        max: spec.max,
        step: spec.step,
        value: values[id] ?? spec.default,
      },
    ];
  });
}

function bodySliders(
  options: EditOptions | null,
  snap: EditSnapshot | null,
  group: string,
): SliderView[] {
  return (options?.sliders ?? [])
    .filter((spec) => spec.group === group)
    .map((spec) => ({
      id: spec.id,
      label: pretty(spec.id),
      min: spec.min,
      max: spec.max,
      step: spec.step,
      value: snap?.sliders[spec.id] ?? spec.default,
    }));
}

function faceParts(options: EditOptions | null, snap: EditSnapshot | null): PartView[] {
  if (!options || !snap) return [];
  const face = options.face;
  const current = snap.face;
  const rows: PartView[] = [
    { key: 'shape', label: 'Eye shape', value: current.shape ?? '', options: face.shapes },
    { key: 'brow', label: 'Brow', value: current.brow ?? '', options: face.brows },
    { key: 'nose', label: 'Nose', value: current.nose ?? '', options: face.noses },
    { key: 'noseType', label: 'Nose type', value: current.noseType ?? '', options: face.noseTypes },
    { key: 'mouth', label: 'Mouth', value: current.mouth ?? '', options: face.mouths },
  ];
  return rows.filter((row) => row.options.length > 1);
}

function hatNote(
  headwear: Record<string, string>,
  wornId: string | undefined,
  snap: EditSnapshot | null,
): string {
  if (!snap?.hairStyle) return '';
  if (wornId && headwear[wornId]) {
    return `${pretty(wornId)} wears this hair ${headwear[wornId].replaceAll('_', ' ')}.`;
  }
  const preview = Object.entries(headwear)
    .slice(0, 3)
    .map(([garment, state]) => `${pretty(garment)} ${state.replaceAll('_', ' ')}`);
  return preview.length > 0 ? `Hat preview: ${preview.join(', ')}.` : '';
}

function dyeSwatches(region: string, palettes: Record<string, number[][]>): number[][] {
  const direct = palettes[region];
  if (direct && direct.length > 0) return direct.slice(0, 16);
  const key = Object.keys(palettes).find((name) => region.includes(name) || name.includes(region));
  const rows = (key && palettes[key]) || palettes.cloth || palettes.linen || [];
  return rows.slice(0, 16);
}

function racesInProfile(profile: unknown): string[] {
  if (!profile || typeof profile !== 'object') return [];
  const defaults = (profile as { defaults?: { races?: Record<string, number> } }).defaults;
  return Object.keys(defaults?.races ?? {});
}

function pretty(id: string): string {
  return id.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function wardrobeOutfit(outfit: EditSnapshot['outfit']): WardrobeOutfit {
  const next: WardrobeOutfit = {};
  for (const [slot, piece] of Object.entries(outfit)) {
    next[slot] = piece ? { id: piece.id, states: { ...(piece.states ?? {}) } } : null;
  }
  return next;
}

function isOutfitPatch(patch: EditPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'outfit');
}

function displacementNote(changes: ReturnType<typeof diffOutfit>, keptId: string): string {
  return removedPieces(changes, keptId)
    .map((change) => `${pretty(change.from?.id ?? '')} left ${pretty(change.slot)}`)
    .join('. ');
}

function silentCommands(): CreatorCommands {
  const quiet = { ...creatorCommands };
  for (const key of Object.keys(quiet) as (keyof CreatorCommands)[]) {
    quiet[key] = noop as never;
  }
  return quiet;
}

function noop(): void {
  return;
}
