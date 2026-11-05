import {
  AVATAR_HISTORY_LIMIT,
  avatarFromChoices,
  choiceHistory,
  choicesFromAvatar,
  cloneChoices,
  isRegaliaId,
  playableIds,
  profileEntryFromChoices,
  randomizeChoices,
  recordChoices,
  redoChoices,
  sameChoices,
  undoChoices,
  type AvatarChoices,
  type ChoiceHistory,
  type PlayerAvatar,
  type SlotMode,
} from '../../core/people/avatar';
import {
  adoptPlayerBody,
  buildAvatar,
  forgeBuildError,
  forgeCatalog,
  forgeReady,
  generateRecipe,
  initForge,
  placeholderAvatar,
  type AvatarBody,
  type ForgeCatalog,
} from '../../render/characters/index';
import { AvatarPreview } from '../../render/characters/preview';
import {
  bindCreator,
  creatorBusy,
  creatorSerial,
  creatorSource,
  creatorView,
  type CreatorView,
  type StyleOption,
} from '../../ui/creator-state';
import type { GameHost } from '../host';
import type { Scene } from '../scene-stack';

const DEBOUNCE_SECONDS = 0.16;

export interface CreatorOptions {
  intent: 'new' | 'edit';
  initial: PlayerAvatar;
  onConfirm(avatar: PlayerAvatar): Promise<void> | void;
  onCancel(): Promise<void> | void;
}

export class CharacterCreatorScene implements Scene {
  readonly id = 'CharacterCreator';

  private history: ChoiceHistory;
  private catalog: ForgeCatalog | null = null;
  private profile: unknown = null;
  private profileRaces: string[] = [];
  private preview: AvatarPreview | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private working: AvatarBody | null = null;
  private handedOff = false;
  private clip: 'Idle' | 'Walk' = 'Idle';
  private turntable = false;
  private slot = '';
  private garment = '';
  private slotMode: 'any' | SlotMode = 'any';
  private note = '';
  private hash = '';
  private dirty = false;
  private wait = 0;
  private generation = 0;
  private building = false;
  private gestureBase: AvatarChoices | null = null;
  private nameBase: string | null = null;
  private closed = false;

  constructor(
    private readonly host: GameHost,
    private readonly options: CreatorOptions,
  ) {
    this.history = choiceHistory(choicesFromAvatar(options.initial));
  }

