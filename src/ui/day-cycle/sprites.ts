import { parseManifest, type FontDef, type HudManifest, type SpriteDef } from './manifest';

export interface Sprite {
  id: string;
  def: SpriteDef;
  image: HTMLImageElement;
}

export interface HudSprites {
  manifest: HudManifest;
  sprites: Record<string, Sprite>;
  font: { def: FontDef; image: HTMLImageElement };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`day-cycle HUD: could not load ${url}`));
    image.src = url;
  });
}

let cached: Promise<HudSprites> | null = null;

/** Loads the manifest and every PNG it names. `base` ends with a slash. */
export function loadHudSprites(base: string): Promise<HudSprites> {
  cached ??= (async () => {
    const dir = `${base}assets/ui/hud-day-cycle/`;
    const response = await fetch(`${dir}manifest.json`);
    if (!response.ok) throw new Error(`day-cycle HUD: manifest ${response.status}`);
    const manifest = parseManifest(await response.json());
    const entries = await Promise.all(
      Object.entries(manifest.sprites).map(async ([id, def]) => {
        const image = await loadImage(`${dir}${def.file}`);
        return [id, { id, def, image }] as const;
      }),
    );
    const fontImage = await loadImage(`${dir}${manifest.font.file}`);
    return {
      manifest,
      sprites: Object.fromEntries(entries),
      font: { def: manifest.font, image: fontImage },
    };
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}