  async enter(): Promise<void> {
    this.host.setMode('creator');
    this.host.setCreatorVisible(true);
    this.mountCanvas();
    bindCreator({
      setName: (name) => this.setName(name),
      commitName: () => this.commitName(),
      setRace: (race) => this.commit({ ...this.present(), race }),
      setGender: (gender) => this.commit({ ...this.present(), gender }),
      setStyle: (style) => this.commit({ ...this.present(), style }),
      beginGesture: () => this.beginGesture(),
      setRichness: (value) => this.setRichness(value),
      endGesture: () => this.endGesture(),
      toggleLock: (field) => this.toggleLock(field),
      setSlot: (slot) => this.setSlot(slot),
      setGarment: (garment) => {
        this.garment = garment;
        this.publish();
      },
      setSlotMode: (mode) => {
        this.slotMode = mode;
        this.publish();
      },
      applySlot: () => this.applySlot(),
      clearSlot: (slot) => this.clearSlot(slot),
      randomize: () => this.randomize(),
      undo: () => this.step(undoChoices(this.history)),
      redo: () => this.step(redoChoices(this.history)),
      setClip: (clip) => this.setClip(clip),
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
        void this.cancel();
      },
    });
    creatorBusy.value = true;
    this.publish();
    try {
      this.profile = await this.host.content.load('characters/trailbound');
      this.profileRaces = racesInProfile(this.profile);
    } catch {
      this.profile = null;
    }
    const ready = await initForge({ profile: this.profile });
    this.catalog = forgeCatalog();
    if (!ready.ok) {
      this.note =
        ready.reason === 'cf=0'
          ? 'Forge is off (?cf=0). Showing a stand-in.'
          : `Forge did not start (${ready.reason}). Showing a stand-in.`;
    }
    this.ensureSlot();
    this.dirty = true;
    this.wait = DEBOUNCE_SECONDS;
    creatorBusy.value = false;
    this.publish();
  }

  update(dt: number): void {
    this.orbitFromKeys(dt);
    this.preview?.update(dt);
    this.working?.update(dt);
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
    bindCreator({
      setName: noop,
      commitName: noop,
      setRace: noop,
      setGender: noop,
      setStyle: noop,
      beginGesture: noop,
      setRichness: noop,
      endGesture: noop,
      toggleLock: noop,
      setSlot: noop,
      setGarment: noop,
      setSlotMode: noop,
      applySlot: noop,
      clearSlot: noop,
      randomize: noop,
      undo: noop,
      redo: noop,
      setClip: noop,
      setTurntable: noop,
      frame: noop,
      confirm: noop,
      cancel: noop,
    });
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

  private present(): AvatarChoices {
    return this.history.present;
  }

  private commit(next: AvatarChoices): void {
    this.history = recordChoices(this.history, next);
    this.schedule();
  }

  private step(next: ChoiceHistory): void {
    if (next === this.history) return;
    this.history = next;
    this.schedule();
  }

  private schedule(): void {
    this.generation += 1;
    this.dirty = true;
    this.wait = 0;
    this.publish();
  }

  private setName(name: string): void {
    if (this.nameBase === null) this.nameBase = this.present().name;
    this.history = { ...this.history, present: { ...this.present(), name } };
    this.publish();
  }

  private commitName(): void {
    if (this.nameBase === null) return;
    const previous = this.nameBase;
    this.nameBase = null;
    const current = this.present();
    if (previous === current.name) return;
    const past = [...this.history.past, { ...cloneChoices(current), name: previous }];
    while (past.length > AVATAR_HISTORY_LIMIT) past.shift();
    this.history = { past, present: current, future: [] };
    this.publish();
  }

  private beginGesture(): void {
    if (!this.gestureBase) this.gestureBase = cloneChoices(this.present());
  }

  private setRichness(value: number): void {
    const richness = clamp01(value);
    let present = { ...this.present(), richness };
    if (!present.locks.race && present.race.startsWith('royal_') && richness < 0.85) {
      present = { ...present, race: 'human' };
    }
    this.history = { ...this.history, present };
    this.schedule();
  }

  private endGesture(): void {
    if (!this.gestureBase) return;
    const base = this.gestureBase;
    this.gestureBase = null;
    const next = cloneChoices(this.present());
    if (sameChoices(base, next)) return;
    const past = [...this.history.past, base];
    while (past.length > AVATAR_HISTORY_LIMIT) past.shift();
    this.history = { past, present: next, future: [] };
    this.publish();
  }

  private toggleLock(field: keyof AvatarChoices['locks']): void {
    const locks = { ...this.present().locks, [field]: !this.present().locks[field] };
    this.history = recordChoices(this.history, { ...this.present(), locks });
    this.publish();
  }

  private setSlot(slot: string): void {
    this.slot = slot;
    const garments = this.garmentsFor(slot);
    const existing = this.present().slots[slot];
    if (existing) {
      this.garment = existing.garment;
      this.slotMode = existing.mode;
    } else {
      this.garment = garments[0] ?? '';
      this.slotMode = 'any';
    }
    this.publish();
  }

  private applySlot(): void {
    const slots = { ...this.present().slots };
    if (this.slotMode === 'any' || !this.garment) delete slots[this.slot];
    else slots[this.slot] = { mode: this.slotMode, garment: this.garment };
    this.commit({ ...this.present(), slots });
  }

  private clearSlot(slot: string): void {
    const slots = { ...this.present().slots };
    delete slots[slot];
    if (slot === this.slot) this.slotMode = 'any';
    this.commit({ ...this.present(), slots });
  }

  private randomize(): void {
    const catalog = this.catalog;
    const next = randomizeChoices(this.present(), {
      races: this.racePool(this.present().richness),
      styles: catalog?.styles ?? [this.present().style],
    });
    this.commit(next);
  }

  private setClip(clip: 'Idle' | 'Walk'): void {
    this.clip = clip;
    this.working?.play(clip);
    this.publish();
  }

  private async confirm(): Promise<void> {
    if (this.closed) return;
    this.generation += 1;
    this.dirty = false;
    await this.enqueue(this.generation);
    if (this.closed) return;
    const avatar = avatarFromChoices(
      this.present(),
      this.working?.recipeHash ?? '',
      this.catalog?.generatorVersion ?? 1,
    );
    if (this.working) {
      adoptPlayerBody(this.working);
      this.handedOff = true;
    }
    await this.options.onConfirm(avatar);
  }

  private async cancel(): Promise<void> {
    if (this.closed) return;
    await this.options.onCancel();
  }

  private enqueue(generation: number): Promise<void> {
    const run = this.chain.then(() => this.rebuild(generation));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private chain: Promise<void> = Promise.resolve();

  private async rebuild(generation: number): Promise<void> {
    if (generation !== this.generation || this.closed) return;
    this.building = true;
    creatorBusy.value = true;
    this.publish();
    const choices = cloneChoices(this.present());
    try {
      let body: AvatarBody;
      if (!forgeReady().ok) {
        body = placeholderAvatar(choices.seed);
      } else {
        const recipe = generateRecipe({
          seed: choices.seed,
          profileEntry: profileEntryFromChoices(choices),
          generatorVersion: this.catalog?.generatorVersion,
        });
        body = await buildAvatar(recipe, { budgetMs: 8 });
        if (body.source === 'placeholder' && forgeBuildError()) {
          this.note = 'This look could not be built. Showing a stand-in.';
        } else if (body.source === 'forge') {
          const failure = forgeReady().reason;
          if (!failure) this.note = '';
        }
      }
      if (generation !== this.generation || this.closed) {
        body.dispose();
        return;
      }
      body.play(this.clip);
      const previous = this.working;
      this.working = body;
      this.hash = body.recipeHash;
      creatorSource.value = body.source;
      creatorSerial.value += 1;
      this.preview?.setBody(body.object3D);
      if (previous && previous !== body) previous.dispose();
    } catch (error) {
      if (generation !== this.generation || this.closed) return;
      this.note = error instanceof Error ? error.message : 'Could not build this look.';
      const body = placeholderAvatar(choices.seed);
      body.play(this.clip);
      const previous = this.working;
      this.working = body;
      this.hash = body.recipeHash;
      creatorSource.value = 'placeholder';
      creatorSerial.value += 1;
      this.preview?.setBody(body.object3D);
      if (previous) previous.dispose();
    } finally {
      this.building = false;
      creatorBusy.value = false;
      if (this.dirty) this.wait = DEBOUNCE_SECONDS;
      this.publish();
    }
  }

  private publish(): void {
    const choices = this.present();
    const catalog = this.catalog;
    const min = catalog?.regaliaMinRichness ?? 0.85;
    const races = this.racePool(choices.richness);
    const raceList = races.includes(choices.race) ? races : [choices.race, ...races];
    const garments = this.garmentsFor(this.slot);
    const garment = garments.includes(this.garment) ? this.garment : (garments[0] ?? '');
    this.garment = garment;
    const blocked =
      choices.richness < min &&
      (isRegaliaId(choices.style) ||
        (catalog?.regaliaStyles.includes(choices.style) ?? false) ||
        choices.race.startsWith('royal_') ||
        Object.values(choices.slots).some((slot) =>
          catalog?.regaliaGarments.includes(slot.garment),
        ));
    const view: CreatorView = {
      intent: this.options.intent,
      name: choices.name,
      race: choices.race,
      gender: choices.gender,
      style: choices.style,
      richness: choices.richness,
      seed: choices.seed,
      locks: { ...choices.locks },
      races: raceList,
      styles: styleOptions(catalog, choices.style),
      slots: catalog?.slots ?? (this.slot ? [this.slot] : []),
      garments,
      slot: this.slot,
      garment,
      slotMode: this.slotMode,
      chips: Object.entries(choices.slots).map(([slot, rule]) => ({
        slot,
        label: labelize(slot),
        mode: rule.mode,
        garment: rule.garment,
      })),
      regaliaWarning:
        choices.richness >= min
          ? ''
          : blocked
            ? `This look uses regalia. Forge leaves it off until richness reaches ${min.toFixed(2)}.`
            : `Regalia — crowns, royal styles, royal races — needs richness ${min.toFixed(2)} or higher.`,
      pixieNote: (catalog?.flyerRaces ?? ['pixie']).includes(choices.race)
        ? `${labelize(choices.race)} hovers. Idle is a hover and Walk is flight.`
        : '',
      note: this.note,
      hash: this.hash,
      canUndo: this.history.past.length > 0,
      canRedo: this.history.future.length > 0,
      clip: this.clip,
      turntable: this.turntable,
    };
    creatorView.value = view;
    const root = this.canvas?.parentElement;
    if (root) {
      root.dataset.building = creatorBusy.value ? 'true' : 'false';
      root.dataset.avatarSource = creatorSource.value;
      root.dataset.cfInitMs = forgeReady().initMs.toFixed(0);
    }
  }

  private racePool(richness: number): string[] {
    const fromBundle = this.catalog?.races ?? [];
    const merged =
      fromBundle.length > 0 ? [...fromBundle] : ['human', 'elf', 'dwarf', 'kobold', 'pixie'];
    for (const race of this.profileRaces) {
      if (!merged.includes(race)) merged.push(race);
    }
    return playableIds(merged, richness, this.catalog?.regaliaMinRichness ?? 0.85);
  }

  private garmentsFor(slot: string): string[] {
    return this.catalog?.garmentsBySlot[slot] ?? [];
  }

  private ensureSlot(): void {
    const slots = this.catalog?.slots ?? [];
    this.slot = slots[0] ?? '';
    this.garment = this.garmentsFor(this.slot)[0] ?? '';
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

function styleOptions(catalog: ForgeCatalog | null, current: string): StyleOption[] {
  const styles = catalog?.styles ?? ['wanderer', 'ranger', 'knight', 'mage', 'villager'];
  const kinds = catalog?.styleKinds ?? {};
  const options: StyleOption[] = [];
  for (const id of styles) {
    const kind = kinds[id] ?? '';
    const dual = kind.includes('also a look');
    const lookOnly = kind === 'look';
    options.push({
      id,
      label: dual || !lookOnly ? labelize(id) : `${labelize(id)} look`,
    });
    if (dual) options.push({ id: `look:${id}`, label: `${labelize(id)} look` });
  }
  if (current && !options.some((option) => option.id === current)) {
    options.unshift({ id: current, label: labelize(current) });
  }
  return options;
}

function labelize(id: string): string {
  const bare = id.replace(/^(look|arche):/, '').replaceAll('_', ' ');
  return bare.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function racesInProfile(profile: unknown): string[] {
  if (!profile || typeof profile !== 'object') return [];
  const defaults = (profile as { defaults?: { races?: Record<string, number> } }).defaults;
  return Object.keys(defaults?.races ?? {});
}

function clamp01(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function noop(): void {
  return;
}
